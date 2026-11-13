'use strict';

const {assert} = require('chai');

const SecureResolver                  = require('../../../src/dnssec/SecureResolver');
const {TYPE}                          = require('../../../src/dnssec/wire');
const {BOGUS, INSECURE}               = require('../../../src/dnssec/errors');
const {rdata, createWorld}            = require('../../dnssecWorld');

/**
 * @param {Promise} promise
 * @param {Object} expected - fields of the error
 * @returns {Promise}
 */
const assertRejected = (promise, expected) => promise.then(
    () => assert.fail('must be rejected'),
    error => {
        assert.instanceOf(error, Error);
        assert.include(error, expected, error.stack);
    }
);

describe('Unit: dnssec/SecureResolver', () => {
    let world;
    let test;
    let signed;
    let trustAnchors;
    let flags;

    const createResolver = options => new SecureResolver({
        trustAnchors,
        transport: {
            query: (name, type, queryFlags) => {
                flags.push(queryFlags);

                return world.query(name, type);
            }
        },
        ...options
    });

    beforeEach(() => {
        ({world, test, signed, trustAnchors} = createWorld());

        flags = [];
    });

    describe('constructor', () => {
        [undefined, 'on', true, 1].forEach(mode => {
            it(`must throw for the mode ${mode}`, () => {
                assert.throws(() => new SecureResolver({mode}), "dnssec mode must be 'validate' or 'trust-ad'");
            });
        });

        it('must throw if requireSecure is not a boolean', () => {
            assert.throws(() => new SecureResolver({mode: 'validate', requireSecure: 1}), 'requireSecure');
        });
    });

    describe('validate mode', () => {
        it('must resolve addresses with their TTL and ask for the DNSSEC records', async () => {
            world.set('www.signed.test', TYPE.A, {
                answer: signed.records('www.signed.test', TYPE.A, [rdata.a('192.0.2.1')], {ttl: 120})
            });

            const addresses = await createResolver({mode: 'validate'}).resolve4('WWW.signed.test.');

            assert.lengthOf(addresses, 1);
            assert.include(addresses[0], {address: '192.0.2.1', secure: true});
            assert.closeTo(addresses[0].ttl, 120, 1);
            assert.deepEqual(flags[0], {dnssecOk: true, cd: true});
        });

        it('must resolve IPv6 addresses', async () => {
            world.set('www.signed.test', TYPE.AAAA, {
                answer: signed.records('www.signed.test', TYPE.AAAA, [
                    Buffer.from('20010db8'.padEnd(31, '0') + '1', 'hex')
                ])
            });

            const addresses = await createResolver({mode: 'validate'}).resolve6('www.signed.test');

            assert.include(addresses[0], {address: '2001:db8::1', secure: true});
        });

        it('must reject a forged answer with the EDNSSEC_BOGUS error', () => {
            world.set('www.signed.test', TYPE.A, {
                answer: signed.records('www.signed.test', TYPE.A, [rdata.a('192.0.2.1')], {expiration: 1})
            });

            return assertRejected(createResolver({mode: 'validate'}).resolve4('www.signed.test'), {
                code:     BOGUS,
                errno:    BOGUS,
                syscall:  'queryA',
                hostname: 'www.signed.test',
                message:  'queryA EDNSSEC_BOGUS www.signed.test: no valid signature for A records of www.signed.test'
            });
        });

        it('must resolve addresses of an unsigned zone', async () => {
            world.set('host.unsigned.test', TYPE.A, {
                answer: test.records('host.unsigned.test', TYPE.A, [rdata.a('198.51.100.1')], {signed: false})
            });

            const addresses = await createResolver({mode: 'validate'}).resolve4('host.unsigned.test');

            assert.include(addresses[0], {address: '198.51.100.1', secure: false});
        });

        it('must reject addresses of an unsigned zone with requireSecure', () => {
            world.set('host.unsigned.test', TYPE.A, {
                answer: test.records('host.unsigned.test', TYPE.A, [rdata.a('198.51.100.1')], {signed: false})
            });

            const resolver = createResolver({mode: 'validate', requireSecure: true});

            return assertRejected(resolver.resolve4('host.unsigned.test'), {code: INSECURE, syscall: 'queryA'});
        });

        it('must reject with ENODATA if the name has no records of the type', () => {
            world.set('www.signed.test', TYPE.AAAA, {
                authority: signed.nsec('www.signed.test', 'signed.test', [TYPE.A, TYPE.RRSIG, TYPE.NSEC])
            });

            return assertRejected(createResolver({mode: 'validate', requireSecure: true}).resolve6('www.signed.test'), {
                code:     'ENODATA',
                syscall:  'queryAaaa',
                hostname: 'www.signed.test',
                message:  'queryAaaa ENODATA www.signed.test'
            });
        });

        it('must reject with ENOTFOUND if the name does not exist', () => {
            world.set('nope.unsigned.test', TYPE.A, {rcode: 3});

            return assertRejected(createResolver({mode: 'validate'}).resolve4('nope.unsigned.test'), {
                code: 'ENOTFOUND'
            });
        });

        it('must reject with EBADNAME for an invalid hostname', () => {
            return assertRejected(createResolver({mode: 'validate'}).resolve4('a..b'), {code: 'EBADNAME'});
        });
    });

    describe('trust-ad mode', () => {
        const answer = [
            {name: 'www.signed.test', type: TYPE.CNAME, ttl: 20, rdata: rdata.cname('host.signed.test')},
            {name: 'host.signed.test', type: TYPE.A, ttl: 300, rdata: rdata.a('192.0.2.1')},
            {name: 'host.signed.test', type: TYPE.A, ttl: 300, rdata: rdata.a('192.0.2.2')}
        ];

        it('must mark the addresses as secure if the server has validated them', async () => {
            world.set('www.signed.test', TYPE.A, {ad: true, answer});

            const addresses = await createResolver({mode: 'trust-ad'}).resolve4('www.signed.test');

            assert.deepEqual(addresses, [
                {address: '192.0.2.1', ttl: 20, secure: true},
                {address: '192.0.2.2', ttl: 20, secure: true}
            ]);

            // No signatures are needed, only the AD flag
            assert.deepEqual(flags, [{ad: true}]);
            assert.deepEqual(world.queries, [`www.signed.test/${TYPE.A}`]);
        });

        it('must mark the addresses as not secure if the server has not', async () => {
            world.set('www.signed.test', TYPE.A, {answer});

            const addresses = await createResolver({mode: 'trust-ad'}).resolve4('www.signed.test');

            assert.deepEqual(addresses.map(address => address.secure), [false, false]);
        });

        it('must reject not validated addresses with requireSecure', () => {
            world.set('www.signed.test', TYPE.A, {answer});

            const resolver = createResolver({mode: 'trust-ad', requireSecure: true});

            return assertRejected(resolver.resolve4('www.signed.test'), {
                code:    INSECURE,
                message: 'queryA EDNSSEC_INSECURE www.signed.test: the answer is not protected by DNSSEC'
            });
        });

        it('must reject with ESERVFAIL, which is what a validating server sends for bogus data', () => {
            world.set('www.signed.test', TYPE.A, {rcode: 2});

            return assertRejected(createResolver({mode: 'trust-ad'}).resolve4('www.signed.test'), {
                code:    'ESERVFAIL',
                message: 'queryA ESERVFAIL www.signed.test'
            });
        });

        it('must reject with ENOTFOUND and ENODATA for negative answers', async () => {
            world.set('www.signed.test', TYPE.A, {ad: true, rcode: 3});
            world.set('www.signed.test', TYPE.AAAA, {ad: true});

            const resolver = createResolver({mode: 'trust-ad', requireSecure: true});

            await assertRejected(resolver.resolve4('www.signed.test'), {code: 'ENOTFOUND'});
            await assertRejected(resolver.resolve6('www.signed.test'), {code: 'ENODATA'});
        });
    });
});
