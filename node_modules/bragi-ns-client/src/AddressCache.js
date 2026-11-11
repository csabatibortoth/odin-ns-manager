'use strict';

/**
 * @typedef {Object} CacheEntry
 * @property {Address[]} addresses
 * @property {number} expiresAt - timestamp of the earliest DNS TTL expiration among the addresses
 */

class AddressCache {
    constructor() {
        /** @type {Map<string, CacheEntry>} */
        this._cache = new Map();
    }

    /**
     * @param {string} key
     * @returns {Address[]|undefined}
     */
    find(key) {
        const entry = this._cache.get(key);

        if (entry === undefined) {
            return;
        }

        if (entry.expiresAt <= Date.now()) {
            this._cache.delete(key);

            return;
        }

        return entry.addresses;
    }

    /**
     * Addresses are cached until the smallest TTL among them runs out.
     * An empty list is never cached.
     *
     * @param {string} key
     * @param {Address[]} addresses
     */
    set(key, addresses) {
        if (addresses.length === 0) {
            this._cache.delete(key);

            return;
        }

        let minTtl = Infinity;

        for (const {ttl} of addresses) {
            if (ttl < minTtl) {
                minTtl = ttl;
            }
        }

        this._cache.set(key, {addresses, expiresAt: Date.now() + minTtl * 1000});
    }
}

module.exports = AddressCache;
