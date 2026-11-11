'use strict';

const {assert} = require('chai');
const sinon    = require('sinon');

const ResolveTask = require('../../../src/ResolveTask');
const addresses   = require('../../addresses');

describe('Unit: ResolveTask::run', () => {
    const hostname  = addresses.INET_HOST1;
    const ipVersion = 4;

    it('must run resolver with correct set of params and resolve with addresses', () => {
        const resolverStub = sinon.stub().resolves([{address: '1.2.3.4', ttl: 10}]);

        const task = new ResolveTask(hostname, ipVersion);

        task._resolver = resolverStub;

        return task.run().then(result => {
            assert.isTrue(resolverStub.calledOnce);
            assert.isTrue(resolverStub.calledWithExactly(hostname, {ttl: true}));

            assert.deepEqual(result, [{address: '1.2.3.4', ttl: 10, family: ipVersion}]);
        });
    });

    it('must run resolver only once and return the same promise for every call', () => {
        const resolverStub = sinon.stub().resolves([]);

        const task = new ResolveTask(hostname, ipVersion);

        task._resolver = resolverStub;

        const firstPromise  = task.run();
        const secondPromise = task.run();

        assert.strictEqual(firstPromise, secondPromise);

        return firstPromise.then(() => {
            assert.strictEqual(task.run(), firstPromise);
            assert.isTrue(resolverStub.calledOnce);
        });
    });

    it('must reject with resolver error', () => {
        const expectedError = new Error('some error');
        const resolverStub  = sinon.stub().rejects(expectedError);

        const task = new ResolveTask(hostname, ipVersion);

        task._resolver = resolverStub;

        return task.run().then(
            () => assert.fail('must be rejected'),
            error => {
                assert.strictEqual(error, expectedError);
                assert.isTrue(resolverStub.calledOnce);
            }
        );
    });
});
