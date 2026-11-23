// Who may use this server as a resolver (recursion / forwarding).
//
// A DNS server that answers recursive questions for everybody who can reach it is an OPEN RESOLVER: it is used
// to amplify attacks on others and to hide who asks. So the names that are not in one of our own zones are
// answered only to the clients of the list `nsRecursionAllowed` (CIDR ranges, default: loopback and private
// networks). Everybody else gets REFUSED for them. The names of our own zones (and standalone records) are
// answered for anybody: that is what an authoritative server is for.
const os = require('os');
const config = require('../../config/config');

const cidr = require('./cidr');
const { normalize } = cidr;

let compiledFrom = null;
let compiled = cidr.compile([]);

// The addresses of this machine: a client that is this server itself (the lookup of the user interface, the check of
// a challenge record) is never refused, whatever address it was reached at. Looked at again every minute.
let ownUntil = 0;
let own = new Set();
function isOwn(client, now = Date.now()) {
    if (now >= ownUntil) {
        own = new Set(Object.values(os.networkInterfaces()).flat().map((item) => normalize(item.address)).filter(Boolean));
        ownUntil = now + 60_000;
    }
    return own.has(client);
}

// May this client ask recursive questions? An unknown client address is not allowed: closed is the safe side.
function mayRecurse(address) {
    const client = normalize(address);
    if (!client) return false;
    if (isOwn(client)) return true;
    const list = config.nsRecursionAllowed;
    if (list !== compiledFrom) {
        compiled = cidr.compile(list);
        compiledFrom = list;
    }
    return cidr.contains(compiled, client);
}

// Who was refused: a bounded table in memory (the addresses of clients are personal data, and anybody on the
// internet can ask: it must not grow, and it is not written to the query log). Gone at the next start.
const MAX_CLIENTS = 200;
const refused = new Map(); // client -> { count, last }
let refusedTotal = 0;

function noteRefused(address, now = Date.now()) {
    refusedTotal++;
    const client = normalize(address) ?? 'unknown';
    const seen = refused.get(client);
    if (seen) {
        seen.count++;
        seen.last = now;
        return;
    }
    // The table is full: the one that was seen the longest ago makes room
    if (refused.size >= MAX_CLIENTS) {
        let oldest = null;
        for (const [key, value] of refused) if (!oldest || value.last < refused.get(oldest).last) oldest = key;
        refused.delete(oldest);
    }
    refused.set(client, { count: 1, last: now });
}

// The clients that were refused most often, for the monitoring page
function refusedClients(limit = 20) {
    return [...refused]
        .map(([client, { count, last }]) => ({ client, count, last: new Date(last).toISOString() }))
        .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
        .slice(0, limit);
}

const state = () => ({ allowed: config.nsRecursionAllowed, refused: refusedTotal, clients: refused.size });

function reset() {
    refused.clear();
    refusedTotal = 0;
}

module.exports = { mayRecurse, noteRefused, refusedClients, state, reset, MAX_CLIENTS, isOwn };
