'use strict';

const {TYPE, CLASS_IN, splitName, isSubdomain, nameToWire, rrsetKey, groupRRsets} = require('./wire');
const {BOGUS, RCODE_ERRORS, DnsError, bogus}                                      = require('./errors');
const {proveDenial, classifyDsDenial, provesWildcardExpansion}                    = require('./denial');
const {
    NSEC3_HASH_SHA1,
    isSupportedAlgorithm,
    isSupportedDigest,
    createPublicKey,
    verifySignature,
    dsDigest,
    base32hexDecode
} = require('./crypto');

const RCODE_NOERROR  = 0;
const RCODE_NXDOMAIN = 3;

const DNSKEY_ZONE_KEY = 0x0100;
const DNSKEY_REVOKED  = 0x0080;
const DNSKEY_PROTOCOL = 3;

const DIGEST_SHA1 = 1;

const NSEC3_KNOWN_FLAGS = 0x01;

// RFC 9276: zones with more iterations are treated as unsigned
const MAX_NSEC3_ITERATIONS = 150;

// Signature checks per record set. A forged response cannot make the validator burn CPU (CVE-2023-50387)
const MAX_VERIFICATIONS = 8;

const MAX_CNAMES = 16;

// Seconds. Validated data is never trusted longer than this
const MAX_TTL = 86400;

const MAX_CACHE_SIZE = 5000;

const TYPE_NAMES = Object.fromEntries(Object.entries(TYPE).map(([name, type]) => [type, name]));

/**
 * @param {string} name
 * @returns {string}
 */
const display = name => name === '' ? 'the root zone' : name;

/**
 * @typedef {Object} Zone
 * @property {string} name
 * @property {DnsRecord[]} keys - DNSKEY records the zone may sign with
 * @property {number} expiresAt
 */

/**
 * Validates DNS answers the way RFC 4035 section 5 tells: every record set must be signed by a key of its zone,
 * and the keys of every zone must be vouched for by its parent, up to the root trust anchors.
 */
class Validator {
    /**
     * @param {Object} options
     * @param {Function} options.query - `(name, type) => Promise<DnsMessage>`, the answers must come with the DNSSEC
     * records
     * @param {Object[]} options.trustAnchors - DS records of the root zone
     * @param {Function} [options.now] - current time in milliseconds
     */
    constructor({query, trustAnchors, now = Date.now}) {
        this._queryServer = query;
        this._now         = now;

        this._trustAnchors = trustAnchors.map(anchor => ({
            ...anchor,
            digest: Buffer.isBuffer(anchor.digest) ? anchor.digest : Buffer.from(anchor.digest, 'hex')
        }));

        /** @type {Map<string, {promise: Promise, expiresAt: number}>} */
        this._cache = new Map();
    }

    /**
     * Resolves and validates records of the type, following CNAME and DNAME records.
     *
     * `secure` of the result is `false` if the answer comes from a zone that is proven to be unsigned.
     *
     * @param {string} name
     * @param {number} type
     * @throws {DnsError} with the `EDNSSEC_BOGUS` code if the answer fails validation
     * @returns {Promise<{records: DnsRecord[], secure: boolean, expiresAt: number}|{negative: boolean,
     * nxdomain: boolean, secure: boolean}>}
     */
    async resolve(name, type) {
        const message = await this._query(name, type);
        const answer  = groupRRsets(message.answer);

        let proofsPromise;

        // Records that fail validation prove nothing and are left out
        const proofs = () => proofsPromise ??= this._collectProofs(message, async rrset => {
            try {
                return await this._validate(rrset);
            } catch (error) {
                if (error.code === BOGUS) {
                    return false;
                }

                throw error;
            }
        });

        let secure    = true;
        let expiresAt = Infinity;
        let current   = name;

        const accept = async rrset => {
            if (!await this._validate(rrset)) {
                secure    = false;
                expiresAt = Math.min(expiresAt, this._now() + Math.min(rrset.ttl, MAX_TTL) * 1000);

                return;
            }

            if (rrset.wildcardLabels !== undefined) {
                const {nsecs, nsec3s} = await proofs();

                if (!provesWildcardExpansion(nsecs, nsec3s, rrset.name, rrset.wildcardLabels)) {
                    throw bogus(`no valid proof that ${rrset.name} may be answered from a wildcard`);
                }
            }

            expiresAt = Math.min(expiresAt, rrset.expiresAt);
        };

        for (let hops = 0; hops <= MAX_CNAMES; hops++) {
            const rrset = answer.get(rrsetKey(current, type));

            if (rrset) {
                await accept(rrset);

                return {records: rrset.records, secure, expiresAt};
            }

            const cname = answer.get(rrsetKey(current, TYPE.CNAME));

            if (!cname) {
                return this._validateDenial(message, current, type, secure, await proofs());
            }

            if (cname.records.length !== 1) {
                throw new DnsError('EBADRESP', `several CNAME records for ${current}`);
            }

            const {target} = cname.records[0].data;

            // A CNAME made from a DNAME is not signed, the DNAME is
            const dname = cname.rrsigs.length === 0 && this._findDname(answer, current, target);

            await accept(dname || cname);

            current = target;
        }

        throw new DnsError('EBADRESP', `CNAME chain of ${name} is too long`);
    }

    /**
     * @param {DnsMessage} message
     * @param {string} name
     * @param {number} type
     * @param {boolean} secure - false if the CNAME chain to the name is not secure
     * @param {Object} proofs
     * @returns {Promise<{negative: boolean, nxdomain: boolean, secure: boolean}>}
     * @private
     */
    async _validateDenial(message, name, type, secure, proofs) {
        const nxdomain = message.rcode === RCODE_NXDOMAIN;
        const denial   = proveDenial(proofs.nsecs, proofs.nsec3s, name, type);

        if (denial) {
            return {negative: true, nxdomain, secure: secure && !denial.optOut};
        }

        // Without a proof the answer is fine only if the name is in an unsigned zone
        if (proofs.limited || (await this._findZone(name)).insecure) {
            return {negative: true, nxdomain, secure: false};
        }

        throw bogus(`no valid proof that ${name} has no ${TYPE_NAMES[type]} records`);
    }

    /**
     * @param {Map<string, RRset>} answer
     * @param {string} name - owner of a CNAME record
     * @param {string} target - target of the CNAME record
     * @returns {RRset|undefined} the DNAME record set the CNAME record is made from
     * @private
     */
    _findDname(answer, name, target) {
        for (const rrset of answer.values()) {
            if (
                rrset.type !== TYPE.DNAME ||
                rrset.records.length !== 1 ||
                rrset.name === name ||
                !isSubdomain(name, rrset.name)
            ) {
                continue;
            }

            const prefix   = splitName(name).slice(0, -splitName(rrset.name).length || undefined);
            const expected = [...prefix, ...splitName(rrset.records[0].data.target)].join('.');

            if (expected === target) {
                return rrset;
            }
        }
    }

    /**
     * @param {string} name
     * @param {number} type
     * @throws {DnsError} if the server reports a failure
     * @returns {Promise<DnsMessage>}
     * @private
     */
    async _query(name, type) {
        const message = await this._queryServer(name, type);

        if (message.rcode !== RCODE_NOERROR && message.rcode !== RCODE_NXDOMAIN) {
            throw new DnsError(RCODE_ERRORS[message.rcode] ?? 'EBADRESP');
        }

        return message;
    }

    /**
     * Validates a record set with the keys of the zone its signatures name.
     *
     * @param {RRset} rrset
     * @throws {DnsError} with the `EDNSSEC_BOGUS` code
     * @returns {Promise<boolean>} true - the set is secure, false - it belongs to an unsigned zone
     * @private
     */
    async _validate(rrset) {
        const signers = [...new Set(rrset.rrsigs.map(rrsig => rrsig.data.signerName))]
            .filter(signer => isSubdomain(rrset.name, signer))
            .slice(0, 2);

        for (const signer of signers) {
            const zone = await this._findZone(signer);

            // Signatures of a zone nobody vouches for mean nothing
            if (zone.insecure) {
                return false;
            }

            if (zone.name === signer && this._verify(rrset, zone.keys, signer)) {
                return true;
            }
        }

        if (signers.length === 0 && (await this._findZone(rrset.name)).insecure) {
            return false;
        }

        throw bogus(
            `no valid signature for ${TYPE_NAMES[rrset.type]} records of ${display(rrset.name)}` +
            (rrset.rrsigs.length === 0 ? ' (the DNS server may not support DNSSEC)' : '')
        );
    }

    /**
     * Walks down from the root and finds the deepest signed zone the name is in.
     *
     * @param {string} name
     * @returns {Promise<Zone|{insecure: boolean}>} `insecure` if the name is at or below an unsigned delegation
     * @private
     */
    async _findZone(name) {
        let zone = await this._cached('root', () => this._loadZone('', this._trustAnchors, Infinity));

        const labels = splitName(name);

        for (let i = labels.length - 1; i >= 0 && !zone.insecure; i--) {
            const child  = labels.slice(i).join('.');
            const parent = zone;
            const cut    = await this._cached(`cut/${child}`, () => this._loadDelegation(child, parent));

            if (cut.insecure) {
                return cut;
            }

            zone = cut.zone ?? zone;
        }

        return zone;
    }

    /**
     * Asks the parent zone if a zone starts at the name.
     *
     * @param {string} name
     * @param {Zone} parent - the signed zone right above the name
     * @returns {Promise<{zone: Zone|undefined, insecure: boolean|undefined, expiresAt: number}>} `zone` - a signed
     * zone starts there, `insecure` - an unsigned zone starts there, none of them - no zone starts there
     * @private
     */
    async _loadDelegation(name, parent) {
        const message = await this._query(name, TYPE.DS);
        const answer  = groupRRsets(message.answer);
        const ds      = answer.get(rrsetKey(name, TYPE.DS));

        if (ds) {
            this._require(ds, parent);

            const zone = await this._loadZone(name, ds.records.map(record => record.data), ds.expiresAt);

            return zone.insecure ? zone : {zone, expiresAt: zone.expiresAt};
        }

        const cname = answer.get(rrsetKey(name, TYPE.CNAME));

        if (cname) {
            this._require(cname, parent);

            return {expiresAt: cname.expiresAt};
        }

        const proofs = await this._collectProofs(message, rrset => this._verify(rrset, parent.keys, parent.name));
        const result = classifyDsDenial(proofs.nsecs, proofs.nsec3s, name);

        if (result === 'insecure' || (result === undefined && proofs.limited)) {
            return {insecure: true, expiresAt: proofs.expiresAt};
        }

        if (result === 'nocut') {
            return {expiresAt: proofs.expiresAt};
        }

        throw bogus(
            `no valid proof that ${name} has no DS records` +
            (message.authority.some(record => record.type === TYPE.RRSIG) ?
                '' :
                ' (the DNS server may not support DNSSEC)')
        );
    }

    /**
     * Fetches the keys of a zone and checks them against the DS records the parent zone has for it.
     *
     * @param {string} name
     * @param {Object[]} dsRecords - validated DS records, or trust anchors
     * @param {number} dsExpiresAt
     * @returns {Promise<Zone|{insecure: boolean, expiresAt: number}>}
     * @private
     */
    async _loadZone(name, dsRecords, dsExpiresAt) {
        let trusted = dsRecords.filter(
            ds => isSupportedAlgorithm(ds.algorithm) && isSupportedDigest(ds.digestType)
        );

        // RFC 4509: SHA-1 digests are ignored when there are stronger ones
        if (trusted.some(ds => ds.digestType !== DIGEST_SHA1)) {
            trusted = trusted.filter(ds => ds.digestType !== DIGEST_SHA1);
        }

        // RFC 4035 5.2: a zone signed only with algorithms the validator does not know is treated as unsigned
        if (trusted.length === 0) {
            return {insecure: true, expiresAt: dsExpiresAt};
        }

        const message = await this._query(name, TYPE.DNSKEY);
        const rrset   = groupRRsets(message.answer).get(rrsetKey(name, TYPE.DNSKEY));

        if (!rrset) {
            throw bogus(`no DNSKEY records for ${display(name)}`);
        }

        const keys = rrset.records.filter(({data}) =>
            (data.flags & DNSKEY_ZONE_KEY) &&
            !(data.flags & DNSKEY_REVOKED) &&
            data.protocol === DNSKEY_PROTOCOL &&
            isSupportedAlgorithm(data.algorithm)
        );

        const ownerWire = nameToWire(name);

        const entryPoints = keys.filter(key => trusted.some(ds =>
            ds.keyTag === key.data.keyTag &&
            ds.algorithm === key.data.algorithm &&
            ds.digest.equals(dsDigest(ds.digestType, ownerWire, key.rdata))
        ));

        if (!this._verify(rrset, entryPoints, name)) {
            throw bogus(
                `DNSKEY records of ${display(name)} are not signed by a trusted key` +
                (rrset.rrsigs.length === 0 ? ' (the DNS server may not support DNSSEC)' : '')
            );
        }

        return {name, keys, expiresAt: Math.min(dsExpiresAt, rrset.expiresAt)};
    }

    /**
     * @param {RRset} rrset
     * @param {Zone} zone
     * @throws {DnsError} if the set is not signed by the zone
     * @private
     */
    _require(rrset, zone) {
        if (!this._verify(rrset, zone.keys, zone.name)) {
            throw bogus(
                `no valid signature for ${TYPE_NAMES[rrset.type]} records of ${rrset.name}` +
                (rrset.rrsigs.length === 0 ? ' (the DNS server may not support DNSSEC)' : '')
            );
        }
    }

    /**
     * Picks NSEC and NSEC3 records out of the authority section of a response.
     *
     * @param {DnsMessage} message
     * @param {Function} isSecure - `rrset => boolean|Promise<boolean>`, must verify the set with `_verify`
     * @returns {Promise<{nsecs: Nsec[], nsec3s: Nsec3[], limited: boolean, expiresAt: number}>} `limited` - there
     * are NSEC3 records with too many iterations
     * @private
     */
    async _collectProofs(message, isSecure) {
        const proofs = {nsecs: [], nsec3s: [], limited: false, expiresAt: Infinity};

        for (const rrset of groupRRsets(message.authority).values()) {
            if (rrset.type !== TYPE.NSEC && rrset.type !== TYPE.NSEC3) {
                continue;
            }

            // A record made from a wildcard is not a record of the chain
            if (!await isSecure(rrset) || rrset.wildcardLabels !== undefined) {
                continue;
            }

            proofs.expiresAt = Math.min(proofs.expiresAt, rrset.expiresAt);

            for (const {data} of rrset.records) {
                if (rrset.type === TYPE.NSEC) {
                    proofs.nsecs.push({
                        name:     rrset.name,
                        zone:     rrset.signer,
                        nextName: data.nextName,
                        types:    data.types
                    });

                    continue;
                }

                const [hashLabel, ...zoneLabels] = splitName(rrset.name);
                const hash                       = base32hexDecode(hashLabel ?? '');

                if (
                    data.hashAlgorithm !== NSEC3_HASH_SHA1 ||
                    (data.flags & ~NSEC3_KNOWN_FLAGS) ||
                    !hash ||
                    zoneLabels.join('.') !== rrset.signer
                ) {
                    continue;
                }

                if (data.iterations > MAX_NSEC3_ITERATIONS) {
                    proofs.limited = true;

                    continue;
                }

                proofs.nsec3s.push({
                    zone:       rrset.signer,
                    hash,
                    nextHash:   data.nextHash,
                    flags:      data.flags,
                    iterations: data.iterations,
                    salt:       data.salt,
                    types:      data.types
                });
            }
        }

        return proofs;
    }

    /**
     * Checks the signatures of a record set, RFC 4035 5.3.
     * On success the set gets `signer`, `expiresAt` and `wildcardLabels` (if it is made from a wildcard).
     *
     * @param {RRset} rrset
     * @param {DnsRecord[]} keys - DNSKEY records of the signer
     * @param {string} signer - zone name
     * @returns {boolean}
     * @private
     */
    _verify(rrset, keys, signer) {
        if (!isSubdomain(rrset.name, signer)) {
            return false;
        }

        const now        = this._now();
        const nowSeconds = Math.floor(now / 1000);
        const labels     = splitName(rrset.name);
        const labelCount = labels.length - (labels[0] === '*' ? 1 : 0);

        let budget = MAX_VERIFICATIONS;

        for (const {data: rrsig} of rrset.rrsigs) {
            // Serial number arithmetic, RFC 4034 3.1.5
            const untilExpiration = (rrsig.expiration - nowSeconds) | 0;
            const sinceInception  = (nowSeconds - rrsig.inception) | 0;

            if (
                rrsig.signerName !== signer ||
                rrsig.labels > labelCount ||
                untilExpiration < 0 ||
                sinceInception < 0
            ) {
                continue;
            }

            let signedData;

            for (const key of keys) {
                if (key.data.keyTag !== rrsig.keyTag || key.data.algorithm !== rrsig.algorithm) {
                    continue;
                }

                if (budget-- === 0) {
                    return false;
                }

                if (!Object.hasOwn(key, 'publicKey')) {
                    key.publicKey = createPublicKey(key.data.algorithm, key.data.publicKey);
                }

                if (!key.publicKey) {
                    continue;
                }

                signedData ??= this._signedData(rrset, rrsig, labels, labelCount);

                if (verifySignature(rrsig.algorithm, key.publicKey, signedData, rrsig.signature)) {
                    const ttl = Math.min(rrset.ttl, rrsig.originalTtl, MAX_TTL, untilExpiration);

                    rrset.signer         = signer;
                    rrset.expiresAt      = now + ttl * 1000;
                    rrset.wildcardLabels = rrsig.labels < labelCount ? rrsig.labels : undefined;

                    return true;
                }
            }
        }

        return false;
    }

    /**
     * The data a signature is made of, RFC 4034 3.1.8.1.
     *
     * @param {RRset} rrset
     * @param {Object} rrsig - parsed RRSIG record
     * @param {string[]} labels - labels of the owner name
     * @param {number} labelCount - number of the labels without the wildcard one
     * @returns {Buffer}
     * @private
     */
    _signedData(rrset, rrsig, labels, labelCount) {
        // An answer made from a wildcard is signed under the name of the wildcard
        const owner = rrsig.labels < labelCount ?
            nameToWire(['*', ...labels.slice(labels.length - rrsig.labels)].join('.')) :
            nameToWire(rrset.name);

        const fixed = Buffer.alloc(8);

        fixed.writeUInt16BE(rrset.type, 0);
        fixed.writeUInt16BE(CLASS_IN, 2);
        fixed.writeUInt32BE(rrsig.originalTtl, 4);

        const parts = [rrsig.signedPrefix];

        let previous;

        for (const rdata of rrset.records.map(record => record.rdata).sort(Buffer.compare)) {
            // RFC 4034 6.3: duplicates are signed once
            if (previous?.equals(rdata)) {
                continue;
            }

            const length = Buffer.alloc(2);

            length.writeUInt16BE(rdata.length);

            parts.push(owner, fixed, length, rdata);

            previous = rdata;
        }

        return Buffer.concat(parts);
    }

    /**
     * Keeps results of `load` until they expire. Parallel calls share one promise, failures are not kept.
     *
     * @param {string} key
     * @param {Function} load - `() => Promise<{expiresAt: number}>`
     * @returns {Promise<Object>}
     * @private
     */
    _cached(key, load) {
        const cached = this._cache.get(key);

        if (cached && cached.expiresAt > this._now()) {
            return cached.promise;
        }

        const entry = {expiresAt: Infinity, promise: undefined};

        entry.promise = load().then(
            value => {
                entry.expiresAt = value.expiresAt;

                return value;
            },
            error => {
                if (this._cache.get(key) === entry) {
                    this._cache.delete(key);
                }

                throw error;
            }
        );

        this._cache.delete(key);
        this._cache.set(key, entry);

        if (this._cache.size > MAX_CACHE_SIZE) {
            this._prune();
        }

        return entry.promise;
    }

    /**
     * Drops expired entries, and the oldest ones if that is not enough.
     *
     * @private
     */
    _prune() {
        const now = this._now();

        for (const [key, entry] of this._cache) {
            if (entry.expiresAt <= now) {
                this._cache.delete(key);
            }
        }

        for (const key of this._cache.keys()) {
            if (this._cache.size <= MAX_CACHE_SIZE / 2) {
                break;
            }

            this._cache.delete(key);
        }
    }
}

module.exports = Validator;
