'use strict';

const {assert} = require('chai');

const wire             = require('../../../src/dnssec/wire');
const {encodeResponse} = require('../../dnssecWorld');

const {TYPE} = wire;

describe('Unit: dnssec/wire', () => {
    describe('normalizeName', () => {
        [
            ['Example.COM', 'example.com'],
            ['example.com.', 'example.com'],
            ['.', ''],
            ['', ''],
            ['bücher.example', 'xn--bcher-kva.example'],
            ['_srv._tcp.example.com', '_srv._tcp.example.com'],
            ['a b.example', 'a\\032b.example']
        ].forEach(([hostname, expected]) => {
            it(`must turn '${hostname}' into '${expected}'`, () => {
                assert.strictEqual(wire.normalizeName(hostname), expected);
            });
        });

        ['a..b', `${'a'.repeat(64)}.com`, Array(130).fill('a').join('.')].forEach(hostname => {
            it(`must throw for the invalid name '${hostname.slice(0, 20)}'`, () => {
                assert.throws(() => wire.normalizeName(hostname), RangeError);
            });
        });
    });

    describe('nameToWire', () => {
        it('must encode the root as one zero byte', () => {
            assert.deepEqual(wire.nameToWire(''), Buffer.from([0]));
        });

        it('must encode labels with their lengths, in lowercase', () => {
            assert.deepEqual(wire.nameToWire('ab.c'), Buffer.from([2, 0x61, 0x62, 1, 0x63, 0]));
        });

        it('must decode escaped bytes', () => {
            assert.deepEqual(wire.nameToWire('a\\046b'), Buffer.from([3, 0x61, 0x2e, 0x62, 0]));
        });
    });

    describe('readName', () => {
        it('must follow compression pointers and keep the letter case in the wire form', () => {
            const buffer = Buffer.from([3, 0x57, 0x57, 0x57, 0xc0, 6, 2, 0x43, 0x5a, 0]);

            const {name, wire: nameWire, end} = wire.readName(buffer, 0);

            assert.strictEqual(name, 'www.cz');
            assert.deepEqual(nameWire, Buffer.from([3, 0x57, 0x57, 0x57, 2, 0x43, 0x5a, 0]));
            assert.strictEqual(end, 6);
        });

        it('must throw for a compression loop', () => {
            assert.throws(() => wire.readName(Buffer.from([0xc0, 0]), 0), RangeError);
        });

        it('must throw for a truncated name', () => {
            assert.throws(() => wire.readName(Buffer.from([5, 0x61]), 0), RangeError);
        });
    });

    describe('formatIPv6', () => {
        [
            ['20010db8000000000000000000000001', '2001:db8::1'],
            ['00000000000000000000000000000001', '::1'],
            ['00000000000000000000000000000000', '::'],
            ['20010db8000000010000000000000000', '2001:db8:0:1::'],
            ['20010db8000100010001000100010001', '2001:db8:1:1:1:1:1:1'],
            ['20010000000000010000000000000001', '2001:0:0:1::1'],
            ['00000000000000000000ffffc0000201', '::ffff:192.0.2.1']
        ].forEach(([hex, expected]) => {
            it(`must format ${expected}`, () => {
                assert.strictEqual(wire.formatIPv6(Buffer.from(hex, 'hex')), expected);
            });
        });
    });

    describe('encodeQuery', () => {
        it('must make a recursive query with an EDNS record', () => {
            const query = wire.encodeQuery({id: 0x1234, name: 'a.b', type: TYPE.AAAA});

            assert.deepEqual(query, Buffer.from([
                0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 1,
                1, 0x61, 1, 0x62, 0, 0, 28, 0, 1,
                0, 0, 41, 0x04, 0xd0, 0, 0, 0, 0, 0, 0
            ]));
        });

        it('must set the AD, CD and DO flags', () => {
            const query = wire.encodeQuery({id: 1, name: '', type: TYPE.A, ad: true, cd: true, dnssecOk: true});

            assert.strictEqual(query.readUInt16BE(2), 0x0130);
            assert.strictEqual(query.readUInt16BE(query.length - 4), 0x8000);
        });
    });

    describe('decodeMessage', () => {
        it('must decode the header, the question and the records', () => {
            const message = wire.decodeMessage(encodeResponse({
                id:     7,
                name:   'www.example',
                type:   TYPE.A,
                rcode:  3,
                ad:     true,
                answer: [
                    {name: 'www.example', type: TYPE.CNAME, ttl: 60, rdata: wire.nameToWire('host.example')},
                    {name: 'host.example', type: TYPE.A, ttl: 30, rdata: Buffer.from([192, 0, 2, 1])},
                    {
                        name:  'host.example',
                        type:  TYPE.AAAA,
                        ttl:   30,
                        rdata: Buffer.from('20010db8'.padEnd(32, '0'), 'hex')
                    }
                ]
            }));

            assert.strictEqual(message.id, 7);
            assert.strictEqual(message.rcode, 3);
            assert.isTrue(message.qr);
            assert.isTrue(message.ad);
            assert.isFalse(message.tc);
            assert.deepEqual(message.questions, [{name: 'www.example', type: TYPE.A, class: 1}]);

            assert.deepEqual(message.answer.map(({name, type, ttl, data}) => ({name, type, ttl, data})), [
                {name: 'www.example', type: TYPE.CNAME, ttl: 60, data: {target: 'host.example'}},
                {name: 'host.example', type: TYPE.A, ttl: 30, data: {address: '192.0.2.1'}},
                {name: 'host.example', type: TYPE.AAAA, ttl: 30, data: {address: '2001:db8::'}}
            ]);
        });

        it('must throw for a message cut at any byte', () => {
            const response = encodeResponse({
                name:   'www.example',
                type:   TYPE.A,
                answer: [{name: 'www.example', type: TYPE.A, ttl: 30, rdata: Buffer.from([192, 0, 2, 1])}]
            });

            for (let length = 0; length < response.length; length++) {
                assert.throws(() => wire.decodeMessage(response.subarray(0, length)), RangeError);
            }
        });

        it('must throw for an address of a wrong size', () => {
            const response = encodeResponse({
                name:   'www.example',
                type:   TYPE.A,
                answer: [{name: 'www.example', type: TYPE.A, ttl: 30, rdata: Buffer.from([192, 0, 2])}]
            });

            assert.throws(() => wire.decodeMessage(response), RangeError);
        });
    });

    describe('groupRRsets', () => {
        it('must group records by name and type and attach the signatures to the sets they cover', () => {
            const record = (name, type, ttl, data) => ({name, type, class: 1, ttl, data});

            const rrsets = wire.groupRRsets([
                record('a', TYPE.A, 30),
                record('a', TYPE.A, 10),
                record('a', TYPE.RRSIG, 30, {typeCovered: TYPE.A}),
                record('a', TYPE.AAAA, 30),
                record('b', TYPE.RRSIG, 30, {typeCovered: TYPE.A}),
                {...record('c', TYPE.A, 30), class: 3}
            ]);

            assert.sameMembers([...rrsets.keys()], [wire.rrsetKey('a', TYPE.A), wire.rrsetKey('a', TYPE.AAAA)]);

            const rrset = rrsets.get(wire.rrsetKey('a', TYPE.A));

            assert.strictEqual(rrset.ttl, 10);
            assert.lengthOf(rrset.records, 2);
            assert.lengthOf(rrset.rrsigs, 1);
        });
    });

    describe('keyTag', () => {
        it('must compute the key tag of the root KSK-2017', () => {
            const rdata = Buffer.concat([Buffer.from([1, 1, 3, 8]), Buffer.from(
                'AwEAAaz/tAm8yTn4Mfeh5eyI96WSVexTBAvkMgJzkKTOiW1vkIbzxeF3+/4RgWOq7HrxRixHlFlExOLAJr5emLvN' +
                '7SWXgnLh4+B5xQlNVz8Og8kvArMtNROxVQuCaSnIDdD5LKyWbRd2n9WGe2R8PzgCmr3EgVLrjyBxWezF0jLHwVN8' +
                'efS3rCj/EWgvIWgb9tarpVUDK/b58Da+sqqls3eNbuv7pr+eoZG+SrDK6nWeL3c6H5Apxz7LjVc1uTIdsIXxuOLY' +
                'A4/ilBmSVIzuDWfdRUfhHdY6+cn8HFRm+2hM8AnXGXws9555KrUB5qihylGa8subX2Nn6UwNR1AkUTV74bU=',
                'base64'
            )]);

            assert.strictEqual(wire.keyTag(rdata), 20326);
        });
    });
});
