const crypto = require('crypto');
const fs = require('fs');
const net = require('net');

const { visibleOnAuthoritative, visibleOnPublicResolvers } = require('./dnsChallenge');

// DNS-01 provider "rfc2136": the TXT record of the challenge is written with a DNS UPDATE (RFC 2136) signed with a TSIG key
// (RFC 8945) to the name server that is the master of the zone (BIND, Knot, PowerDNS, an Aesir/Freya master ...).
// See dnsChallenge.js for the interface.
//
// Security rules of this file:
//  - The key secret (FREYA_ACME_RFC2136_KEY_SECRET, or the first line of FREYA_ACME_RFC2136_KEY_FILE) is never written to a log
//    or to an error message. It is used only to sign.
//  - Only HMAC-SHA256/384/512 keys are accepted (no MD5, no SHA-1).
//  - TCP only (an update is never sent over UDP), with a time limit. The answer MUST carry a valid TSIG of the same key:
//    an unsigned or wrongly signed "success" is an error, so a man in the middle cannot make a failed update look good.
//  - Only TXT records named _acme-challenge.* inside the configured zone are added, and only the exact value written
//    is removed (the "delete this one record" form of RFC 2136, never "delete the whole record set").
//  - The server, zone and key name come from the configuration, never from the data of an order.
//
// Unit tests use a fake server that verifies the signature on its own; the real thing was checked against BIND 9 (see the
// release notes of freya 2.6.0).

const PREFIX = '_acme-challenge.';
const TTL = 60;
const TIMEOUT_MS = 15000;
const FUDGE = 300; // seconds of clock difference that are accepted, the usual value
const MAX_MESSAGE = 65535;

const TYPE = { SOA: 6, TXT: 16, TSIG: 250 };
const CLASS = { IN: 1, NONE: 254, ANY: 255 };
const OPCODE_UPDATE = 5;
const RCODE = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED', 6: 'YXDOMAIN', 7: 'YXRRSET', 8: 'NXRRSET', 9: 'NOTAUTH', 10: 'NOTZONE', 16: 'BADSIG', 17: 'BADKEY', 18: 'BADTIME' };

// TSIG algorithm name -> hash of node:crypto. The name is what goes on the wire (RFC 8945 section 6).
const ALGORITHMS = { 'hmac-sha256': 'sha256', 'hmac-sha384': 'sha384', 'hmac-sha512': 'sha512' };

const LABEL = /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/;

// A name as a list of labels, validated: lower case, no empty label, at most 63 octets per label and 253 in all.
function labelsOf(name) {
    const text = String(name).toLowerCase().replace(/\.$/, '');
    const labels = text.split('.');
    if (!text || text.length > 253 || labels.some((label) => !LABEL.test(label))) throw new Error(`Not a valid DNS name: ${String(name).slice(0, 80)}`);
    return labels;
}

function nameToWire(name) {
    const parts = labelsOf(name).map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label, 'ascii')]));
    return Buffer.concat([...parts, Buffer.from([0])]);
}

const u16 = (n) => {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    return b;
};
const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
};
const u48 = (n) => {
    const b = Buffer.alloc(6);
    b.writeUIntBE(n, 0, 6);
    return b;
};

// TXT rdata: one or more <character-string>s of at most 255 octets.
function txtRdata(text) {
    const data = Buffer.from(text, 'utf8');
    const parts = [];
    for (let at = 0; at < data.length || at === 0; at += 255) {
        const part = data.subarray(at, at + 255);
        parts.push(Buffer.concat([Buffer.from([part.length]), part]));
    }
    return Buffer.concat(parts);
}

function resourceRecord(name, type, klass, ttl, rdata) {
    return Buffer.concat([nameToWire(name), u16(type), u16(klass), u32(ttl), u16(rdata.length), rdata]);
}

// The header + sections of a DNS UPDATE for `zone`: an `adds` list and a `deletes` list of { name, value } (TXT).
function buildUpdate({ id, zone, adds = [], deletes = [] }) {
    const header = Buffer.concat([u16(id), u16(OPCODE_UPDATE << 11), u16(1), u16(0), u16(adds.length + deletes.length), u16(0)]);
    const zoneSection = Buffer.concat([nameToWire(zone), u16(TYPE.SOA), u16(CLASS.IN)]);
    const updates = [
        // "Delete an RR from an RRset": class NONE, ttl 0, the exact rdata. Other values at the same name stay.
        ...deletes.map(({ name, value }) => resourceRecord(name, TYPE.TXT, CLASS.NONE, 0, txtRdata(value))),
        ...adds.map(({ name, value }) => resourceRecord(name, TYPE.TXT, CLASS.IN, TTL, txtRdata(value))),
    ];
    return Buffer.concat([header, zoneSection, ...updates]);
}

// The data the MAC is computed over after the message (RFC 8945 section 4.3.3): the TSIG RR without the MAC.
function tsigVariables({ keyName, algorithm, timeSigned, fudge, error = 0, other = Buffer.alloc(0) }) {
    return Buffer.concat([nameToWire(keyName), u16(CLASS.ANY), u32(0), nameToWire(algorithm), u48(timeSigned), u16(fudge), u16(error), u16(other.length), other]);
}

const mac = (hash, secret, ...parts) => crypto.createHmac(hash, secret).update(Buffer.concat(parts)).digest();

// Signs a message: returns the message with the TSIG record appended (ARCOUNT + 1) and the MAC (needed to check the answer).
function sign(message, { keyName, algorithm, secret, now }) {
    const hash = ALGORITHMS[algorithm];
    const timeSigned = Math.floor(now / 1000);
    const signature = mac(hash, secret, message, tsigVariables({ keyName, algorithm, timeSigned, fudge: FUDGE }));
    const id = message.readUInt16BE(0);
    const rdata = Buffer.concat([nameToWire(algorithm), u48(timeSigned), u16(FUDGE), u16(signature.length), signature, u16(id), u16(0), u16(0)]);
    const signed = Buffer.concat([message, resourceRecord(keyName, TYPE.TSIG, CLASS.ANY, 0, rdata)]);
    signed.writeUInt16BE(message.readUInt16BE(10) + 1, 10);
    return { signed, mac: signature };
}

// ---- reading an answer ----

// A name at `at`, with the compression pointers of RFC 1035. Returns { name, next }. Loops and overlong names are refused.
function readName(buffer, at) {
    const labels = [];
    let next = -1;
    let hops = 0;
    for (;;) {
        if (at >= buffer.length) throw new Error('The DNS answer is cut off');
        const length = buffer[at];
        if (length === 0) {
            at += 1;
            break;
        }
        if ((length & 0xc0) === 0xc0) {
            if (at + 1 >= buffer.length) throw new Error('The DNS answer is cut off');
            if (next < 0) next = at + 2;
            at = ((length & 0x3f) << 8) | buffer[at + 1];
            if (++hops > 20) throw new Error('The DNS answer has a name that loops');
            continue;
        }
        if (length > 63) throw new Error('The DNS answer has a bad label');
        if (at + 1 + length > buffer.length) throw new Error('The DNS answer is cut off');
        labels.push(buffer.toString('ascii', at + 1, at + 1 + length).toLowerCase());
        at += 1 + length;
        if (labels.length > 127) throw new Error('The DNS answer has a name that is too long');
    }
    return { name: labels.join('.'), next: next < 0 ? at : next };
}

// The records of an answer: { header, records[] } with { name, type, klass, ttl, rdataAt, rdataLength, start }.
function parseMessage(buffer) {
    if (buffer.length < 12) throw new Error('The DNS answer is too short');
    const header = { id: buffer.readUInt16BE(0), flags: buffer.readUInt16BE(2), counts: [4, 6, 8, 10].map((at) => buffer.readUInt16BE(at)) };
    header.rcode = header.flags & 0x0f;
    header.opcode = (header.flags >> 11) & 0x0f;
    header.response = Boolean(header.flags & 0x8000);
    let at = 12;
    for (let i = 0; i < header.counts[0]; i++) {
        at = readName(buffer, at).next + 4;
    }
    const records = [];
    const total = header.counts[1] + header.counts[2] + header.counts[3];
    for (let i = 0; i < total; i++) {
        const start = at;
        const { name, next } = readName(buffer, at);
        if (next + 10 > buffer.length) throw new Error('The DNS answer is cut off');
        const rdataLength = buffer.readUInt16BE(next + 8);
        if (next + 10 + rdataLength > buffer.length) throw new Error('The DNS answer is cut off');
        records.push({ name, type: buffer.readUInt16BE(next), klass: buffer.readUInt16BE(next + 2), ttl: buffer.readUInt32BE(next + 4), rdataAt: next + 10, rdataLength, start });
        at = next + 10 + rdataLength;
    }
    return { header, records };
}

// Checks the TSIG of an answer (RFC 8945 section 5.3): the key, the algorithm, the time and the MAC (which covers the request's MAC
// first). Returns nothing, or throws a sentence for the person who set it up.
function verifyAnswer(buffer, parsed, request, { keyName, algorithm, secret, now }) {
    const tsig = parsed.records[parsed.records.length - 1];
    if (!tsig || tsig.type !== TYPE.TSIG) throw new Error('The name server answered without a TSIG signature: it does not know this key, or something is between you and it. The answer was not trusted.');
    if (tsig.name !== keyName.toLowerCase().replace(/\.$/, '')) throw new Error('The answer is signed with another key than the one configured');
    let at = tsig.rdataAt;
    const alg = readName(buffer, at);
    at = alg.next;
    if (alg.name !== algorithm) throw new Error('The answer is signed with another algorithm than the one configured');
    const timeSigned = buffer.readUIntBE(at, 6);
    const fudge = buffer.readUInt16BE(at + 6);
    const macSize = buffer.readUInt16BE(at + 8);
    const received = buffer.subarray(at + 10, at + 10 + macSize);
    at += 10 + macSize;
    const originalId = buffer.readUInt16BE(at);
    const error = buffer.readUInt16BE(at + 2);
    const otherLength = buffer.readUInt16BE(at + 4);
    const other = buffer.subarray(at + 6, at + 6 + otherLength);
    // The message as the server signed it: without the TSIG record, the count one lower, the original id.
    const body = Buffer.from(buffer.subarray(0, tsig.start));
    body.writeUInt16BE(parsed.header.counts[3] - 1, 10);
    body.writeUInt16BE(originalId, 0);
    const expected = mac(ALGORITHMS[algorithm], secret, u16(request.mac.length), request.mac, body, tsigVariables({ keyName, algorithm, timeSigned, fudge, error, other }));
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
        throw new Error('The signature of the answer is wrong: the key secret differs from the one of the name server, or the answer was changed on its way');
    }
    if (Math.abs(Math.floor(now / 1000) - timeSigned) > fudge) throw new Error('The time of the answer differs by more than five minutes from this computer: check the clocks');
    if (originalId !== request.id) throw new Error('The answer belongs to another request');
}

// One request and one answer over TCP (a 2-byte length in front of each message, RFC 1035 section 4.2.2).
function exchange({ host, port, message, timeout, connect = net.connect }) {
    return new Promise((resolve, reject) => {
        const socket = connect({ host, port });
        const chunks = [];
        let size = 0;
        let settled = false;
        const finish = (err, value) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            err ? reject(err) : resolve(value);
        };
        socket.setTimeout(timeout, () => finish(new Error(`The name server did not answer in ${Math.round(timeout / 1000)} seconds`)));
        socket.on('error', (err) => finish(new Error(`The name server could not be reached (${err.code || err.name})`)));
        socket.on('connect', () => socket.write(Buffer.concat([u16(message.length), message])));
        socket.on('data', (chunk) => {
            chunks.push(chunk);
            size += chunk.length;
            const all = Buffer.concat(chunks);
            if (all.length >= 2) {
                const wanted = all.readUInt16BE(0);
                if (wanted > MAX_MESSAGE) return finish(new Error('The DNS answer is too long'));
                if (all.length >= 2 + wanted) return finish(null, all.subarray(2, 2 + wanted));
            }
            if (size > MAX_MESSAGE + 2) finish(new Error('The DNS answer is too long'));
        });
        socket.on('close', () => finish(new Error('The name server closed the connection without an answer')));
    });
}

// The key file of the secret: refused unless only root or the user of this server can read it (a key that others can read lets them change
// the DNS records the key is allowed to change). The path is resolved (symlinks followed) and the real file is checked and read.
// Windows: file permissions are ACLs, which are not read here: use FREYA_ACME_RFC2136_KEY_SECRET (the environment) there.
function readKeyFile(file, { fsApi = fs, uid = process.getuid ? process.getuid() : null, platform = process.platform } = {}) {
    if (platform === 'win32') {
        throw new Error('A key file is not supported on Windows (its permissions cannot be checked): set FREYA_ACME_RFC2136_KEY_SECRET instead.');
    }
    let real;
    try {
        real = fsApi.realpathSync(file);
    } catch {
        throw new Error('FREYA_ACME_RFC2136_KEY_FILE does not exist');
    }
    const info = fsApi.statSync(real);
    if (!info.isFile()) throw new Error('FREYA_ACME_RFC2136_KEY_FILE must be a regular file');
    if (info.mode & 0o077) {
        throw new Error('The key file can be read or changed by group or others: chmod 600 it (the key lets anybody who reads it change the DNS records it is allowed to change).');
    }
    if (info.uid !== 0 && info.uid !== uid) throw new Error('The key file belongs to another user than root or the user of this server');
    return fsApi.readFileSync(real, 'utf8').split(/\r?\n/)[0];
}

function readSecret({ secret, secretFile, ...checks }) {
    const value = secret || (secretFile ? readKeyFile(secretFile, checks) : '');
    const clean = String(value).trim();
    if (!clean) {
        throw new Error('The rfc2136 provider needs the TSIG key secret: set FREYA_ACME_RFC2136_KEY_SECRET, or FREYA_ACME_RFC2136_KEY_FILE (a file whose first line is the base64 secret).');
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new Error('The TSIG key secret must be base64 (as in a BIND "secret" line)');
    const raw = Buffer.from(clean, 'base64');
    if (raw.length < 16) throw new Error('The TSIG key secret is too short (at least 16 bytes): generate one with tsig-keygen');
    return raw;
}

// "host", "host:port", "[v6]" or "[v6]:port" -> { host, port }
function parseServer(value) {
    const text = String(value || '').trim();
    const match = /^(?:\[([0-9a-fA-F:.]+)\]|([A-Za-z0-9._-]+))(?::(\d{1,5}))?$/.exec(text);
    if (!match) throw new Error('FREYA_ACME_RFC2136_SERVER must be a host name or an address, with an optional :port (the master name server of the zone)');
    const port = match[3] ? Number(match[3]) : 53;
    if (port < 1 || port > 65535) throw new Error('FREYA_ACME_RFC2136_SERVER has a bad port');
    return { host: match[1] || match[2], port };
}

// options: { server, zone, keyName, algorithm, secret, secretFile, timeout, connect, now } - connect, now and timeout are for the tests.
function createProvider(options = {}) {
    const { host, port } = parseServer(options.server);
    const zone = options.zone ? labelsOf(options.zone).join('.') : '';
    if (!zone) throw new Error('The rfc2136 provider needs the zone to update: set FREYA_ACME_RFC2136_ZONE (for example example.com)');
    const keyName = labelsOf(options.keyName || '').join('.');
    const algorithm = String(options.algorithm || 'hmac-sha256').toLowerCase().replace(/\.$/, '');
    if (!Object.hasOwn(ALGORITHMS, algorithm)) {
        throw new Error(`FREYA_ACME_RFC2136_KEY_ALGORITHM must be one of ${Object.keys(ALGORITHMS).join(', ')} (older algorithms are refused): ${algorithm}`);
    }
    const secret = readSecret(options);
    const timeout = options.timeout || TIMEOUT_MS;
    const now = options.now || Date.now;
    const connect = options.connect || net.connect;

    function check(name, value) {
        if (typeof name !== 'string' || !name.toLowerCase().startsWith(PREFIX) || name.length <= PREFIX.length) {
            throw new Error(`Only names that start with ${PREFIX} can be written: ${String(name).slice(0, 80)}`);
        }
        const lower = labelsOf(name).join('.');
        if (lower !== zone && !lower.endsWith(`.${zone}`)) throw new Error(`${lower} is not inside the zone ${zone} that this provider updates`);
        if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('The value of a challenge record has the wrong form');
    }

    async function update({ adds = [], deletes = [] }) {
        const id = crypto.randomInt(0, 65536);
        const request = sign(buildUpdate({ id, zone, adds, deletes }), { keyName, algorithm, secret, now: now() });
        const buffer = await exchange({ host, port, message: request.signed, timeout, connect });
        const parsed = parseMessage(buffer);
        if (!parsed.header.response || parsed.header.opcode !== OPCODE_UPDATE || parsed.header.id !== id) throw new Error('The name server sent an answer that does not belong to this request');
        const rcode = parsed.header.rcode;
        // An error answer may come unsigned (the server could not even find the key): say what it means, but do not call it trusted.
        if (rcode === 9 || rcode === 5 || rcode === 17 || rcode === 16) {
            throw new Error(
                `The name server answered ${RCODE[rcode]} (not authorized): check that the key ${keyName} is allowed to update ${zone}, and that name, algorithm and secret are the same on both sides.`
            );
        }
        verifyAnswer(buffer, parsed, { id, mac: request.mac }, { keyName, algorithm, secret, now: now() });
        if (rcode !== 0) throw new Error(`The name server answered ${RCODE[rcode] || `rcode ${rcode}`} to the update of ${zone}`);
    }

    return {
        async create(name, value) {
            check(name, value);
            // A retry that finds its own record gets no error: adding an existing record is allowed and changes nothing (RFC 2136 section 3.4.2.2).
            await update({ adds: [{ name, value }] });
        },

        async remove(name, value) {
            check(name, value);
            // Deleting a record that is not there is also fine (3.4.2.4): the wanted state is "gone".
            await update({ deletes: [{ name, value }] });
        },

        // Published when the authoritative servers of the zone have it (no cache in between); the public resolvers are the fallback.
        async visible(name, value) {
            const published = await visibleOnAuthoritative(name, value);
            return published ?? visibleOnPublicResolvers(name, value);
        },
    };
}

module.exports = { createProvider, parseServer, buildUpdate, sign, parseMessage, verifyAnswer, nameToWire, ALGORITHMS, RCODE };
