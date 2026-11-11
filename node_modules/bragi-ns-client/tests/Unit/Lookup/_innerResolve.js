'use strict';

const {assert} = require('chai');
const sinon    = require('sinon');

const Lookup      = require('../../../src/Lookup');
const ResolveTask = require('../../../src/ResolveTask');
const addresses   = require('../../addresses');

describe('Unit: Lookup::_innerResolve', () => {
    const hostname   = addresses.INET_HOST1;
    const ipVersions = [4, 6];

    let lookup;
    let runStub;

    let addressCacheFindSpy;
    let addressCacheSetSpy;

    let tasksManagerFindSpy;
    let tasksManagerAddSpy;
    let tasksManagerDoneSpy;

    beforeEach(() => {
        lookup  = new Lookup();
        runStub = sinon.stub(ResolveTask.prototype, 'run');

        addressCacheFindSpy = sinon.spy(lookup._addressCache, 'find');
        addressCacheSetSpy  = sinon.spy(lookup._addressCache, 'set');

        tasksManagerFindSpy = sinon.spy(lookup._tasksManager, 'find');
        tasksManagerAddSpy  = sinon.spy(lookup._tasksManager, 'add');
        tasksManagerDoneSpy = sinon.spy(lookup._tasksManager, 'done');
    });

    afterEach(() => {
        runStub.restore();
    });

    ipVersions.forEach(ipVersion => {
        const key = `${hostname}_${ipVersion}`;

        it(`must correct return cached value for IPv${ipVersion}`, () => {
            const cachedAddresses = [{address: 'address', ttl: 10, family: ipVersion}];

            lookup._addressCache.set(key, cachedAddresses);
            addressCacheSetSpy.resetHistory();

            return lookup._innerResolve(hostname, ipVersion)
                .then(result => {
                    assert.strictEqual(result, cachedAddresses);

                    assert.isTrue(addressCacheFindSpy.calledOnce);
                    assert.isTrue(addressCacheFindSpy.calledWithExactly(key));
                    assert.isTrue(addressCacheSetSpy.notCalled);

                    assert.isTrue(runStub.notCalled);

                    assert.isTrue(tasksManagerFindSpy.notCalled);
                    assert.isTrue(tasksManagerAddSpy.notCalled);
                    assert.isTrue(tasksManagerDoneSpy.notCalled);
                });
        });

        it(`must create only one task for parallel calls (IPv${ipVersion})`, () => {
            const expectedAddresses = [{address: 'address', ttl: 10, family: ipVersion}];

            const pending = new Promise(resolve => setImmediate(resolve, expectedAddresses));

            runStub.returns(pending);

            return Promise.all([
                lookup._innerResolve(hostname, ipVersion),
                lookup._innerResolve(hostname, ipVersion)
            ]).then(results => {
                assert.strictEqual(results[0], expectedAddresses);
                assert.strictEqual(results[1], expectedAddresses);

                assert.isTrue(addressCacheFindSpy.calledTwice);
                assert.isTrue(addressCacheFindSpy.alwaysCalledWithExactly(key));

                assert.isTrue(addressCacheSetSpy.calledOnce);
                assert.isTrue(addressCacheSetSpy.calledWithExactly(key, expectedAddresses));

                assert.isTrue(tasksManagerFindSpy.calledTwice);
                assert.isTrue(tasksManagerFindSpy.alwaysCalledWithExactly(key));

                assert.isTrue(tasksManagerAddSpy.calledOnce);
                assert.strictEqual(tasksManagerAddSpy.getCall(0).args[0], key);

                const task = tasksManagerAddSpy.getCall(0).args[1];

                assert.instanceOf(task, ResolveTask);
                assert.strictEqual(task._hostname, hostname);
                assert.strictEqual(task._ipVersion, ipVersion);

                // Both calls have used the same task.
                assert.isTrue(runStub.calledTwice);
                assert.isTrue(runStub.alwaysCalledOn(task));

                assert.isTrue(tasksManagerDoneSpy.calledOnce);
                assert.isTrue(tasksManagerDoneSpy.calledWithExactly(key));
                assert.isUndefined(lookup._tasksManager.find(key));
            });
        });

        it(`must fill the cache and release the task before the caller gets addresses (IPv${ipVersion})`, () => {
            const expectedAddresses = [{address: 'address', ttl: 10, family: ipVersion}];

            runStub.resolves(expectedAddresses);

            return lookup._innerResolve(hostname, ipVersion)
                .then(result => {
                    assert.strictEqual(result, expectedAddresses);

                    assert.isTrue(addressCacheSetSpy.calledOnce);
                    assert.isTrue(tasksManagerDoneSpy.calledOnce);

                    assert.strictEqual(lookup._addressCache.find(key), expectedAddresses);
                    assert.isUndefined(lookup._tasksManager.find(key));

                    return lookup._innerResolve(hostname, ipVersion);
                })
                .then(result => {
                    assert.strictEqual(result, expectedAddresses);

                    // The second call has been served from the cache.
                    assert.isTrue(runStub.calledOnce);
                    assert.isTrue(tasksManagerAddSpy.calledOnce);
                });
        });

        it(`must reject every parallel call and release the task on error (IPv${ipVersion})`, () => {
            const expectedError = new Error('error');

            const pending = new Promise((resolve, reject) => setImmediate(reject, expectedError));

            runStub.returns(pending);

            const catchError = promise => promise.then(() => assert.fail('must be rejected'), error => error);

            return Promise.all([
                catchError(lookup._innerResolve(hostname, ipVersion)),
                catchError(lookup._innerResolve(hostname, ipVersion))
            ]).then(errors => {
                assert.strictEqual(errors[0], expectedError);
                assert.strictEqual(errors[1], expectedError);

                assert.isTrue(addressCacheFindSpy.calledTwice);
                assert.isTrue(addressCacheSetSpy.notCalled);

                assert.isTrue(tasksManagerAddSpy.calledOnce);

                assert.isTrue(tasksManagerDoneSpy.calledOnce);
                assert.isTrue(tasksManagerDoneSpy.calledWithExactly(key));
                assert.isUndefined(lookup._tasksManager.find(key));
            });
        });

        it(`must start a new task after the previous one has failed (IPv${ipVersion})`, () => {
            const expectedAddresses = [{address: 'address', ttl: 10, family: ipVersion}];

            runStub.onFirstCall().rejects(new Error('error'));
            runStub.onSecondCall().resolves(expectedAddresses);

            return lookup._innerResolve(hostname, ipVersion)
                .then(() => assert.fail('must be rejected'), () => lookup._innerResolve(hostname, ipVersion))
                .then(result => {
                    assert.strictEqual(result, expectedAddresses);

                    assert.isTrue(tasksManagerAddSpy.calledTwice);
                    assert.notStrictEqual(tasksManagerAddSpy.getCall(0).args[1], tasksManagerAddSpy.getCall(1).args[1]);
                });
        });
    });
});
