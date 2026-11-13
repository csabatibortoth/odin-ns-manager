'use strict';

const Transport    = require('./Transport');
const Validator    = require('./Validator');
const rootAnchors  = require('./trustAnchors');

const {BOGUS, INSECURE, RCODE_ERRORS, DnsError}                 = require('./errors');
const {TYPE, normalizeName, rrsetKey, groupRRsets}              = require('./wire');

const MODE_VALIDATE = 'validate';
const MODE_TRUST_AD = 'trust-ad';

const RCODE_NOERROR  = 0;
const RCODE_NXDOMAIN = 3;

const MAX_CNAMES = 16;

/**
 * Resolver with the interface of `dns.promises.resolve4` / `resolve6` that knows about DNSSEC.
 *
 * In the `validate` mode it verifies the signatures of the answers by itself.
 * In the `trust-ad` mode it relies on the validation done by the DNS server (the AD flag of the response).
 */
class SecureResolver {
    /**
     * @param {Object} options
     * @param {string} options.mode - `validate` or `trust-ad`
     * @param {boolean} [options.requireSecure] - fail for the hosts that are not protected by DNSSEC
     * @param {string[]} [options.servers] - DNS servers, the ones of `dns.getServers()` by default
     * @param {number} [options.timeout] - milliseconds to wait for a response of a server
     * @param {number} [options.tries] - how many times to go through the list of servers
     * @param {Object[]} [options.trustAnchors] - DS records of the root zone, for the `validate` mode
     * @param {Transport} [options.transport]
     */
    constructor({mode, requireSecure = false, servers, timeout, tries, trustAnchors = rootAnchors, transport}) {
        if (mode !== MODE_VALIDATE && mode !== MODE_TRUST_AD) {
            throw new Error(`dnssec mode must be '${MODE_VALIDATE}' or '${MODE_TRUST_AD}'`);
        }

        if (typeof requireSecure !== 'boolean') {
            throw new Error('requireSecure must be a boolean');
        }

        this._mode          = mode;
        this._requireSecure = requireSecure;
        this._transport     = transport ?? new Transport({servers, timeout, tries});

        // CD: the server must hand over everything it has, the validation is done here
        this._validator = new Validator({
            trustAnchors,
            query: (name, type) => this._transport.query(name, type, {dnssecOk: true, cd: true})
        });

        this.resolve4 = hostname => this._resolve(hostname, TYPE.A, 'queryA');
        this.resolve6 = hostname => this._resolve(hostname, TYPE.AAAA, 'queryAaaa');
    }

    /**
     * @param {string} hostname
     * @param {number} type
     * @param {string} syscall
     * @returns {Promise<Array<{address: string, ttl: number, secure: boolean}>>}
     * @private
     */
    async _resolve(hostname, type, syscall) {
        const fail = (code, detail) => {
            const error = new Error(`${syscall} ${code} ${hostname}` + (detail ? `: ${detail}` : ''));

            error.code     = code;
            error.errno    = code;
            error.syscall  = syscall;
            error.hostname = hostname;

            return error;
        };

        let name;

        try {
            name = normalizeName(hostname);
        } catch {
            throw fail('EBADNAME');
        }

        let result;

        try {
            result = this._mode === MODE_VALIDATE ?
                await this._validator.resolve(name, type) :
                await this._resolveTrustingServer(name, type);
        } catch (error) {
            throw error instanceof DnsError ? fail(error.code, error.detail) : error;
        }

        if (!result.secure && this._requireSecure) {
            throw fail(INSECURE, 'the answer is not protected by DNSSEC');
        }

        if (result.negative) {
            throw fail(result.nxdomain ? 'ENOTFOUND' : 'ENODATA');
        }

        const ttl = Math.max(0, Math.floor((result.expiresAt - Date.now()) / 1000));

        return result.records.map(record => ({address: record.data.address, ttl, secure: result.secure}));
    }

    /**
     * @param {string} name
     * @param {number} type
     * @returns {Promise<Object>} the same result `Validator.resolve` gives
     * @private
     */
    async _resolveTrustingServer(name, type) {
        const message = await this._transport.query(name, type, {ad: true});

        if (message.rcode !== RCODE_NOERROR && message.rcode !== RCODE_NXDOMAIN) {
            // A validating server answers with SERVFAIL if the data is bogus
            throw new DnsError(RCODE_ERRORS[message.rcode] ?? 'EBADRESP');
        }

        const answer = groupRRsets(message.answer);

        let ttl     = Infinity;
        let current = name;

        for (let hops = 0; hops <= MAX_CNAMES; hops++) {
            const rrset = answer.get(rrsetKey(current, type));

            if (rrset) {
                ttl = Math.min(ttl, rrset.ttl);

                return {records: rrset.records, secure: message.ad, expiresAt: Date.now() + ttl * 1000};
            }

            const cname = answer.get(rrsetKey(current, TYPE.CNAME));

            if (!cname) {
                return {negative: true, nxdomain: message.rcode === RCODE_NXDOMAIN, secure: message.ad};
            }

            ttl     = Math.min(ttl, cname.ttl);
            current = cname.records[0].data.target;
        }

        throw new DnsError('EBADRESP', `CNAME chain of ${name} is too long`);
    }
}

SecureResolver.BOGUS    = BOGUS;
SecureResolver.INSECURE = INSECURE;

module.exports = SecureResolver;
