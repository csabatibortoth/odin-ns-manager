// Looks up the records this server does not hold itself, by asking the
// upstream DNS servers through the recursor of njord-ns-server.
//
// - One recursor (and so one set of sockets) is shared by every query.
// - Answers are cached until their TTL runs out, failed lookups for a short time.
// - Queries for the same name and type that arrive while a lookup is in flight
//   wait for that lookup instead of sending their own.
const named = require('njord-ns-server');
const { lookup } = require('bragi-ns-client');
const config = require('../../config/config');

const recursor = named.createRecursor({
    servers: config.nsUpstreamServers.length ? config.nsUpstreamServers : undefined,
    timeout: config.nsUpstreamTimeout,
    tries: config.nsUpstreamTries,
});

// What a failed lookup means for the response to our own client; anything
// that is not listed is a failure of the server.
const RESPONSE_CODES = {
    ENOTFOUND: 'enoname',
    ENODATA: 'enoerr', // the name exists, but has no records of this type
    EREFUSED: 'erefuse',
    ENOTIMP: 'enotimp',
};

// Only definite answers of the upstream are worth remembering; timeouts are not.
const CACHEABLE_ERRORS = new Set(['ENOTFOUND', 'ENODATA']);

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

    task = recursor.lookup(name, type).then(
        (answers) => {
            const entry = { answers, expires: 0 };
            remember(key, entry, answers.reduce((min, answer) => Math.min(min, answer.ttl), Infinity));
            return entry;
        },
        (error) => {
            const entry = { error, expires: 0 };
            if (CACHEABLE_ERRORS.has(error.code)) remember(key, entry, config.nsNegativeCacheTtl);
            return entry;
        }
    ).finally(() => pending.delete(key));

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

module.exports = {
    search,
    resolve,
    clearCache,
    cacheSize: () => cache.size,
    upstreamServers: () => recursor.servers(),
    // A cached replacement of dns.lookup, for the outgoing connections of this
    // process: http.get(url, { lookup }), net.connect({ host, port, lookup }), ...
    lookup,
};
