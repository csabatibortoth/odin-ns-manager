'use strict';

const net = require('node:net');

const {assert} = require('chai');

const {createLookup, DNSSEC_BOGUS, DNSSEC_INSECURE} = require('../../');

// Public resolvers that validate DNSSEC and hand over the DNSSEC records
const servers = ['1.1.1.1', '8.8.8.8'];

const SIGNED_HOST   = 'ietf.org';
const UNSIGNED_HOST = 'google.com';
// Signed with a broken chain of trust on purpose
const BOGUS_HOST    = 'dnssec-failed.org';

/**
 * @param {Function} lookup
 * @param {string} hostname
 * @param {Object} options
 * @returns {Promise<{error: Error|null, result: *}>}
 */
const run = (lookup, hostname, options) => new Promise(resolve => {
    lookup(hostname, options, (error, result) => resolve({error, result}));
});

['validate', 'trust-ad'].forEach(dnssec => {
    describe(`Func: lookup with {dnssec: '${dnssec}'}`, () => {
        const lookup       = createLookup({dnssec, servers});
        const strictLookup = createLookup({dnssec, servers, requireSecure: true});

        it('must resolve a signed host and mark its addresses as secure', async () => {
            const {error, result} = await run(lookup, SIGNED_HOST, {all: true});

            assert.ifError(error);
            assert.isNotEmpty(result);

            for (const {address, family, secure} of result) {
                assert.strictEqual(net.isIP(address), family);
                assert.isTrue(secure);
            }
        });

        [4, 6].forEach(family => {
            it(`must resolve one IPv${family} address of a signed host with requireSecure`, async () => {
                const {error, result} = await run(strictLookup, SIGNED_HOST, {family});

                assert.ifError(error);
                assert.strictEqual(net.isIP(result), family);
            });
        });

        it('must resolve an unsigned host and mark its addresses as not secure', async () => {
            const {error, result} = await run(lookup, UNSIGNED_HOST, {all: true});

            assert.ifError(error);
            assert.isNotEmpty(result);
            assert.isTrue(result.every(({secure}) => secure === false));
        });

        it('must fail for an unsigned host with requireSecure', async () => {
            const {error} = await run(strictLookup, UNSIGNED_HOST, {family: 4});

            assert.instanceOf(error, Error);
            assert.strictEqual(error.code, DNSSEC_INSECURE);
            assert.strictEqual(error.hostname, UNSIGNED_HOST);
        });

        it('must fail for a host with broken DNSSEC', async () => {
            const {error} = await run(lookup, BOGUS_HOST, {family: 4});

            assert.instanceOf(error, Error);
            // In the trust-ad mode the server is the one who notices, and it tells nothing but SERVFAIL
            assert.strictEqual(error.code, dnssec === 'validate' ? DNSSEC_BOGUS : 'ESERVFAIL');
            assert.strictEqual(error.hostname, BOGUS_HOST);
        });

        it('must fail with ENOTFOUND for a host that does not exist in a signed zone', async () => {
            const hostname = `no-such-host-bragi-ns-client.${SIGNED_HOST}`;

            const {error} = await run(strictLookup, hostname, {});

            assert.instanceOf(error, Error);
            assert.strictEqual(error.code, 'ENOTFOUND');
            assert.strictEqual(error.hostname, hostname);
        });
    });
});
