'use strict';

const {assert} = require('chai');
const sinon    = require('sinon');

const AddressCache = require('../../../src/AddressCache');
const addresses    = require('../../addresses');

describe('Unit: AddressCache::set', () => {
    const now = 1000000;

    let clock;

    beforeEach(() => {
        clock = sinon.useFakeTimers({now, toFake: ['Date']});
    });

    afterEach(() => {
        clock.restore();
    });

    it('must correct set addresses for particular key', () => {
        const setOfAddresses1 = [
            {address: '1.2.3.4', ttl: 10}
        ];

        const setOfAddresses2 = [
            {address: '5.6.7.8', ttl: 20}
        ];

        const addressesCache = new AddressCache();

        addressesCache.set(addresses.INET_HOST1, setOfAddresses1);
        addressesCache.set(addresses.INET_HOST2, setOfAddresses2);

        assert.strictEqual(addressesCache._cache.get(addresses.INET_HOST1).addresses, setOfAddresses1);
        assert.strictEqual(addressesCache._cache.get(addresses.INET_HOST2).addresses, setOfAddresses2);
    });

    it('must expire addresses as soon as the smallest TTL runs out', () => {
        const setOfAddresses = [
            {address: '1.2.3.4', ttl: 30},
            {address: '5.6.7.8', ttl: 5},
            {address: '9.10.11.12', ttl: 60}
        ];

        const addressesCache = new AddressCache();

        addressesCache.set(addresses.INET_HOST1, setOfAddresses);

        assert.strictEqual(addressesCache._cache.get(addresses.INET_HOST1).expiresAt, now + 5000);

        clock.tick(4999);
        assert.strictEqual(addressesCache.find(addresses.INET_HOST1), setOfAddresses);

        clock.tick(1);
        assert.isUndefined(addressesCache.find(addresses.INET_HOST1));
    });

    it('must not cache empty list of addresses', () => {
        const addressesCache = new AddressCache();

        addressesCache.set(addresses.INET_HOST1, [{address: '1.2.3.4', ttl: 10}]);
        addressesCache.set(addresses.INET_HOST1, []);

        assert.isFalse(addressesCache._cache.has(addresses.INET_HOST1));
        assert.isUndefined(addressesCache.find(addresses.INET_HOST1));
    });
});
