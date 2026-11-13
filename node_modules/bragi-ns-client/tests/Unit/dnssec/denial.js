'use strict';

const {assert} = require('chai');

const {TYPE, nameToWire}                                               = require('../../../src/dnssec/wire');
const {nsec3Hash, base32hexDecode}                                     = require('../../../src/dnssec/crypto');
const {compareNames, proveDenial, classifyDsDenial, provesWildcardExpansion} = require('../../../src/dnssec/denial');

const SALT       = Buffer.from('aabbccdd', 'hex');
const ITERATIONS = 12;

describe('Unit: dnssec/crypto', () => {
    // RFC 5155 Appendix A
    [
        ['example', '0p9mhaveqvm6t7vbl5lop2u3t2rp3tom'],
        ['a.example', '35mthgpgcu1qg68fab165klnsnk3dpvl'],
        ['ns1.example', '2t7b4g4vsa5smi47k61mv5bv1a22bojr'],
        ['*.w.example', 'r53bq7cc2uvmubfu5ocmm6pers9tk9en']
    ].forEach(([name, expected]) => {
        it(`must compute the NSEC3 hash of ${name}`, () => {
            assert.deepEqual(nsec3Hash(nameToWire(name), SALT, ITERATIONS), base32hexDecode(expected));
        });
    });

    it('must decode base32hex', () => {
        assert.deepEqual(base32hexDecode('CPNMUOJ1E8'), Buffer.from('foobar'));
        assert.isUndefined(base32hexDecode('not base32hex!'));
    });
});

describe('Unit: dnssec/denial', () => {
    describe('compareNames', () => {
        it('must sort names in the canonical order', () => {
            // RFC 4034 6.1
            const sorted = [
                'example',
                'a.example',
                'yljkjljk.a.example',
                'z.a.example',
                'zabc.a.example',
                'z.example',
                '\\001.z.example',
                '*.z.example',
                '\\200.z.example'
            ];

            assert.deepEqual([...sorted].reverse().sort(compareNames), sorted);
        });
    });

    describe('NSEC', () => {
        const zone = 'example';

        const nsec = (name, nextName, types) => ({name, zone, nextName, types: new Set(types)});

        // example, a, *.w (so w is an empty non-terminal), sub (a delegation), z
        const apex = nsec('example', 'a.example', [TYPE.NS, TYPE.SOA, TYPE.RRSIG, TYPE.NSEC, TYPE.DNSKEY]);
        const a    = nsec('a.example', 'sub.example', [TYPE.A, TYPE.RRSIG, TYPE.NSEC]);
        const sub  = nsec('sub.example', '*.w.example', [TYPE.NS, TYPE.RRSIG, TYPE.NSEC]);
        const wild = nsec('*.w.example', 'z.example', [TYPE.A, TYPE.RRSIG, TYPE.NSEC]);
        const last = nsec('z.example', 'example', [TYPE.CNAME, TYPE.RRSIG, TYPE.NSEC]);

        it('must prove that a name has no records of a type', () => {
            assert.deepEqual(proveDenial([a], [], 'a.example', TYPE.AAAA), {result: 'nodata', optOut: false});
        });

        it('must not prove it if the type or a CNAME record is there', () => {
            assert.isUndefined(proveDenial([a], [], 'a.example', TYPE.A));
            assert.isUndefined(proveDenial([last], [], 'z.example', TYPE.A));
        });

        it('must not take the record of a delegation as a proof for the child zone', () => {
            assert.isUndefined(proveDenial([sub], [], 'sub.example', TYPE.A));
            assert.isUndefined(proveDenial([sub, apex], [], 'www.sub.example', TYPE.A));
        });

        it('must prove that a name does not exist', () => {
            assert.deepEqual(proveDenial([a, apex], [], 'b.example', TYPE.A), {result: 'nxdomain', optOut: false});
        });

        it('must prove that a name after the last one does not exist', () => {
            assert.deepEqual(
                proveDenial([last, apex], [], 'zz.example', TYPE.A),
                {result: 'nxdomain', optOut: false}
            );
        });

        it('must not prove it without the record that rules out a wildcard', () => {
            assert.isUndefined(proveDenial([a], [], 'b.example', TYPE.A));
        });

        it('must not prove anything about the names of another zone', () => {
            assert.isUndefined(proveDenial([last, apex], [], 'zz.other', TYPE.A));
        });

        it('must prove that a wildcard has no records of a type', () => {
            // sub.example < x.w.example is covered by `sub`, the wildcard *.w.example has only A
            assert.deepEqual(proveDenial([sub, wild], [], 'x.w.example', TYPE.AAAA), {result: 'nodata', optOut: false});
            assert.isUndefined(proveDenial([sub, wild], [], 'x.w.example', TYPE.A));
        });

        it('must prove that an empty non-terminal has no records', () => {
            assert.deepEqual(proveDenial([sub], [], 'w.example', TYPE.A), {result: 'nodata', optOut: false});
        });

        it('must tell what the denial of a DS record means', () => {
            assert.strictEqual(classifyDsDenial([sub], [], 'sub.example'), 'insecure');
            assert.strictEqual(classifyDsDenial([a], [], 'a.example'), 'nocut');
            assert.strictEqual(classifyDsDenial([a], [], 'b.example'), 'nocut');
            assert.isUndefined(classifyDsDenial([apex], [], 'example'));
            assert.isUndefined(classifyDsDenial([a], [], 'zz.example'));
            assert.isUndefined(classifyDsDenial(
                [nsec('signed.example', 'z.example', [TYPE.NS, TYPE.DS, TYPE.RRSIG, TYPE.NSEC])],
                [],
                'signed.example'
            ));
        });

        it('must check answers made from a wildcard', () => {
            assert.isTrue(provesWildcardExpansion([wild], [], 'x.w.example', 2));
            assert.isFalse(provesWildcardExpansion([a], [], 'x.w.example', 2));
        });
    });

    describe('NSEC3', () => {
        const zone = 'example';

        /**
         * @param {Object<string, number[]>} names - types by name
         * @param {number} [flags]
         * @returns {Object<string, Nsec3>} records of the chain by name
         */
        const chain = (names, flags = 0) => {
            const records = Object.entries(names)
                .map(([name, types]) => ({
                    name,
                    zone,
                    flags,
                    hash:       nsec3Hash(nameToWire(name), SALT, ITERATIONS),
                    iterations: ITERATIONS,
                    salt:       SALT,
                    types:      new Set(types)
                }))
                .sort((a, b) => Buffer.compare(a.hash, b.hash));

            records.forEach((record, index) => {
                record.nextHash = records[(index + 1) % records.length].hash;
            });

            return Object.fromEntries(records.map(record => [record.name, record]));
        };

        const records = chain({
            'example':     [TYPE.NS, TYPE.SOA, TYPE.RRSIG, TYPE.DNSKEY],
            'a.example':   [TYPE.A, TYPE.RRSIG],
            'sub.example': [TYPE.NS],
            'w.example':   [],
            '*.w.example': [TYPE.A, TYPE.RRSIG],
            'z.example':   [TYPE.CNAME, TYPE.RRSIG]
        });

        const all = Object.values(records);

        it('must prove that a name has no records of a type', () => {
            assert.deepEqual(
                proveDenial([], [records['a.example']], 'a.example', TYPE.AAAA),
                {result: 'nodata', optOut: false}
            );

            assert.deepEqual(
                proveDenial([], [records['w.example']], 'w.example', TYPE.A),
                {result: 'nodata', optOut: false}
            );
        });

        it('must not prove it if the type or a CNAME record is there', () => {
            assert.isUndefined(proveDenial([], all, 'a.example', TYPE.A));
            assert.isUndefined(proveDenial([], all, 'z.example', TYPE.A));
        });

        it('must prove that a name does not exist', () => {
            assert.deepEqual(proveDenial([], all, 'nope.example', TYPE.A), {result: 'nxdomain', optOut: false});
            assert.deepEqual(proveDenial([], all, 'x.y.a.example', TYPE.A), {result: 'nxdomain', optOut: false});
        });

        it('must not prove it without the record of the closest encloser', () => {
            const withoutApex = all.filter(record => record.name !== 'example');

            assert.isUndefined(proveDenial([], withoutApex, 'nope.example', TYPE.A));
        });

        it('must not prove anything about the names below a delegation', () => {
            assert.isUndefined(proveDenial([], all, 'www.sub.example', TYPE.A));
            assert.isUndefined(proveDenial([], all, 'sub.example', TYPE.A));
        });

        it('must not prove anything about the names of another zone', () => {
            assert.isUndefined(proveDenial([], all, 'nope.other', TYPE.A));
        });

        it('must prove that a wildcard has no records of a type', () => {
            assert.deepEqual(proveDenial([], all, 'x.w.example', TYPE.AAAA), {result: 'nodata', optOut: false});
            assert.isUndefined(proveDenial([], all, 'x.w.example', TYPE.A));
        });

        it('must report an opt-out span', () => {
            const optOut = Object.values(chain({'example': [TYPE.NS, TYPE.SOA], 'a.example': [TYPE.A]}, 1));

            assert.deepEqual(proveDenial([], optOut, 'nope.example', TYPE.A), {result: 'nxdomain', optOut: true});
            assert.strictEqual(classifyDsDenial([], optOut, 'nope.example'), 'insecure');
        });

        it('must tell what the denial of a DS record means', () => {
            assert.strictEqual(classifyDsDenial([], all, 'sub.example'), 'insecure');
            assert.strictEqual(classifyDsDenial([], all, 'a.example'), 'nocut');
            assert.strictEqual(classifyDsDenial([], all, 'nope.example'), 'nocut');
            assert.isUndefined(classifyDsDenial([], all, 'example'));
            assert.isUndefined(classifyDsDenial([], [], 'sub.example'));
        });

        it('must check answers made from a wildcard', () => {
            assert.isTrue(provesWildcardExpansion([], all, 'x.w.example', 2));
            assert.isFalse(provesWildcardExpansion([], all, 'a.example', 1));
            assert.isFalse(provesWildcardExpansion([], [], 'x.w.example', 2));
        });
    });
});
