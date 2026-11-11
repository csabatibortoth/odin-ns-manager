'use strict';

const {assert} = require('chai');

const AddressCache = require('../../../src/AddressCache');
const addresses    = require('../../addresses');

describe('Unit: AddressCache::find', () => {
    let addressCache;

    beforeEach(() => {
        addressCache = new AddressCache();
    });

    it('must return undefined, cuz there are no addresses for this hostname key', () => {
        const notExistedKey = addresses.INET_HOST1;

        const result = addressCache.find(notExistedKey);

        assert.isUndefined(result);
    });

    it('must return undefined and drop the entry, cuz addresses for particular host are expired', () => {
        addressCache._cache.set(addresses.INET_HOST1, {
            addresses: [{address: '1.2.3.4'}],
            expiresAt: Date.now() - 1
        });

        const result = addressCache.find(addresses.INET_HOST1);

        assert.isUndefined(result);
        assert.isFalse(addressCache._cache.has(addresses.INET_HOST1));
    });

    it('must return addresses array, cuz addresses for particular host are not expired', () => {
        const cachedAddresses = [{address: '1.2.3.4'}];

        addressCache._cache.set(addresses.INET_HOST1, {
            addresses: cachedAddresses,
            expiresAt: Date.now() * 2
        });

        const result = addressCache.find(addresses.INET_HOST1);

        assert.strictEqual(result, cachedAddresses);
    });
});
