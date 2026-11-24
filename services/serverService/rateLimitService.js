// Response rate limiting (RRL) for the answers that this server gives from its OWN data.
//
// A DNS answer over UDP goes to the address in the packet, and that address can be forged: an attacker who sends
// many small questions "from" a victim makes this server send the answers to the victim (reflection). Rate limiting makes
// that worthless: identical answers to one client network are limited per second; the surplus is dropped, except
// that every `slip`-th one is sent as a tiny TRUNCATED answer (TC=1, nothing in it). A real client that was limited
// asks again over TCP (which cannot be forged and is not limited); a victim gets next to nothing.
//
// What is limited (UDP only): the answers of our own zones and records, "no such name" answers (counted per zone, so
// that random names cannot make an endless number of fresh counters), and REFUSED answers (counted per client network).
// What is not: TCP; the clients of the resolver list when `nsRateLimitTrustResolvers` is on (they are known networks);
// this machine itself; forwarded and blocked answers (only those clients get them).
// Also here: an answer that does not fit in a UDP packet is cut to a TRUNCATED answer (512 bytes, or what the client's EDNS0
// option announces, at most 1232 bytes: no fragmented answers), so a big answer cannot be reflected either.
const net = require('net');

const cidr = require('./cidr');

const MAX_KEYS = 50_000;
const IPV4_PREFIX = 24;
const IPV6_PREFIX = 56;
const MIN_UDP = 512;
const MAX_UDP = 1232;

// The "client network": the /24 of an IPv4 address and the /56 of an IPv6 address (the network of one customer): all the
// addresses of it share one counter, so an attacker cannot spread over them. Null for an address that cannot be read.
function networkOf(address) {
    const client = cidr.normalize(address);
    if (!client) return null;
    if (net.isIPv4(client)) {
        const [a, b, c] = client.split('.');
        return `${a}.${b}.${c}.0/${IPV4_PREFIX}`;
    }
    // expand the IPv6 address to 8 groups and keep the first 56 bits (3 groups and the high byte of the 4th)
    const [head, tail = ''] = client.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const groups = client.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
    if (groups.length !== 8) return null;
    const parts = groups.slice(0, 4).map((group) => parseInt(group || '0', 16));
    if (parts.some((part) => Number.isNaN(part))) return null;
    parts[3] &= 0xff00;
    return `${parts.map((part) => part.toString(16)).join(':')}::/${IPV6_PREFIX}`;
}

// A token bucket for every key: `perSecond` answers per second, a burst of the same size. check(key) returns 'allow', or
// 'drop', or 'slip' (every `slip`-th limited answer: send a truncated one; 0 never slips, 1 always).
// The table is bounded: when it is full the key that was used the longest ago goes (an attacker with endless names cannot
// make it grow, and cannot make a limited key forget itself faster than the table turns over).
function createLimiter({ perSecond, slip, maxKeys = MAX_KEYS, now = Date.now }) {
    const buckets = new Map(); // key -> { tokens, at, limited }
    return {
        check(key) {
            const time = now();
            let bucket = buckets.get(key);
            if (bucket) {
                buckets.delete(key); // re-inserted below: the Map keeps the order of use
                bucket.tokens = Math.min(perSecond, bucket.tokens + ((time - bucket.at) / 1000) * perSecond);
                bucket.at = time;
            } else {
                if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
                bucket = { tokens: perSecond, at: time, limited: 0 };
            }
            buckets.set(key, bucket);
            if (bucket.tokens >= 1) {
                bucket.tokens -= 1;
                bucket.limited = 0;
                return 'allow';
            }
            bucket.limited++;
            return slip > 0 && bucket.limited % slip === 0 ? 'slip' : 'drop';
        },
        size: () => buckets.size,
        clear: () => buckets.clear(),
    };
}

// The UDP payload size a client announced with EDNS0 (an OPT record in the additional section of its question), limited
// to [512, 1232]; 512 when it sent none or the packet cannot be read. `raw` is the packet of the query.
// Every step checks that it stays inside the packet: a packet that is cut off, or built to confuse, ends in 512, never in a loop.
function udpLimit(raw) {
    try {
        if (!Buffer.isBuffer(raw) || raw.length < 12) return MIN_UDP;
        let at = 12;
        // a name: labels up to the zero byte, or a pointer (2 bytes); returns the position after it
        const skipName = () => {
            for (let steps = 0; steps < 130; steps++) {
                if (at >= raw.length) throw new Error('cut off');
                const length = raw[at];
                if (length === 0) { at += 1; return; }
                if ((length & 0xc0) === 0xc0) { at += 2; return; }
                if (length > 63) throw new Error('bad label');
                at += 1 + length;
            }
            throw new Error('name too long');
        };
        const need = (bytes) => { if (at + bytes > raw.length) throw new Error('cut off'); };
        for (let i = raw.readUInt16BE(4); i > 0; i--) { skipName(); need(4); at += 4; }
        // records: the answer and authority sections of a question are normally empty; then the additional section
        const records = raw.readUInt16BE(6) + raw.readUInt16BE(8) + raw.readUInt16BE(10);
        const additionalFrom = raw.readUInt16BE(6) + raw.readUInt16BE(8);
        for (let i = 0; i < Math.min(records, 64); i++) {
            skipName();
            need(10);
            const type = raw.readUInt16BE(at);
            const size = raw.readUInt16BE(at + 2);
            if (i >= additionalFrom && type === 41) return Math.min(MAX_UDP, Math.max(MIN_UDP, size));
            at += 10;
            need(raw.readUInt16BE(at - 2));
            at += raw.readUInt16BE(at - 2);
        }
    } catch {
        // a packet that cannot be read gets the smallest size
    }
    return MIN_UDP;
}

// An answer with nothing in it and the TC flag: "ask again over TCP".
function truncate(query) {
    query._answers = [];
    query._anCount = 0;
    query._flags.tc = true;
    query._flags.rcode = 0;
}

// ---- the live state of the server: one limiter, rebuilt when the settings change ----
let limiter = null;
let builtFor = '';
const counts = { dropped: 0, slipped: 0, truncated: 0 };

function currentLimiter(config) {
    const signature = `${config.nsRateLimitPerSecond}/${config.nsRateLimitSlip}`;
    if (!limiter || signature !== builtFor) {
        limiter = createLimiter({ perSecond: config.nsRateLimitPerSecond, slip: config.nsRateLimitSlip });
        builtFor = signature;
    }
    return limiter;
}

// What to do with an answer that is about to be sent: 'send', 'drop' (send nothing) or 'slip' (send it truncated).
// kind: 'answer' (from our own zones / records), 'nxdomain' (no such name in one of our zones), 'refused'.
// `exempt(address)` tells the clients that are not limited (this machine, the trusted resolver clients).
function decide({ config, exempt = () => false }, { address, transport, kind, name, type, zone }) {
    if (!config.nsRateLimitEnabled || transport !== 'udp') return 'send';
    const network = networkOf(address);
    if (network === null) return 'send'; // cannot be limited by a network: the access rules decide for this client
    if (exempt(address)) return 'send';
    // what is counted: the same answer to the same network
    const key = kind === 'refused' ? `${network}|refused` : kind === 'nxdomain' ? `${network}|nxdomain|${zone ?? ''}` : `${network}|answer|${String(name).toLowerCase()}|${type}`;
    const verdict = currentLimiter(config).check(key);
    if (verdict === 'drop') counts.dropped++;
    if (verdict === 'slip') counts.slipped++;
    return verdict === 'allow' ? 'send' : verdict;
}

const noteTruncated = () => { counts.truncated++; };
const state = () => ({ ...counts, tracked: limiter ? limiter.size() : 0 });
function reset() {
    limiter = null;
    builtFor = '';
    counts.dropped = counts.slipped = counts.truncated = 0;
}

module.exports = { networkOf, createLimiter, udpLimit, truncate, decide, noteTruncated, state, reset, MAX_KEYS, MIN_UDP, MAX_UDP };
