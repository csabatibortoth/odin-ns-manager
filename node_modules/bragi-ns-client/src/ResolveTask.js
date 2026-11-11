'use strict';

/**
 * @typedef {Object} Address
 * @property {string} address - IPv4 or IPv6 address
 * @property {number} ttl - IP DNS TTL
 * @property {number} family - IP family
 */

const assert              = require('node:assert');
const {promises: resolver} = require('node:dns');

class ResolveTask {
    /**
     * @returns {number}
     */
    static get IPv4() {
        return 4;
    }

    /**
     * @returns {number}
     */
    static get IPv6() {
        return 6;
    }

    /**
     * @param {string} hostname
     * @param {number} ipVersion
     */
    constructor(hostname, ipVersion) {
        assert(
            typeof hostname === 'string' && hostname.length > 0,
            `hostname must be not empty string, '${hostname}' has been provided.`
        );

        assert(
            ipVersion === ResolveTask.IPv4 || ipVersion === ResolveTask.IPv6,
            `ipVersion must be 4 or 6. '${ipVersion}' has been provided.`
        );

        this._hostname  = hostname;
        this._ipVersion = ipVersion;
        this._resolver  = ipVersion === ResolveTask.IPv4 ? resolver.resolve4 : resolver.resolve6;
        this._promise   = undefined;
    }

    /**
     * Starts resolving on the first call. Every call returns the same promise,
     * so any number of callers can wait for a single DNS query.
     *
     * @returns {Promise<Address[]>}
     */
    run() {
        this._promise ??= this._resolver(this._hostname, {ttl: true})
            .then(addresses => this._resolved(addresses));

        return this._promise;
    }

    /**
     * @param {Address[]} addresses
     * @returns {Address[]}
     * @private
     */
    _resolved(addresses) {
        assert(Array.isArray(addresses), 'addresses must be an array.');

        for (const address of addresses) {
            address.family = this._ipVersion;
        }

        return addresses;
    }
}

module.exports = ResolveTask;
