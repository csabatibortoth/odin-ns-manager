const dns = require('dns');

// The DNS-01 challenge of ACME: the certificate authority looks for a TXT record at
// _acme-challenge.<name> that holds a value only the owner of the account can compute.
//
// This file knows nothing about where the record is written. That is the job of a provider, a small object:
//   create(name, value)   writes the TXT record (async)
//   remove(name, value)   removes exactly that value, never the other values at the same name (async)
//   visible(name, value)  optional: true when the record is answered, where the authority will look (async)
//   diagnose(name)        optional: why the record is not visible, in a sentence for the person who set it up (async)
// Without `visible`, public resolvers are asked.

const PREFIX = '_acme-challenge.';
const MODES = ['http-01', 'dns-01', 'auto'];
const PUBLIC_RESOLVERS = ['1.1.1.1', '8.8.8.8'];
const FIRST_DELAY_MS = 1000;
const MAX_DELAY_MS = 15000;

const isWildcard = (name) => name.startsWith('*.');
// A wildcard and its base name share one record name: *.example.com and example.com both use _acme-challenge.example.com.
const challengeName = (domain) => PREFIX + domain.replace(/^\*\./, '').toLowerCase();

// What a mode means for a list of names: which challenge types may be used, in which order, and whether
// port 80 has to be opened at all.
function planFor(mode, domains) {
    if (!MODES.includes(mode)) throw new Error(`FREYA_ACME_CHALLENGE must be one of ${MODES.join(', ')}: ${mode}`);
    const wildcards = domains.filter(isWildcard);
    if (mode === 'http-01') {
        if (wildcards.length) {
            throw new Error(
                `A wildcard name (${wildcards.join(', ')}) can only be checked through DNS: set FREYA_ACME_CHALLENGE=dns-01 or auto.`
            );
        }
        return { priority: ['http-01'], needsHttp: true, needsDns: false };
    }
    if (mode === 'dns-01') return { priority: ['dns-01'], needsHttp: false, needsDns: true };
    // auto: the authority offers only dns-01 for a wildcard, so the first type it offers that is listed here wins.
    return {
        priority: ['http-01', 'dns-01'],
        needsHttp: domains.some((domain) => !isWildcard(domain)),
        needsDns: wildcards.length > 0,
    };
}

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// What one public resolver says about the record: 'yes' (it has the value), 'no' (it answered, without the value: nothing
// there, or an older value) or 'unreachable' (no answer: a timeout, a refusal, a blocked network: it tells nothing).
async function askResolver(server, name, value) {
    const resolver = new dns.promises.Resolver({ timeout: 3000, tries: 1 });
    resolver.setServers([server]);
    try {
        const answers = await resolver.resolveTxt(name);
        return answers.some((chunks) => chunks.join('') === value) ? 'yes' : 'no';
    } catch (err) {
        return err.code === 'ENODATA' || err.code === 'ENOTFOUND' ? 'no' : 'unreachable';
    }
}

// The record counts as visible when one public resolver has it. (Requiring all of them was tried: it made a real order wait
// 60 seconds longer, for the negative answers that the polling itself had put into those caches.) `ask` is injected for the tests.
async function visibleOnPublicResolvers(name, value, ask = askResolver) {
    for (const server of PUBLIC_RESOLVERS) {
        if ((await ask(server, name, value)) === 'yes') return true;
    }
    return false;
}

// The name servers of the zone that holds `name`, as addresses: the NS records of the nearest parent that has some.
async function authoritativeAddresses(name, resolver = dns.promises) {
    const labels = name.split('.');
    for (let at = 1; at < labels.length - 1; at++) {
        const hosts = await resolver.resolveNs(labels.slice(at).join('.')).catch(() => []);
        if (!hosts.length) continue;
        const found = await Promise.all(hosts.map((host) => resolver.resolve4(host).catch(() => [])));
        return [...new Set(found.flat())];
    }
    return [];
}

// Asks the authoritative name servers of the zone themselves, which have no cache that could be stale: the record is
// published when every one that answers has it (and at least one does). Returns true or false, or null when the servers
// cannot be found (the caller then falls back to the public resolvers). `deps` is injected for the tests.
async function visibleOnAuthoritative(name, value, { addresses = authoritativeAddresses, ask = askResolver } = {}) {
    const servers = await addresses(name);
    if (!servers.length) return null;
    const answers = await Promise.all(servers.map((server) => ask(server, name, value)));
    if (!answers.includes('yes') && !answers.includes('no')) return null; // none answered
    return answers.includes('yes') && !answers.includes('no');
}

// Some failures of the authority are about timing, not about this setup: say so, and what to do.
const STALE_RECORD = /secondary validation|incorrect txt record/i;
function explainFailure(message) {
    if (!STALE_RECORD.test(String(message))) return '';
    return (
        ' A validation server of the authority saw a TXT record that is not the one of this order: it may still hold an older copy ' +
        '(the challenge records live 60 seconds, and several orders for the same name close together can meet it). ' +
        'Wait two minutes and try again; failed validations count against the limits of the authority.'
    );
}

// The two functions acme-client calls, plus `cleanup`, which removes what is left after a failure.
// options.waitSeconds: how long to wait for the record to be visible before giving up.
// options.settleSeconds: a short wait after the record is visible, before the authority is asked (it validates from several
// places with caches of their own); 0 switches it off.
function createHandlers(provider, { waitSeconds = 120, settleSeconds = 0, sleep = sleepFor, now = Date.now, log = () => {}, onEvent = () => {} } = {}) {
    const visible = provider.visible ? provider.visible.bind(provider) : visibleOnPublicResolvers;
    // What was written and not yet removed: a challenge that fails must not leave a record behind.
    const written = new Map();
    const keyOf = (name, value) => `${name}\n${value}`;

    async function waitUntilVisible(name, value) {
        const deadline = now() + waitSeconds * 1000;
        let delay = FIRST_DELAY_MS;
        for (;;) {
            if (await visible(name, value).catch(() => false)) return;
            if (now() + delay > deadline) {
                // A provider may know why: for the delegation, which of the two records is missing.
                const why = provider.diagnose ? await provider.diagnose(name).catch(() => '') : '';
                throw new Error(
                    `The record ${name} was written but could not be seen within ${waitSeconds} seconds, so the authority was not asked. ` +
                        (why || 'Check that the name server answers for this name; FREYA_ACME_DNS_WAIT allows more time.')
                );
            }
            await sleep(delay);
            delay = Math.min(delay * 2, MAX_DELAY_MS);
        }
    }

    async function create(authz, challenge, keyAuthorization) {
        if (challenge.type !== 'dns-01') throw new Error(`Not a DNS challenge: ${challenge.type}`);
        const name = challengeName(authz.identifier.value);
        // For dns-01 acme-client already hands over the value of the record: base64url(SHA-256(key authorization)).
        written.set(keyOf(name, keyAuthorization), { name, value: keyAuthorization });
        await provider.create(name, keyAuthorization);
        log(`challenge record written: ${name}`);
        onEvent('record written', name);
        await waitUntilVisible(name, keyAuthorization);
        onEvent('record visible', name);
        if (settleSeconds > 0) {
            await sleep(settleSeconds * 1000);
            onEvent('settled', `${settleSeconds} s`);
        }
    }

    async function remove(authz, challenge, keyAuthorization) {
        const name = challengeName(authz.identifier.value);
        await provider.remove(name, keyAuthorization);
        written.delete(keyOf(name, keyAuthorization));
        log(`challenge record removed: ${name}`);
        onEvent('record removed', name);
    }

    // Removes every record still written; an error on one does not stop the others. Returns the errors.
    async function cleanup() {
        const errors = [];
        for (const [key, { name, value }] of [...written]) {
            try {
                await provider.remove(name, value);
                written.delete(key);
            } catch (err) {
                errors.push(`${name}: ${err.message}`);
            }
        }
        return errors;
    }

    return { create, remove, cleanup, written };
}

module.exports = { MODES, PREFIX, isWildcard, challengeName, planFor, createHandlers, visibleOnPublicResolvers, visibleOnAuthoritative, authoritativeAddresses, explainFailure };
