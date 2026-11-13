'use strict';

const {assert} = require('chai');

const Validator                       = require('../../../src/dnssec/Validator');
const {TYPE}                          = require('../../../src/dnssec/wire');
const {BOGUS}                         = require('../../../src/dnssec/errors');
const {Zone, rdata, createWorld}      = require('../../dnssecWorld');

const SIGNED_TYPES = [TYPE.A, TYPE.RRSIG, TYPE.NSEC];

/**
 * @param {Promise} promise
 * @param {RegExp} [detail]
 * @returns {Promise}
 */
const assertBogus = (promise, detail) => promise.then(
    () => assert.fail('must be rejected'),
    error => {
        assert.strictEqual(error.code, BOGUS, error.stack);

        if (detail) {
            assert.match(error.detail, detail);
        }
    }
);

describe('Unit: dnssec/Validator::resolve', () => {
    let world;
    let root;
    let test;
    let signed;
    let validator;

    const addresses = result => result.records.map(record => record.data.address);

    beforeEach(() => {
        let trustAnchors;

        ({world, root, test, signed, trustAnchors} = createWorld());

        validator = new Validator({query: world.query, trustAnchors});
    });

    it('must accept an answer signed by a zone with a chain of trust up to the root', async () => {
        world.set('www.signed.test', TYPE.A, {
            answer: signed.records('www.signed.test', TYPE.A, [rdata.a('192.0.2.1'), rdata.a('192.0.2.2')])
        });

        const before = Date.now();
        const result = await validator.resolve('www.signed.test', TYPE.A);

        assert.isTrue(result.secure);
        assert.sameMembers(addresses(result), ['192.0.2.1', '192.0.2.2']);
        assert.closeTo(result.expiresAt, before + 300000, 1000);

        assert.deepEqual(world.queries, [
            `www.signed.test/${TYPE.A}`,
            `/${TYPE.DNSKEY}`,
            `test/${TYPE.DS}`,
            `test/${TYPE.DNSKEY}`,
            `signed.test/${TYPE.DS}`,
            `signed.test/${TYPE.DNSKEY}`
        ]);
    });

    it('must keep the keys of the zones, so the next answer needs one query', async () => {
        world.set('www.signed.test', TYPE.A, {
            answer: signed.records('www.signed.test', TYPE.A, [rdata.a('192.0.2.1')])
        });

        await validator.resolve('www.signed.test', TYPE.A);

        world.queries.length = 0;

        const [first, second] = await Promise.all([
            validator.resolve('www.signed.test', TYPE.A),
            validator.resolve('www.signed.test', TYPE.A)
        ]);

        assert.isTrue(first.secure);
        assert.isTrue(second.secure);
        assert.deepEqual(world.queries, [`www.signed.test/${TYPE.A}`, `www.signed.test/${TYPE.A}`]);
    });

    it('must not trust an answer longer than its signature is valid', async () => {
        const expiration = Math.floor(Date.now() / 1000) + 60;

        world.set('www.signed.test', TYPE.A, {
            answer: signed.records('www.signed.test', TYPE.A, [rdata.a('192.0.2.1')], {expiration})
        });

        const result = await validator.resolve('www.signed.test', TYPE.A);

        assert.closeTo(result.expiresAt, expiration * 1000, 2000);
    });

    it('must reject an answer that has been changed', () => {
        const [record, rrsig] = signed.records('www.signed.test', TYPE.A, [rdata.a('192.0.2.1')]);

        world.set('www.signed.test', TYPE.A, {answer: [{...record, rdata: rdata.a('203.0.113.66')}, rrsig]});

        return assertBogus(validator.resolve('www.signed.test', TYPE.A), /no valid signature for A records/);
    });

    it('must reject an answer with a record added to the signed ones', () => {
        const records = signed.records('www.signed.test', TYPE.A, [rdata.a('192.0.2.1')]);

        records.push({...records[0], rdata: rdata.a('203.0.113.66')});

        world.set('www.signed.test', TYPE.A, {answer: records});

        return assertBogus(validator.resolve('www.signed.test', TYPE.A));
    });

    it('must reject an answer signed by a key that is not a key of the zone', () => {
        const impostor = new Zone('signed.test');

        world.set('www.signed.test', TYPE.A, {
            answer: impostor.records('www.signed.test', TYPE.A, [rdata.a('203.0.113.66')])
        });

        return assertBogus(validator.resolve('www.signed.test', TYPE.A));
    });

    [
        {title: 'expired', options: {expiration: Math.floor(Date.now() / 1000) - 60}},
        {title: 'not valid yet', options: {inception: Math.floor(Date.now() / 1000) + 600}}
    ].forEach(({title, options}) => {
        it(`must reject an answer with a signature that is ${title}`, () => {
            world.set('www.signed.test', TYPE.A, {
                answer: signed.records('www.signed.test', TYPE.A, [rdata.a('192.0.2.1')], options)
            });

            return assertBogus(validator.resolve('www.signed.test', TYPE.A));
        });
    });

    it('must reject an answer of a signed zone that has lost its signatures', () => {
        world.set('www.signed.test', TYPE.A, {
            answer: signed.records('www.signed.test', TYPE.A, [rdata.a('203.0.113.66')], {signed: false})
        });

        // The zone proves that no unsigned zone starts at the name
        world.set('www.signed.test', TYPE.DS, {
            authority: signed.nsec('www.signed.test', 'signed.test', SIGNED_TYPES)
        });

        return assertBogus(validator.resolve('www.signed.test', TYPE.A), /may not support DNSSEC/);
    });

    it('must reject everything if the root keys do not match the trust anchors', () => {
        const otherRoot = new Zone('', root.algorithm);

        validator = new Validator({query: world.query, trustAnchors: [otherRoot.anchor()]});

        world.set('www.signed.test', TYPE.A, {
            answer: signed.records('www.signed.test', TYPE.A, [rdata.a('192.0.2.1')])
        });

        return assertBogus(validator.resolve('www.signed.test', TYPE.A), /DNSKEY records of the root zone/);
    });

    it('must reject a zone whose keys do not match the DS records of its parent', () => {
        const hijacked = new Zone('signed.test');

        world.set('signed.test', TYPE.DNSKEY, {
            answer: hijacked.records('signed.test', TYPE.DNSKEY, [hijacked.dnskeyRdata])
        });

        world.set('www.signed.test', TYPE.A, {
            answer: hijacked.records('www.signed.test', TYPE.A, [rdata.a('203.0.113.66')])
        });

        return assertBogus(validator.resolve('www.signed.test', TYPE.A), /DNSKEY records of signed\.test/);
    });

    it('must reject a zone that pretends to be unsigned without a proof of its parent', () => {
        world.set('signed.test', TYPE.DS, {});
        world.set('www.signed.test', TYPE.A, {
            answer: signed.records('www.signed.test', TYPE.A, [rdata.a('203.0.113.66')], {signed: false})
        });

        return assertBogus(validator.resolve('www.signed.test', TYPE.A), /signed\.test has no DS records/);
    });

    it('must mark an answer of an unsigned zone as not secure', async () => {
        world.set('host.unsigned.test', TYPE.A, {
            answer: test.records('host.unsigned.test', TYPE.A, [rdata.a('198.51.100.1')], {signed: false})
        });

        const result = await validator.resolve('host.unsigned.test', TYPE.A);

        assert.isFalse(result.secure);
        assert.deepEqual(addresses(result), ['198.51.100.1']);
    });

    it('must treat a zone signed with an unknown algorithm as unsigned', async () => {
        const unknownAlgorithm = Buffer.from([0x12, 0x34, 200, 2, ...Buffer.alloc(32)]);

        world.set('future.test', TYPE.DS, {answer: test.records('future.test', TYPE.DS, [unknownAlgorithm])});
        world.set('www.future.test', TYPE.A, {
            answer: new Zone('future.test').records('www.future.test', TYPE.A, [rdata.a('198.51.100.2')])
        });

        const result = await validator.resolve('www.future.test', TYPE.A);

        assert.isFalse(result.secure);
        assert.notInclude(world.queries, `future.test/${TYPE.DNSKEY}`);
    });

    it('must follow a signed CNAME record', async () => {
        world.set('alias.signed.test', TYPE.A, {
            answer: [
                ...signed.records('alias.signed.test', TYPE.CNAME, [rdata.cname('www.signed.test')], {ttl: 60}),
                ...signed.records('www.signed.test', TYPE.A, [rdata.a('192.0.2.1')])
            ]
        });

        const before = Date.now();
        const result = await validator.resolve('alias.signed.test', TYPE.A);

        assert.isTrue(result.secure);
        assert.deepEqual(addresses(result), ['192.0.2.1']);
        assert.closeTo(result.expiresAt, before + 60000, 1000);
    });

    it('must mark an answer as not secure if a CNAME record leads to an unsigned zone', async () => {
        world.set('alias.signed.test', TYPE.A, {
            answer: [
                ...signed.records('alias.signed.test', TYPE.CNAME, [rdata.cname('host.unsigned.test')]),
                ...test.records('host.unsigned.test', TYPE.A, [rdata.a('198.51.100.1')], {signed: false})
            ]
        });

        const result = await validator.resolve('alias.signed.test', TYPE.A);

        assert.isFalse(result.secure);
        assert.deepEqual(addresses(result), ['198.51.100.1']);
    });

    it('must reject a forged CNAME record of a signed zone', () => {
        world.set('alias.signed.test', TYPE.A, {
            answer: [
                ...signed.records('alias.signed.test', TYPE.CNAME, [rdata.cname('host.unsigned.test')], {
                    signed: false
                }),
                ...test.records('host.unsigned.test', TYPE.A, [rdata.a('203.0.113.66')], {signed: false})
            ]
        });

        world.set('alias.signed.test', TYPE.DS, {
            authority: signed.nsec('alias.signed.test', '*.wild.signed.test', [TYPE.CNAME, TYPE.RRSIG, TYPE.NSEC])
        });

        return assertBogus(validator.resolve('alias.signed.test', TYPE.A), /CNAME records of alias\.signed\.test/);
    });

    it('must accept a CNAME record made from a signed DNAME record', async () => {
        world.set('www.old.signed.test', TYPE.A, {
            answer: [
                ...signed.records('old.signed.test', TYPE.DNAME, [rdata.cname('signed.test')]),
                ...signed.records('www.old.signed.test', TYPE.CNAME, [rdata.cname('www.signed.test')], {
                    signed: false
                }),
                ...signed.records('www.signed.test', TYPE.A, [rdata.a('192.0.2.1')])
            ]
        });

        const result = await validator.resolve('www.old.signed.test', TYPE.A);

        assert.isTrue(result.secure);
        assert.deepEqual(addresses(result), ['192.0.2.1']);
    });

    describe('answers made from a wildcard', () => {
        const wildcardAnswer = () => signed.records('x.wild.signed.test', TYPE.A, [rdata.a('192.0.2.7')], {
            wildcard: '*.wild.signed.test'
        });

        it('must accept the answer with a proof that the name itself does not exist', async () => {
            world.set('x.wild.signed.test', TYPE.A, {
                answer:    wildcardAnswer(),
                authority: signed.nsec('*.wild.signed.test', 'www.signed.test', SIGNED_TYPES)
            });

            const result = await validator.resolve('x.wild.signed.test', TYPE.A);

            assert.isTrue(result.secure);
            assert.deepEqual(addresses(result), ['192.0.2.7']);
        });

        it('must reject the answer without the proof', () => {
            world.set('x.wild.signed.test', TYPE.A, {answer: wildcardAnswer()});

            return assertBogus(validator.resolve('x.wild.signed.test', TYPE.A), /wildcard/);
        });

        it('must reject the answer if the proof is about another name', () => {
            world.set('x.wild.signed.test', TYPE.A, {
                answer:    wildcardAnswer(),
                authority: signed.nsec('signed.test', 'alias.signed.test', [TYPE.NS, TYPE.SOA, ...SIGNED_TYPES])
            });

            return assertBogus(validator.resolve('x.wild.signed.test', TYPE.A), /wildcard/);
        });
    });

    describe('negative answers', () => {
        it('must accept a proof that the name has no records of the type', async () => {
            world.set('www.signed.test', TYPE.AAAA, {
                authority: signed.nsec('www.signed.test', 'signed.test', SIGNED_TYPES)
            });

            const result = await validator.resolve('www.signed.test', TYPE.AAAA);

            assert.deepEqual(result, {negative: true, nxdomain: false, secure: true});
        });

        it('must reject a proof that lists the type', () => {
            world.set('www.signed.test', TYPE.A, {
                authority: signed.nsec('www.signed.test', 'signed.test', SIGNED_TYPES)
            });

            world.set('www.signed.test', TYPE.DS, {
                authority: signed.nsec('www.signed.test', 'signed.test', SIGNED_TYPES)
            });

            return assertBogus(validator.resolve('www.signed.test', TYPE.A), /has no A records/);
        });

        it('must accept a proof that the name does not exist', async () => {
            world.set('nope.signed.test', TYPE.A, {
                rcode:     3,
                authority: [
                    // Covers the name
                    ...signed.nsec('alias.signed.test', '*.wild.signed.test', [TYPE.CNAME, TYPE.RRSIG, TYPE.NSEC]),
                    // Covers the wildcard that could have answered
                    ...signed.nsec('signed.test', 'alias.signed.test', [TYPE.NS, TYPE.SOA, ...SIGNED_TYPES])
                ]
            });

            const result = await validator.resolve('nope.signed.test', TYPE.A);

            assert.deepEqual(result, {negative: true, nxdomain: true, secure: true});
        });

        it('must reject a proof that does not rule out a wildcard', () => {
            world.set('nope.signed.test', TYPE.A, {
                rcode:     3,
                authority: signed.nsec('alias.signed.test', '*.wild.signed.test', [
                    TYPE.CNAME, TYPE.RRSIG, TYPE.NSEC
                ])
            });

            world.set('nope.signed.test', TYPE.DS, {
                rcode:     3,
                authority: signed.nsec('alias.signed.test', '*.wild.signed.test', [
                    TYPE.CNAME, TYPE.RRSIG, TYPE.NSEC
                ])
            });

            return assertBogus(validator.resolve('nope.signed.test', TYPE.A));
        });

        it('must accept a proof for a name that only has names below it', async () => {
            world.set('wild.signed.test', TYPE.A, {
                authority: signed.nsec('alias.signed.test', '*.wild.signed.test', [
                    TYPE.CNAME, TYPE.RRSIG, TYPE.NSEC
                ])
            });

            const result = await validator.resolve('wild.signed.test', TYPE.A);

            assert.deepEqual(result, {negative: true, nxdomain: false, secure: true});
        });

        it('must reject a negative answer of a signed zone without a proof', () => {
            world.set('www.signed.test', TYPE.A, {rcode: 3});
            world.set('www.signed.test', TYPE.DS, {
                authority: signed.nsec('www.signed.test', 'signed.test', SIGNED_TYPES)
            });

            return assertBogus(validator.resolve('www.signed.test', TYPE.A), /has no A records/);
        });

        it('must reject a proof signed by a key that is not a key of the zone', () => {
            const impostor = new Zone('signed.test');

            world.set('www.signed.test', TYPE.AAAA, {
                authority: impostor.nsec('www.signed.test', 'signed.test', SIGNED_TYPES)
            });

            world.set('www.signed.test', TYPE.DS, {
                authority: signed.nsec('www.signed.test', 'signed.test', SIGNED_TYPES)
            });

            return assertBogus(validator.resolve('www.signed.test', TYPE.AAAA));
        });

        it('must mark a negative answer of an unsigned zone as not secure', async () => {
            world.set('nope.unsigned.test', TYPE.A, {rcode: 3});

            const result = await validator.resolve('nope.unsigned.test', TYPE.A);

            assert.deepEqual(result, {negative: true, nxdomain: true, secure: false});
        });
    });

    it('must reject with the error of the server response code', () => {
        world.set('www.signed.test', TYPE.A, {rcode: 2});

        return validator.resolve('www.signed.test', TYPE.A).then(
            () => assert.fail('must be rejected'),
            error => assert.strictEqual(error.code, 'ESERVFAIL')
        );
    });

    it('must not keep a failure: the chain of trust is built again by the next call', async () => {
        world.set('www.signed.test', TYPE.A, {
            answer: signed.records('www.signed.test', TYPE.A, [rdata.a('192.0.2.1')])
        });
        world.set('test', TYPE.DNSKEY, {rcode: 2});

        await validator.resolve('www.signed.test', TYPE.A).then(
            () => assert.fail('must be rejected'),
            error => assert.strictEqual(error.code, 'ESERVFAIL')
        );

        world.set('test', TYPE.DNSKEY, {answer: test.records('test', TYPE.DNSKEY, [test.dnskeyRdata])});

        const result = await validator.resolve('www.signed.test', TYPE.A);

        assert.isTrue(result.secure);
    });
});
