// Looks up the records this server does not hold itself, by asking the
// upstream DNS servers through the recursor of njord-ns-server.
//
// - One recursor (and so one set of sockets) is shared by every query.
// - Answers are cached until their TTL runs out, failed lookups for a short time.
// - Queries for the same name and type that arrive while a lookup is in flight
//   wait for that lookup instead of sending their own.
// - With the nsDnssec setting, the addresses (A and AAAA) are checked with the
//   DNSSEC validation of bragi-ns-client before they are answered.
const named = require('njord-ns-server');
const { lookup, createLookup, DNSSEC_BOGUS } = require('bragi-ns-client');
const config = require('../../config/config');

const UPSTREAM_SETTINGS = ['nsUpstreamServers', 'nsUpstreamTimeout', 'nsUpstreamTries', 'nsDnssec'];
// The record types DNSSEC is checked for: the ones bragi-ns-client looks up
const FAMILIES = { A: 4, AAAA: 6 };

const createRecursor = () =>
    named.createRecursor({
        servers: config.nsUpstreamServers.length ? config.nsUpstreamServers : undefined,
        timeout: config.nsUpstreamTimeout,
        tries: config.nsUpstreamTries,
    });

let recursor = createRecursor();

// A lookup of bragi-ns-client that validates what the same upstream answers;
// null when DNSSEC is off. It keeps the keys of the zones it has seen.
const createSecureLookup = () =>
    (config.nsDnssec === 'off'
        ? null
        : createLookup({ dnssec: config.nsDnssec, servers: recursor.servers(), timeout: config.nsUpstreamTimeout, tries: config.nsUpstreamTries }));

let secureLookup = createSecureLookup();
const dnssec = { secure: 0, insecure: 0, bogus: 0 }; // the checked lookups since the start

// What DNSSEC says about the addresses of a name: { secure, addresses }, or
// null when it can not tell (the name has none, the upstream did not answer).
// Rejects when the answer is bogus: forged, or signed in a broken way.
function validate(name, type) {
    return new Promise((resolve, reject) => {
        secureLookup(name, { all: true, family: FAMILIES[type] }, (error, addresses) => {
            if (error) return error.code === DNSSEC_BOGUS ? reject(error) : resolve(null);
            resolve({ secure: addresses.length > 0 && addresses.every((address) => address.secure), addresses: addresses.map((address) => address.address) });
        });
    });
}

// The answers of the upstream, after the check: a bogus answer is a failure,
// and for a signed name nothing but the validated addresses is passed on.
function checked(name, type, result, verdict) {
    if (!verdict) return result;
    dnssec[verdict.secure ? 'secure' : 'insecure']++;
    if (!verdict.secure) return { ...result, secure: false };

    const valid = new Set(verdict.addresses);
    if (result.answers?.length && result.answers.every((answer) => valid.has(answer.record.target))) return { ...result, secure: true };
    const ttl = result.answers?.reduce((min, answer) => Math.min(min, answer.ttl), Infinity) ?? Infinity;
    const Record = type === 'A' ? named.ARecord : named.AAAARecord;
    return { answers: verdict.addresses.map((address) => ({ record: new Record(address), ttl: Number.isFinite(ttl) ? ttl : 60 })), secure: true };
}

// What a failed lookup means for the response to our own client; anything
// that is not listed is a failure of the server.
const RESPONSE_CODES = {
    ENOTFOUND: 'enoname',
    ENODATA: 'enoerr', // the name exists, but has no records of this type
    EREFUSED: 'erefuse',
    ENOTIMP: 'enotimp',
};

// Only definite answers of the upstream are worth remembering; timeouts are not.
const CACHEABLE_ERRORS = new Set(['ENOTFOUND', 'ENODATA', DNSSEC_BOGUS]);

const cache = new Map(); // key -> { answers, error, expires }
const pending = new Map(); // key -> promise of a cache entry

function remember(key, entry, ttl) {
    if (!config.nsCacheEnabled || ttl <= 0) return;
    entry.expires = Date.now() + ttl * 1000;
    cache.delete(key);
    cache.set(key, entry);
    // A Map keeps insertion order, so the first key is the oldest entry
    if (cache.size > config.nsCacheMaxEntries) cache.delete(cache.keys().next().value);
}

function fetch(key, name, type) {
    let task = pending.get(key);
    if (task) return task;

    const asked = recursor.lookup(name, type).then((answers) => ({ answers }), (error) => ({ error }));
    const verdict = secureLookup && FAMILIES[type] ? validate(name, type) : null;
    task = Promise.all([asked, verdict])
        .then(
            ([result, known]) => checked(name, type, result, known),
            (error) => {
                dnssec.bogus++;
                return { error };
            }
        )
        .then((entry) => {
            entry.expires = 0;
            if (entry.error) {
                if (CACHEABLE_ERRORS.has(entry.error.code)) remember(key, entry, config.nsNegativeCacheTtl);
            } else {
                remember(key, entry, entry.answers.reduce((min, answer) => Math.min(min, answer.ttl), Infinity));
            }
            return entry;
        })
        .finally(() => pending.delete(key));

    pending.set(key, task);
    return task;
}

// Resolves with a list of { record, ttl }. The TTL of a cached answer is what
// is left of it. Rejects with the error of the resolver when the lookup fails.
async function search(name, type) {
    const key = `${type}:${name.toLowerCase()}`;
    const now = Date.now();

    let entry = cache.get(key);
    if (!entry || entry.expires <= now) {
        if (entry) cache.delete(key);
        entry = await fetch(key, name, type);
    }

    if (entry.error) throw entry.error;
    if (entry.expires <= now) return entry.answers; // fresh, or not cacheable

    const left = Math.ceil((entry.expires - now) / 1000);
    return entry.answers.map((answer) => ({ record: answer.record, ttl: Math.min(answer.ttl, left) }));
}

// Answers a query of the server: adds the records that are found, or sets the
// response code when the lookup fails. Either way the query can then be sent.
async function resolve(query) {
    const name = query.name();
    query._flags.ra = true; // recursion is available, as the recursor itself reports
    try {
        for (const answer of await search(name, query.type())) {
            query.addAnswer(name, answer.record, answer.ttl);
        }
    } catch (error) {
        query.setError(RESPONSE_CODES[error.code] || 'eserver');
    }
    return query;
}

function clearCache() {
    cache.clear();
}

// The settings of the upstream and of the cache can be changed while the
// server runs. Lookups that are in flight finish at the upstream they were sent to.
config.onChange((keys) => {
    if (keys.some((key) => UPSTREAM_SETTINGS.includes(key))) {
        recursor = createRecursor();
        secureLookup = createSecureLookup();
        clearCache(); // what another upstream answered is not ours to keep
    }
    if (!config.nsCacheEnabled) clearCache();
    while (cache.size > config.nsCacheMaxEntries) cache.delete(cache.keys().next().value);
});

module.exports = {
    search,
    resolve,
    clearCache,
    cacheSize: () => cache.size,
    upstreamServers: () => recursor.servers(),
    // What DNSSEC said about a name that was looked up: true (signed and valid),
    // false (not signed), or undefined when it was not checked or is not cached
    secureOf: (name, type) => cache.get(`${type}:${name.toLowerCase()}`)?.secure,
    // The code of the failure that is remembered for a name, if any
    failureOf: (name, type) => cache.get(`${type}:${name.toLowerCase()}`)?.error?.code,
    dnssecState: () => ({ mode: config.nsDnssec, ...dnssec }),
    // A cached replacement of dns.lookup, for the outgoing connections of this
    // process: http.get(url, { lookup }), net.connect({ host, port, lookup }), ...
    lookup,
};
