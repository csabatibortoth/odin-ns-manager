'use strict';

const {assert} = require('chai');
const sinon    = require('sinon');

const Lookup         = require('../../../src/Lookup');
const ResolveTask    = require('../../../src/ResolveTask');
const SecureResolver = require('../../../src/dnssec/SecureResolver');

const {createLookup, DNSSEC_BOGUS, DNSSEC_INSECURE} = require('../../../');

describe('Unit: Lookup::constructor', () => {
    it('must use the system resolver by default', () => {
        assert.isUndefined(new Lookup()._resolver);
        assert.isUndefined(new Lookup({})._resolver);
        assert.isUndefined(new Lookup({dnssec: false})._resolver);
    });

    [
        {dnssec: 'validate', expectedMode: 'validate'},
        {dnssec: true, expectedMode: 'validate'},
        {dnssec: 'trust-ad', expectedMode: 'trust-ad'}
    ].forEach(({dnssec, expectedMode}) => {
        it(`must use the DNSSEC resolver in the ${expectedMode} mode for {dnssec: ${dnssec}}`, () => {
            const lookup = new Lookup({dnssec, requireSecure: true, servers: ['192.0.2.53'], timeout: 500, tries: 1});

            assert.instanceOf(lookup._resolver, SecureResolver);
            assert.strictEqual(lookup._resolver._mode, expectedMode);
            assert.isTrue(lookup._resolver._requireSecure);
            assert.deepEqual(lookup._resolver._transport._servers, [{address: '192.0.2.53', port: 53, family: 4}]);
            assert.strictEqual(lookup._resolver._transport._timeout, 500);
            assert.strictEqual(lookup._resolver._transport._tries, 1);
        });
    });

    [null, 1, 'validate', []].forEach(options => {
        it(`must throw if options is ${JSON.stringify(options)}`, () => {
            assert.throws(() => new Lookup(options), 'options must be an object');
        });
    });

    it('must throw for an unknown dnssec mode', () => {
        assert.throws(() => new Lookup({dnssec: 'strict'}), "dnssec mode must be 'validate' or 'trust-ad'");
    });

    it('must throw if the DNSSEC options are used without dnssec', () => {
        assert.throws(
            () => new Lookup({requireSecure: true, servers: ['192.0.2.53']}),
            'requireSecure, servers can be used only with the dnssec option'
        );
    });

    it('must throw for invalid DNSSEC options', () => {
        assert.throws(() => new Lookup({dnssec: 'validate', servers: ['not an address']}), 'invalid DNS server');
        assert.throws(() => new Lookup({dnssec: 'validate', requireSecure: 'yes'}), 'requireSecure');
    });
});

describe('Unit: Lookup with DNSSEC', () => {
    let lookup;
    let resolve4;
    let resolve6;

    const run = (hostname, options) => new Promise((resolve, reject) => {
        lookup.run(hostname, options, (error, address, family) => error ? reject(error) : resolve({address, family}));
    });

    beforeEach(() => {
        lookup   = new Lookup({dnssec: 'validate'});
        resolve4 = sinon.stub(lookup._resolver, 'resolve4');
        resolve6 = sinon.stub(lookup._resolver, 'resolve6');
    });

    it('must resolve through the DNSSEC resolver and cache the addresses', async () => {
        resolve4.resolves([
            {address: '192.0.2.1', ttl: 60, secure: true},
            {address: '192.0.2.2', ttl: 60, secure: true}
        ]);

        assert.deepEqual(await run('www.signed.test', {family: 4}), {address: '192.0.2.1', family: 4});
        assert.deepEqual(await run('www.signed.test', {family: 4}), {address: '192.0.2.2', family: 4});

        assert.isTrue(resolve4.calledOnceWithExactly('www.signed.test', {ttl: true}));
    });

    it('must tell if the addresses are protected with {all: true}', async () => {
        resolve4.resolves([{address: '192.0.2.1', ttl: 60, secure: true}]);
        resolve6.resolves([{address: '2001:db8::1', ttl: 60, secure: false}]);

        const {address: addresses} = await run('www.signed.test', {all: true});

        assert.deepEqual(addresses, [
            {address: '192.0.2.1', family: 4, secure: true},
            {address: '2001:db8::1', family: 6, secure: false}
        ]);
    });

    it('must use the other IP version if one has no addresses', async () => {
        const noData = Object.assign(new Error('queryA ENODATA www.signed.test'), {code: 'ENODATA'});

        resolve4.rejects(noData);
        resolve6.resolves([{address: '2001:db8::1', ttl: 60, secure: true}]);

        assert.deepEqual(await run('www.signed.test', {}), {address: '2001:db8::1', family: 6});
    });

    [DNSSEC_BOGUS, DNSSEC_INSECURE].forEach(code => {
        it(`must fail with ${code} even if the other IP version has addresses`, async () => {
            const failure = Object.assign(new Error(`queryAaaa ${code} www.signed.test`), {code});

            resolve4.resolves([{address: '192.0.2.1', ttl: 60, secure: true}]);
            resolve6.rejects(failure);

            const error = await run('www.signed.test', {}).then(() => assert.fail('must be rejected'), e => e);

            assert.strictEqual(error, failure);
        });
    });

    it('must not cache failures', async () => {
        resolve4.onFirstCall().rejects(Object.assign(new Error('bogus'), {code: DNSSEC_BOGUS}));
        resolve4.onSecondCall().resolves([{address: '192.0.2.1', ttl: 60, secure: true}]);

        await run('www.signed.test', {family: 4}).then(() => assert.fail('must be rejected'), () => {});

        assert.deepEqual(await run('www.signed.test', {family: 4}), {address: '192.0.2.1', family: 4});
    });
});

describe('Unit: createLookup', () => {
    it('must make independent lookup functions', () => {
        const runSpy = sinon.spy(Lookup.prototype, 'run');
        const task   = sinon.stub(ResolveTask.prototype, 'run').resolves([{address: '192.0.2.1', ttl: 60, family: 4}]);

        try {
            const callback = () => {};

            createLookup()('www.example', 4, callback);
            createLookup({dnssec: 'trust-ad'})('www.example', 4, callback);

            assert.isTrue(runSpy.calledTwice);
            assert.notStrictEqual(runSpy.firstCall.thisValue, runSpy.secondCall.thisValue);
            assert.isUndefined(runSpy.firstCall.thisValue._resolver);
            assert.instanceOf(runSpy.secondCall.thisValue._resolver, SecureResolver);
            assert.isTrue(task.calledTwice);
        } finally {
            runSpy.restore();
            task.restore();
        }
    });

    it('must export the DNSSEC error codes', () => {
        assert.strictEqual(DNSSEC_BOGUS, 'EDNSSEC_BOGUS');
        assert.strictEqual(DNSSEC_INSECURE, 'EDNSSEC_INSECURE');
    });
});
