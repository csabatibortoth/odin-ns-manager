const fs = require('fs');

const { visibleOnAuthoritative, visibleOnPublicResolvers } = require('./dnsChallenge');

// DNS-01 provider "cloudflare": the TXT record of the challenge is written through the API of Cloudflare, for a domain
// whose DNS is hosted there. See dnsChallenge.js for the interface.
//
// The token (FREYA_ACME_CLOUDFLARE_TOKEN, or the first line of the file FREYA_ACME_CLOUDFLARE_TOKEN_FILE) should be an
// API token limited to ONE zone with the permission "DNS: Edit" (and "Zone: Read" to find the zone by name; with
// FREYA_ACME_CLOUDFLARE_ZONE_ID set, "DNS: Edit" is enough). Never the global API key. The token is sent only to
// api.cloudflare.com, over HTTPS, and is never written to a log or an error message.
//
// Only TXT records named _acme-challenge.* are created, and only a record that has exactly the value written is removed.

const API = 'https://api.cloudflare.com/client/v4';
const PREFIX = '_acme-challenge.';
const TTL = 60;
const TIMEOUT_MS = 15000;
const RETRIES = 2;

const unquote = (content) => String(content).replace(/^"(.*)"$/, '$1');
const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readToken({ token, tokenFile }) {
    const value = token || (tokenFile ? fs.readFileSync(tokenFile, 'utf8').split(/\r?\n/)[0] : '');
    const clean = value.trim();
    if (!clean) {
        throw new Error(
            'The cloudflare provider needs an API token: set FREYA_ACME_CLOUDFLARE_TOKEN, or FREYA_ACME_CLOUDFLARE_TOKEN_FILE ' +
                '(a token limited to one zone, with the permission DNS: Edit).'
        );
    }
    return clean;
}

// options: { token, tokenFile, zoneId, baseUrl, fetch, sleep } - baseUrl, fetch and sleep are for the tests.
function createProvider(options = {}) {
    const token = readToken(options);
    const base = options.baseUrl || API;
    const doFetch = options.fetch || fetch;
    const sleep = options.sleep || sleepFor;
    // name of the challenge -> zone id, so that the removal does not look it up again
    const zoneIds = new Map();
    // `${name}\n${value}` -> id of the record that was created here
    const created = new Map();

    async function call(method, path, body) {
        for (let attempt = 0; ; attempt++) {
            let response;
            try {
                response = await doFetch(`${base}${path}`, {
                    method,
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: body ? JSON.stringify(body) : undefined,
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                    redirect: 'error',
                });
            } catch (err) {
                // Name the failure, never the request: it holds the token.
                if (attempt < RETRIES) {
                    await sleep(1000 * 2 ** attempt);
                    continue;
                }
                throw new Error(`Cloudflare could not be reached (${err.name === 'TimeoutError' ? 'timeout' : err.cause?.code || err.name})`);
            }
            if ((response.status === 429 || response.status >= 500) && attempt < RETRIES) {
                const wait = Number(response.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt;
                await sleep(Math.min(wait, 10000));
                continue;
            }
            const json = await response.json().catch(() => null);
            if (!response.ok || !json?.success) {
                const reasons = (json?.errors || []).map((e) => `${e.message} (${e.code})`).join('; ');
                const hint =
                    response.status === 401 || response.status === 403
                        ? ' The token is wrong, expired, or lacks the permission "DNS: Edit" (and "Zone: Read") for this zone.'
                        : '';
                throw new Error(`Cloudflare answered ${response.status}${reasons ? `: ${reasons}` : ''}.${hint}`);
            }
            return json.result;
        }
    }

    // The zone that holds the name: the longest suffix of the name that is a zone of this account.
    async function zoneOf(name) {
        if (options.zoneId) return options.zoneId;
        if (zoneIds.has(name)) return zoneIds.get(name);
        const parts = name.split('.');
        for (let at = 1; at < parts.length - 1; at++) {
            const candidate = parts.slice(at).join('.');
            const found = await call('GET', `/zones?name=${encodeURIComponent(candidate)}&status=active`);
            if (found.length) {
                zoneIds.set(name, found[0].id);
                return found[0].id;
            }
        }
        throw new Error(`${name} does not belong to a zone of this Cloudflare account (or the token cannot see it)`);
    }

    function check(name, value) {
        if (typeof name !== 'string' || !name.startsWith(PREFIX) || name.length <= PREFIX.length) {
            throw new Error(`Only names that start with ${PREFIX} can be written: ${name}`);
        }
        if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('The value of a challenge record has the wrong form');
    }

    async function matching(zone, name, value) {
        const found = await call('GET', `/zones/${zone}/dns_records?type=TXT&name=${encodeURIComponent(name)}&per_page=100`);
        return found.filter((record) => unquote(record.content) === value);
    }

    return {
        async create(name, value) {
            check(name, value);
            const zone = await zoneOf(name);
            // A retry finds its own record: not written twice.
            const [existing] = await matching(zone, name, value);
            const record = existing || (await call('POST', `/zones/${zone}/dns_records`, { type: 'TXT', name, content: value, ttl: TTL }));
            created.set(`${name}\n${value}`, record.id);
        },

        async remove(name, value) {
            check(name, value);
            const zone = await zoneOf(name);
            // Every record with exactly this value (also one a failed run left), and no other value at the same name.
            const ids = new Set((await matching(zone, name, value)).map((record) => record.id));
            const own = created.get(`${name}\n${value}`);
            if (own) ids.add(own);
            for (const id of ids) {
                await call('DELETE', `/zones/${zone}/dns_records/${id}`).catch((err) => {
                    // Already gone is what was wanted.
                    if (!/ 404/.test(err.message)) throw err;
                });
            }
            created.delete(`${name}\n${value}`);
        },

        // Published when the name servers of the zone (Cloudflare's) all have it: no cache in between. The public resolvers
        // are the fallback when the name servers cannot be found.
        async visible(name, value) {
            const published = await visibleOnAuthoritative(name, value);
            return published ?? visibleOnPublicResolvers(name, value);
        },
    };
}

module.exports = { createProvider, API };
