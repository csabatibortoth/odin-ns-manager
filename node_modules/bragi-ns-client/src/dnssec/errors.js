'use strict';

/**
 * The answer failed DNSSEC validation: it is forged, broken, or cannot be verified.
 */
const BOGUS = 'EDNSSEC_BOGUS';

/**
 * The answer is not protected by DNSSEC and the `requireSecure` option is on.
 */
const INSECURE = 'EDNSSEC_INSECURE';

/**
 * Error codes of the DNS response codes, the same ones `node:dns` uses.
 */
const RCODE_ERRORS = {
    1: 'EFORMERR',
    2: 'ESERVFAIL',
    3: 'ENOTFOUND',
    4: 'ENOTIMP',
    5: 'EREFUSED'
};

/**
 * Internal error. `SecureResolver` turns it into an error that looks like the ones of `node:dns`.
 */
class DnsError extends Error {
    /**
     * @param {string} code
     * @param {string} [detail]
     */
    constructor(code, detail) {
        super(detail ? `${code}: ${detail}` : code);

        this.code   = code;
        this.detail = detail;
    }
}

/**
 * @param {string} detail
 * @returns {DnsError}
 */
const bogus = detail => new DnsError(BOGUS, detail);

module.exports = {BOGUS, INSECURE, RCODE_ERRORS, DnsError, bogus};
