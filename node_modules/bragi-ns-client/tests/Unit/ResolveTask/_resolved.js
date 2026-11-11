'use strict';

const {assert} = require('chai');

const ResolveTask = require('../../../src/ResolveTask');

const addresses = require('../../addresses');

describe('Unit: ResolveTask::_resolved', () => {
    const hostname = addresses.INET_HOST1;

    [4, 6].forEach(ipVersion => {
        it(`must set IP family ${ipVersion} for every address`, () => {
            const resolvedAddresses = [
                {address: 'address1', ttl: 10},
                {address: 'address2', ttl: 20}
            ];

            const task = new ResolveTask(hostname, ipVersion);

            const result = task._resolved(resolvedAddresses);

            assert.strictEqual(result, resolvedAddresses);
            assert.deepEqual(result, [
                {address: 'address1', ttl: 10, family: ipVersion},
                {address: 'address2', ttl: 20, family: ipVersion}
            ]);
        });
    });

    it('must throw, cuz addresses is not an array', () => {
        const task = new ResolveTask(hostname, 4);

        assert.throws(() => task._resolved(undefined), 'addresses must be an array.');
    });
});
