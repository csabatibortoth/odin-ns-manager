'use strict';

/**
 * A tiny signed DNS hierarchy for tests: zones with real keys that sign records, and a fake DNS server
 * which gives prepared responses in the wire format.
 *
 *   .                  Ed25519
 *   test               ECDSA P-256
 *   signed.test        RSA/SHA-256
 *   unsigned.test      not signed
 *
 * Names of `signed.test` in the canonical order: the apex, `alias`, `*.wild`, `www`.
 */

const crypto = require('node:crypto');

const {TYPE, CLASS_IN, nameToWire, splitName, keyTag, decodeMessage} = require('../src/dnssec/wire');

const ALGORITHM_RSASHA256 = 8;
const ALGORITHM_ECDSAP256 = 13;
const ALGORITHM_ED25519   = 15;

const DIGEST_SHA256 = 2;

const u16 = value => {
    const buffer = Buffer.alloc(2);

    buffer.writeUInt16BE(value);

    return buffer;
};

const u32 = value => {
    const buffer = Buffer.alloc(4);

    buffer.writeUInt32BE(value);

    return buffer;
};

const fromBase64Url = text => Buffer.from(text, 'base64url');

/**
 * @param {number[]} types - types below 256
 * @returns {Buffer}
 */
function typeBitmap(types) {
    const bitmap = Buffer.alloc(Math.floor(Math.max(...types) / 8) + 1);

    for (const type of types) {
        bitmap[Math.floor(type / 8)] |= 0x80 >> (type % 8);
    }

    return Buffer.concat([Buffer.from([0, bitmap.length]), bitmap]);
}

const rdata = {
    a:     address => Buffer.from(address.split('.').map(Number)),
    cname: target => nameToWire(target),
    nsec:  (nextName, types) => Buffer.concat([nameToWire(nextName), typeBitmap(types)]),
    nsec3: ({salt, iterations, flags = 0, nextHash, types}) => Buffer.concat([
        Buffer.from([1, flags]),
        u16(iterations),
        Buffer.from([salt.length]),
        salt,
        Buffer.from([nextHash.length]),
        nextHash,
        types.length > 0 ? typeBitmap(types) : Buffer.alloc(0)
    ])
};

class Zone {
    /**
     * @param {string} name
     * @param {number} algorithm
     */
    constructor(name, algorithm = ALGORITHM_ECDSAP256) {
        this.name      = name;
        this.algorithm = algorithm;

        let keys;
        let publicKey;

        switch (algorithm) {
            case ALGORITHM_RSASHA256: {
                keys = crypto.generateKeyPairSync('rsa', {modulusLength: 1024});

                const {e, n}   = keys.publicKey.export({format: 'jwk'});
                const exponent = fromBase64Url(e);

                publicKey = Buffer.concat([Buffer.from([exponent.length]), exponent, fromBase64Url(n)]);

                break;
            }
            case ALGORITHM_ECDSAP256: {
                keys = crypto.generateKeyPairSync('ec', {namedCurve: 'P-256'});

                const {x, y} = keys.publicKey.export({format: 'jwk'});

                publicKey = Buffer.concat([fromBase64Url(x), fromBase64Url(y)]);

                break;
            }
            default:
                keys      = crypto.generateKeyPairSync('ed25519');
                publicKey = fromBase64Url(keys.publicKey.export({format: 'jwk'}).x);
        }

        this._privateKey = keys.privateKey;

        // Flags: zone key and secure entry point. Protocol: 3
        this.dnskeyRdata = Buffer.concat([u16(257), Buffer.from([3, algorithm]), publicKey]);
        this.keyTag      = keyTag(this.dnskeyRdata);
    }

    /**
     * @returns {Buffer}
     */
    digest() {
        return crypto.createHash('sha256').update(nameToWire(this.name)).update(this.dnskeyRdata).digest();
    }

    /**
     * @returns {Buffer} RDATA of the DS record the parent zone has
     */
    dsRdata() {
        return Buffer.concat([u16(this.keyTag), Buffer.from([this.algorithm, DIGEST_SHA256]), this.digest()]);
    }

    /**
     * @returns {Object} trust anchor
     */
    anchor() {
        return {keyTag: this.keyTag, algorithm: this.algorithm, digestType: DIGEST_SHA256, digest: this.digest()};
    }

    /**
     * @param {Buffer} data
     * @returns {Buffer}
     */
    _sign(data) {
        switch (this.algorithm) {
            case ALGORITHM_RSASHA256:
                return crypto.sign('sha256', data, this._privateKey);
            case ALGORITHM_ECDSAP256:
                return crypto.sign('sha256', data, {key: this._privateKey, dsaEncoding: 'ieee-p1363'});
            default:
                return crypto.sign(null, data, this._privateKey);
        }
    }

    /**
     * Makes a record set with its signature.
     *
     * @param {string} name
     * @param {number} type
     * @param {Buffer[]} rdatas
     * @param {Object} [options]
     * @param {number} [options.ttl]
     * @param {boolean} [options.signed] - false: no signature
     * @param {string} [options.wildcard] - the wildcard name the records are made from
     * @param {number} [options.inception] - seconds
     * @param {number} [options.expiration] - seconds
     * @returns {Object[]} records
     */
    records(name, type, rdatas, {ttl = 300, signed = true, wildcard, inception, expiration} = {}) {
        const records = rdatas.map(rdata => ({name, type, ttl, rdata}));

        if (!signed) {
            return records;
        }

        const now        = Math.floor(Date.now() / 1000);
        const signedName = wildcard ?? name;
        const labels     = splitName(signedName).filter(label => label !== '*').length;

        const prefix = Buffer.concat([
            u16(type),
            Buffer.from([this.algorithm, labels]),
            u32(ttl),
            u32(expiration ?? now + 86400),
            u32(inception ?? now - 3600),
            u16(this.keyTag),
            nameToWire(this.name)
        ]);

        const signedRecords = [...rdatas].sort(Buffer.compare).map(rdata => Buffer.concat([
            nameToWire(signedName),
            u16(type),
            u16(CLASS_IN),
            u32(ttl),
            u16(rdata.length),
            rdata
        ]));

        const signature = this._sign(Buffer.concat([prefix, ...signedRecords]));

        records.push({name, type: TYPE.RRSIG, ttl, rdata: Buffer.concat([prefix, signature])});

        return records;
    }

    /**
     * @param {string} name
     * @param {string} nextName
     * @param {number[]} types
     * @returns {Object[]} signed NSEC record
     */
    nsec(name, nextName, types) {
        return this.records(name, TYPE.NSEC, [rdata.nsec(nextName, types)]);
    }
}

/**
 * @param {Object} message
 * @param {string} message.name
 * @param {number} message.type
 * @param {number} [message.id]
 * @param {number} [message.rcode]
 * @param {boolean} [message.ad]
 * @param {boolean} [message.tc]
 * @param {Object[]} [message.answer]
 * @param {Object[]} [message.authority]
 * @returns {Buffer} a DNS response
 */
function encodeResponse({name, type, id = 0, rcode = 0, ad = false, tc = false, answer = [], authority = []}) {
    const header = Buffer.alloc(12);

    header.writeUInt16BE(id, 0);
    header.writeUInt16BE(0x8180 | (tc ? 0x0200 : 0) | (ad ? 0x0020 : 0) | rcode, 2);
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(answer.length, 6);
    header.writeUInt16BE(authority.length, 8);

    const encodeRecord = record => Buffer.concat([
        nameToWire(record.name),
        u16(record.type),
        u16(CLASS_IN),
        u32(record.ttl),
        u16(record.rdata.length),
        record.rdata
    ]);

    return Buffer.concat([
        header,
        nameToWire(name),
        u16(type),
        u16(CLASS_IN),
        ...answer.map(encodeRecord),
        ...authority.map(encodeRecord)
    ]);
}

/**
 * Fake DNS server.
 */
class World {
    constructor() {
        this._responses = new Map();

        /** @type {string[]} every query made, `name/TYPE` */
        this.queries = [];

        this.query = async (name, type) => {
            const key = `${name}/${type}`;

            this.queries.push(key);

            if (!this._responses.has(key)) {
                throw new Error(`unexpected DNS query ${key}`);
            }

            return decodeMessage(encodeResponse({name, type, ...this._responses.get(key)}));
        };
    }

    /**
     * @param {string} name
     * @param {number} type
     * @param {Object} response - `rcode`, `ad`, `answer`, `authority`
     */
    set(name, type, response) {
        this._responses.set(`${name}/${type}`, response);
    }
}

/**
 * @returns {{world: World, root: Zone, test: Zone, signed: Zone, trustAnchors: Object[]}}
 */
function createWorld() {
    const world  = new World();
    const root   = new Zone('', ALGORITHM_ED25519);
    const test   = new Zone('test', ALGORITHM_ECDSAP256);
    const signed = new Zone('signed.test', ALGORITHM_RSASHA256);

    world.set('', TYPE.DNSKEY, {answer: root.records('', TYPE.DNSKEY, [root.dnskeyRdata])});

    world.set('test', TYPE.DS, {answer: root.records('test', TYPE.DS, [test.dsRdata()])});
    world.set('test', TYPE.DNSKEY, {answer: test.records('test', TYPE.DNSKEY, [test.dnskeyRdata])});

    world.set('signed.test', TYPE.DS, {answer: test.records('signed.test', TYPE.DS, [signed.dsRdata()])});
    world.set('signed.test', TYPE.DNSKEY, {
        answer: signed.records('signed.test', TYPE.DNSKEY, [signed.dnskeyRdata])
    });

    // An unsigned delegation: the parent proves that there is no DS record
    world.set('unsigned.test', TYPE.DS, {
        authority: test.nsec('unsigned.test', 'test', [TYPE.NS, TYPE.RRSIG, TYPE.NSEC])
    });

    return {world, root, test, signed, trustAnchors: [root.anchor()]};
}

module.exports = {
    ALGORITHM_RSASHA256,
    ALGORITHM_ECDSAP256,
    ALGORITHM_ED25519,
    Zone,
    World,
    rdata,
    encodeResponse,
    createWorld
};
