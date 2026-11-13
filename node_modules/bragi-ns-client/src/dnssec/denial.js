'use strict';

/**
 * Authenticated denial of existence: what a set of NSEC or NSEC3 records proves.
 * Everything here expects records whose signatures have been verified already.
 */

const {TYPE, textToLabel, splitName, parentName, isSubdomain, nameToWire} = require('./wire');
const {nsec3Hash}                                                         = require('./crypto');

const NSEC3_OPT_OUT = 0x01;

/**
 * @typedef {Object} Nsec
 * @property {string} name - owner
 * @property {string} zone - the zone that signed the record
 * @property {string} nextName
 * @property {Set<number>} types
 */

/**
 * @typedef {Object} Nsec3
 * @property {string} zone - the zone that signed the record
 * @property {Buffer} hash - hashed owner name
 * @property {Buffer} nextHash
 * @property {number} flags
 * @property {number} iterations
 * @property {Buffer} salt
 * @property {Set<number>} types
 */

/**
 * Canonical order of domain names, RFC 4034 6.1.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareNames(a, b) {
    const labelsA = splitName(a);
    const labelsB = splitName(b);
    const common  = Math.min(labelsA.length, labelsB.length);

    for (let i = 1; i <= common; i++) {
        const difference = Buffer.compare(textToLabel(labelsA.at(-i)), textToLabel(labelsB.at(-i)));

        if (difference !== 0) {
            return difference;
        }
    }

    return labelsA.length - labelsB.length;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {string} the longest name both names are below of
 */
function commonAncestor(a, b) {
    const labelsA = splitName(a);
    const labelsB = splitName(b);
    const common  = [];

    for (let i = 1; i <= Math.min(labelsA.length, labelsB.length) && labelsA.at(-i) === labelsB.at(-i); i++) {
        common.unshift(labelsA.at(-i));
    }

    return common.join('.');
}

/**
 * @param {string} name
 * @returns {string}
 */
const wildcardOf = name => name === '' ? '*' : `*.${name}`;

/**
 * A record of the parent side of a zone cut says nothing about the names below it, the same goes for DNAME.
 * RFC 6840 4.1, RFC 5155 8.3.
 *
 * @param {Set<number>} types
 * @returns {boolean}
 */
const isDelegation = types => types.has(TYPE.NS) && !types.has(TYPE.SOA);

/**
 * @param {Set<number>} types
 * @returns {boolean}
 */
const hidesDescendants = types => isDelegation(types) || types.has(TYPE.DNAME);

/**
 * @param {Set<number>} types - types of the name
 * @param {number} type - requested type
 * @returns {boolean} true if the types prove that the name has no data of the requested type
 */
function provesNoData(types, type) {
    if (types.has(type) || types.has(TYPE.CNAME)) {
        return false;
    }

    // The parent side of a zone cut knows only about DS
    return type === TYPE.DS || !isDelegation(types);
}

/**
 * @param {Nsec} nsec
 * @param {string} name
 * @returns {boolean} true if the record proves that the name does not exist
 */
function nsecCovers(nsec, name) {
    if (!isSubdomain(name, nsec.zone) || !isSubdomain(nsec.name, nsec.zone)) {
        return false;
    }

    if (hidesDescendants(nsec.types) && name !== nsec.name && isSubdomain(name, nsec.name)) {
        return false;
    }

    if (compareNames(nsec.name, name) >= 0) {
        return false;
    }

    // The last record of a zone points back to the apex
    return compareNames(nsec.name, nsec.nextName) >= 0 || compareNames(name, nsec.nextName) < 0;
}

/**
 * @param {Nsec[]} nsecs
 * @param {string} name
 * @returns {Nsec|undefined}
 */
const findNsec = (nsecs, name) => nsecs.find(nsec => nsec.name === name && isSubdomain(name, nsec.zone));

/**
 * @param {Nsec[]} nsecs
 * @param {string} name
 * @param {number} type
 * @returns {{result: string, optOut: boolean}|undefined}
 */
function proveNsecDenial(nsecs, name, type) {
    const match = findNsec(nsecs, name);

    if (match) {
        return provesNoData(match.types, type) ? {result: 'nodata', optOut: false} : undefined;
    }

    const cover = nsecs.find(nsec => nsecCovers(nsec, name));

    if (!cover) {
        return;
    }

    // Empty non-terminal: the name has no records, but there are names below it
    if (isSubdomain(cover.nextName, name)) {
        return {result: 'nodata', optOut: false};
    }

    const ancestorA       = commonAncestor(name, cover.name);
    const ancestorB       = commonAncestor(name, cover.nextName);
    const closestEncloser = ancestorA.length > ancestorB.length ? ancestorA : ancestorB;
    const wildcard        = wildcardOf(closestEncloser);
    const wildcardMatch   = findNsec(nsecs, wildcard);

    if (wildcardMatch) {
        return provesNoData(wildcardMatch.types, type) ? {result: 'nodata', optOut: false} : undefined;
    }

    if (nsecs.some(nsec => nsecCovers(nsec, wildcard))) {
        return {result: 'nxdomain', optOut: false};
    }
}

/**
 * NSEC3 records of one zone made with the same parameters.
 */
class Nsec3Chain {
    /**
     * @param {Nsec3[]} records
     */
    constructor(records) {
        const [first] = records;

        this._records = records.filter(record =>
            record.zone === first.zone &&
            record.iterations === first.iterations &&
            record.salt.equals(first.salt)
        );

        this._zone       = first?.zone;
        this._salt       = first?.salt;
        this._iterations = first?.iterations;
        this._hashes     = new Map();
    }

    /**
     * @param {string} name
     * @returns {Buffer}
     */
    _hash(name) {
        if (!this._hashes.has(name)) {
            this._hashes.set(name, nsec3Hash(nameToWire(name), this._salt, this._iterations));
        }

        return this._hashes.get(name);
    }

    /**
     * @param {string} name
     * @returns {Nsec3|undefined} the record of the name
     */
    match(name) {
        if (this._records.length === 0 || !isSubdomain(name, this._zone)) {
            return;
        }

        const hash = this._hash(name);

        return this._records.find(record => record.hash.equals(hash));
    }

    /**
     * @param {string} name
     * @returns {Nsec3|undefined} the record that proves that the name does not exist
     */
    cover(name) {
        if (this._records.length === 0 || !isSubdomain(name, this._zone)) {
            return;
        }

        const hash = this._hash(name);

        return this._records.find(record => {
            const afterOwner = Buffer.compare(record.hash, hash) < 0;
            const beforeNext = Buffer.compare(hash, record.nextHash) < 0;

            // The last record of the chain points back to the first one
            const isLast = Buffer.compare(record.hash, record.nextHash) >= 0;

            return isLast ? afterOwner || beforeNext : afterOwner && beforeNext;
        });
    }

    /**
     * Closest encloser proof, RFC 5155 8.3.
     *
     * @param {string} name - a name that has no record of its own
     * @returns {{closestEncloser: string, cover: Nsec3}|undefined} `cover` proves that the next closer name does
     * not exist
     */
    closestEncloser(name) {
        if (this._records.length === 0 || !isSubdomain(name, this._zone)) {
            return;
        }

        let nextCloser = name;

        while (nextCloser !== this._zone) {
            const candidate = parentName(nextCloser);
            const match     = this.match(candidate);

            if (match) {
                const cover = !hidesDescendants(match.types) && this.cover(nextCloser);

                return cover ? {closestEncloser: candidate, cover} : undefined;
            }

            nextCloser = candidate;
        }
    }
}

/**
 * @param {Nsec3Chain} chain
 * @param {string} name
 * @param {number} type
 * @returns {{result: string, optOut: boolean}|undefined}
 */
function proveNsec3Denial(chain, name, type) {
    const match = chain.match(name);

    if (match) {
        return provesNoData(match.types, type) ? {result: 'nodata', optOut: false} : undefined;
    }

    const proof = chain.closestEncloser(name);

    if (!proof) {
        return;
    }

    const optOut        = Boolean(proof.cover.flags & NSEC3_OPT_OUT);
    const wildcard      = wildcardOf(proof.closestEncloser);
    const wildcardMatch = chain.match(wildcard);

    if (wildcardMatch) {
        return provesNoData(wildcardMatch.types, type) ? {result: 'nodata', optOut} : undefined;
    }

    // An opt-out span may hide an unsigned delegation, there is nothing more to prove about the names in it
    if (chain.cover(wildcard) || optOut) {
        return {result: 'nxdomain', optOut};
    }
}

/**
 * Proves that there is no data of the type at the name.
 *
 * @param {Nsec[]} nsecs
 * @param {Nsec3[]} nsec3s
 * @param {string} name
 * @param {number} type
 * @returns {{result: string, optOut: boolean}|undefined} `result` is `nodata` or `nxdomain`. With `optOut` the proof
 * leaves room for an unsigned delegation, so the answer is not secure. `undefined` means there is no proof.
 */
function proveDenial(nsecs, nsec3s, name, type) {
    return proveNsecDenial(nsecs, name, type) || proveNsec3Denial(new Nsec3Chain(nsec3s), name, type);
}

/**
 * Tells what the denial of a DS record means for the name: `insecure` - an unsigned zone starts there (or may start
 * at or above it), `nocut` - no zone starts there.
 *
 * @param {Nsec[]} nsecs
 * @param {Nsec3[]} nsec3s
 * @param {string} name
 * @returns {string|undefined} `undefined` means there is no proof
 */
function classifyDsDenial(nsecs, nsec3s, name) {
    const chain = new Nsec3Chain(nsec3s);
    const match = findNsec(nsecs, name) || chain.match(name);

    if (match) {
        // Records with SOA belong to the child side of the cut and say nothing about the delegation
        if (match.types.has(TYPE.DS) || match.types.has(TYPE.SOA)) {
            return;
        }

        return match.types.has(TYPE.NS) ? 'insecure' : 'nocut';
    }

    if (nsecs.some(nsec => nsecCovers(nsec, name))) {
        return 'nocut';
    }

    const proof = chain.closestEncloser(name);

    if (proof) {
        return proof.cover.flags & NSEC3_OPT_OUT ? 'insecure' : 'nocut';
    }
}

/**
 * Checks an answer made from a wildcard: nothing may exist between the wildcard and the name, RFC 4035 5.3.4.
 *
 * @param {Nsec[]} nsecs
 * @param {Nsec3[]} nsec3s
 * @param {string} name - owner of the answer
 * @param {number} labels - number of labels of the closest encloser, taken from the signature
 * @returns {boolean}
 */
function provesWildcardExpansion(nsecs, nsec3s, name, labels) {
    const nextCloser = splitName(name).slice(-(labels + 1)).join('.');

    return nsecs.some(nsec => nsecCovers(nsec, name)) || Boolean(new Nsec3Chain(nsec3s).cover(nextCloser));
}

module.exports = {
    compareNames,
    proveDenial,
    classifyDsDenial,
    provesWildcardExpansion
};
