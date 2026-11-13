'use strict';

/**
 * DNSSEC cryptography on top of `node:crypto`: signatures, DS digests and NSEC3 hashes.
 */

const crypto = require('node:crypto');

/**
 * DNSSEC signature algorithms, by their IANA numbers.
 */
const ALGORITHMS = {
    5:  {kind: 'rsa', hash: 'sha1'}, // RSASHA1
    7:  {kind: 'rsa', hash: 'sha1'}, // RSASHA1-NSEC3-SHA1
    8:  {kind: 'rsa', hash: 'sha256'}, // RSASHA256
    10: {kind: 'rsa', hash: 'sha512'}, // RSASHA512
    13: {kind: 'ec', hash: 'sha256', curve: 'P-256', size: 32}, // ECDSAP256SHA256
    14: {kind: 'ec', hash: 'sha384', curve: 'P-384', size: 48}, // ECDSAP384SHA384
    15: {kind: 'ed', curve: 'Ed25519', size: 32}, // ED25519
    16: {kind: 'ed', curve: 'Ed448', size: 57} // ED448
};

/**
 * DS digest algorithms, by their IANA numbers.
 */
const DIGESTS = {
    1: 'sha1',
    2: 'sha256',
    4: 'sha384'
};

const NSEC3_HASH_SHA1 = 1;

/**
 * @param {number} algorithm
 * @returns {boolean}
 */
const isSupportedAlgorithm = algorithm => Object.hasOwn(ALGORITHMS, algorithm);

/**
 * @param {number} digestType
 * @returns {boolean}
 */
const isSupportedDigest = digestType => Object.hasOwn(DIGESTS, digestType);

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
const base64url = buffer => buffer.toString('base64url');

/**
 * @param {number} algorithm
 * @param {Buffer} publicKey - public key field of a DNSKEY record
 * @returns {Object|undefined} JSON Web Key
 */
function toJwk(algorithm, publicKey) {
    const spec = ALGORITHMS[algorithm];

    switch (spec.kind) {
        case 'rsa': {
            // RFC 3110: exponent length in 1 or 3 bytes, exponent, modulus
            let offset         = 1;
            let exponentLength = publicKey[0];

            if (exponentLength === 0) {
                if (publicKey.length < 3) {
                    return;
                }

                exponentLength = publicKey.readUInt16BE(1);
                offset         = 3;
            }

            const exponent = publicKey.subarray(offset, offset + exponentLength);
            const modulus  = publicKey.subarray(offset + exponentLength);

            if (exponent.length !== exponentLength || exponentLength === 0 || modulus.length === 0) {
                return;
            }

            return {kty: 'RSA', n: base64url(modulus), e: base64url(exponent)};
        }
        case 'ec':
            if (publicKey.length !== spec.size * 2) {
                return;
            }

            return {
                kty: 'EC',
                crv: spec.curve,
                x:   base64url(publicKey.subarray(0, spec.size)),
                y:   base64url(publicKey.subarray(spec.size))
            };
        default:
            if (publicKey.length !== spec.size) {
                return;
            }

            return {kty: 'OKP', crv: spec.curve, x: base64url(publicKey)};
    }
}

/**
 * @param {number} algorithm
 * @param {Buffer} publicKey - public key field of a DNSKEY record
 * @returns {KeyObject|undefined} undefined if the key is malformed or the algorithm is not supported
 */
function createPublicKey(algorithm, publicKey) {
    if (!isSupportedAlgorithm(algorithm)) {
        return;
    }

    try {
        const jwk = toJwk(algorithm, publicKey);

        return jwk && crypto.createPublicKey({key: jwk, format: 'jwk'});
    } catch {
        return;
    }
}

/**
 * @param {number} algorithm
 * @param {KeyObject} key
 * @param {Buffer} data
 * @param {Buffer} signature - signature field of an RRSIG record
 * @returns {boolean}
 */
function verifySignature(algorithm, key, data, signature) {
    const spec = ALGORITHMS[algorithm];

    try {
        switch (spec.kind) {
            case 'rsa':
                return crypto.verify(spec.hash, data, key, signature);
            case 'ec':
                // RFC 6605: the signature is r | s, not DER
                return signature.length === spec.size * 2 &&
                    crypto.verify(spec.hash, data, {key, dsaEncoding: 'ieee-p1363'}, signature);
            default:
                return crypto.verify(null, data, key, signature);
        }
    } catch {
        return false;
    }
}

/**
 * Digest of a DS record, RFC 4034 5.1.4.
 *
 * @param {number} digestType
 * @param {Buffer} ownerWire - canonical name of the DNSKEY owner
 * @param {Buffer} dnskeyRdata
 * @returns {Buffer}
 */
function dsDigest(digestType, ownerWire, dnskeyRdata) {
    return crypto.createHash(DIGESTS[digestType]).update(ownerWire).update(dnskeyRdata).digest();
}

/**
 * Hashed owner name, RFC 5155 5.
 *
 * @param {Buffer} nameWire - canonical name
 * @param {Buffer} salt
 * @param {number} iterations - additional iterations
 * @returns {Buffer}
 */
function nsec3Hash(nameWire, salt, iterations) {
    let hash = nameWire;

    for (let i = 0; i <= iterations; i++) {
        hash = crypto.createHash('sha1').update(hash).update(salt).digest();
    }

    return hash;
}

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

/**
 * @param {string} text - base32hex without padding
 * @returns {Buffer|undefined} undefined if the text is not valid
 */
function base32hexDecode(text) {
    const bytes = [];

    let bits  = 0;
    let value = 0;

    for (const char of text.toLowerCase()) {
        const index = BASE32HEX.indexOf(char);

        if (index === -1) {
            return;
        }

        value = (value << 5) | index;
        bits += 5;

        if (bits >= 8) {
            bits -= 8;

            bytes.push((value >> bits) & 0xff);
        }

        value &= 0xff;
    }

    return Buffer.from(bytes);
}

module.exports = {
    NSEC3_HASH_SHA1,
    isSupportedAlgorithm,
    isSupportedDigest,
    createPublicKey,
    verifySignature,
    dsDigest,
    nsec3Hash,
    base32hexDecode
};
