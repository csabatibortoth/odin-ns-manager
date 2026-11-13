'use strict';

const dgram = require('node:dgram');
const net   = require('node:net');

const {assert} = require('chai');

const Transport                    = require('../../../src/dnssec/Transport');
const {TYPE, decodeMessage}        = require('../../../src/dnssec/wire');
const {encodeResponse}             = require('../../dnssecWorld');

const LOCALHOST = '127.0.0.1';

describe('Unit: dnssec/Transport', () => {
    const closers = [];

    /**
     * Starts a DNS server on a free port of the loopback interface.
     *
     * @param {Function} udpHandler - `query => response fields | undefined`, undefined - no response
     * @param {Function} [tcpHandler]
     * @returns {Promise<{address: string, queries: Object[], tcpQueries: Object[]}>}
     */
    const startServer = async (udpHandler, tcpHandler) => {
        const udp        = dgram.createSocket('udp4');
        const queries    = [];
        const tcpQueries = [];

        const respond = (handler, log, data) => {
            const query = decodeMessage(data);

            log.push({...query, raw: data});

            const fields     = handler(query);
            const [question] = query.questions;

            return fields && encodeResponse({id: query.id, name: question.name, type: question.type, ...fields});
        };

        udp.on('message', (data, {port, address}) => {
            const response = respond(udpHandler, queries, data);

            if (response) {
                udp.send(response, port, address);
            }
        });

        await new Promise(resolve => udp.bind(0, LOCALHOST, resolve));

        const {port} = udp.address();

        closers.push(() => udp.close());

        if (tcpHandler) {
            const tcp = net.createServer(socket => {
                socket.on('error', () => {});
                socket.once('data', data => {
                    const response = respond(tcpHandler, tcpQueries, data.subarray(2));
                    const length   = Buffer.alloc(2);

                    length.writeUInt16BE(response.length);

                    // In two pieces: a response may be split between TCP segments
                    socket.write(Buffer.concat([length, response.subarray(0, 5)]));
                    setTimeout(() => socket.end(response.subarray(5)), 10);
                });
            });

            await new Promise(resolve => tcp.listen(port, LOCALHOST, resolve));

            closers.push(() => tcp.close());
        }

        return {address: `${LOCALHOST}:${port}`, queries, tcpQueries};
    };

    const answer = address => ({
        answer: [{name: 'www.example', type: TYPE.A, ttl: 30, rdata: Buffer.from(address.split('.').map(Number))}]
    });

    afterEach(() => {
        closers.splice(0).forEach(close => close());
    });

    it('must send a query and resolve with the response', async () => {
        const server    = await startServer(() => ({ad: true, ...answer('192.0.2.1')}));
        const transport = new Transport({servers: [server.address]});

        const message = await transport.query('www.example', TYPE.A, {dnssecOk: true, cd: true});

        assert.isTrue(message.ad);
        assert.deepEqual(message.answer.map(record => record.data.address), ['192.0.2.1']);

        assert.lengthOf(server.queries, 1);
        assert.deepEqual(server.queries[0].questions, [{name: 'www.example', type: TYPE.A, class: 1}]);
        // RD and CD
        assert.strictEqual(server.queries[0].raw.readUInt16BE(2), 0x0110);
    });

    it('must use a new query id every time', async () => {
        const server    = await startServer(() => answer('192.0.2.1'));
        const transport = new Transport({servers: [server.address]});

        for (let i = 0; i < 8; i++) {
            await transport.query('www.example', TYPE.A);
        }

        assert.isAbove(new Set(server.queries.map(query => query.id)).size, 1);
    });

    it('must ask again over TCP if the response is truncated', async () => {
        const server = await startServer(
            () => ({tc: true}),
            () => answer('192.0.2.2')
        );

        const transport = new Transport({servers: [server.address]});
        const message   = await transport.query('www.example', TYPE.A);

        assert.isFalse(message.tc);
        assert.deepEqual(message.answer.map(record => record.data.address), ['192.0.2.2']);
        assert.lengthOf(server.tcpQueries, 1);
        assert.strictEqual(server.tcpQueries[0].id, server.queries[0].id);
    });

    it('must ignore responses that do not answer the query', async () => {
        const udp = dgram.createSocket('udp4');

        closers.push(() => udp.close());

        udp.on('message', (data, {port, address}) => {
            const {id} = decodeMessage(data);

            const send = fields => udp.send(encodeResponse({type: TYPE.A, ...fields}), port, address);

            udp.send(Buffer.from('garbage'), port, address);
            send({id: (id + 1) % 0x10000, name: 'www.example', ...answer('203.0.113.1')});
            send({id, name: 'other.example', ...answer('203.0.113.2')});
            send({id, name: 'www.example', ...answer('192.0.2.3')});
        });

        await new Promise(resolve => udp.bind(0, LOCALHOST, resolve));

        const transport = new Transport({servers: [`${LOCALHOST}:${udp.address().port}`]});
        const message   = await transport.query('www.example', TYPE.A);

        assert.deepEqual(message.answer.map(record => record.data.address), ['192.0.2.3']);
    });

    it('must reject with ETIMEOUT if no server answers', async () => {
        const server    = await startServer(() => undefined);
        const transport = new Transport({servers: [server.address], timeout: 30, tries: 2});

        await transport.query('www.example', TYPE.A).then(
            () => assert.fail('must be rejected'),
            error => assert.strictEqual(error.code, 'ETIMEOUT')
        );

        assert.lengthOf(server.queries, 2);
    });

    it('must ask the next server if one is silent, and prefer the one that answers afterwards', async () => {
        const silent    = await startServer(() => undefined);
        const working   = await startServer(() => answer('192.0.2.4'));
        const transport = new Transport({servers: [silent.address, working.address], timeout: 30});

        const first  = await transport.query('www.example', TYPE.A);
        const second = await transport.query('www.example', TYPE.A);

        assert.deepEqual(first.answer.map(record => record.data.address), ['192.0.2.4']);
        assert.deepEqual(second.answer.map(record => record.data.address), ['192.0.2.4']);
        assert.lengthOf(silent.queries, 1);
        assert.lengthOf(working.queries, 2);
    });

    it('must ask the next server if one fails, and resolve with the failure if every one does', async () => {
        const failing   = await startServer(() => ({rcode: 2}));
        const working   = await startServer(() => answer('192.0.2.5'));

        const message = await new Transport({servers: [failing.address, working.address]})
            .query('www.example', TYPE.A);

        assert.deepEqual(message.answer.map(record => record.data.address), ['192.0.2.5']);

        const failure = await new Transport({servers: [failing.address]}).query('www.example', TYPE.A);

        assert.strictEqual(failure.rcode, 2);
    });

    describe('constructor', () => {
        [
            {servers: []},
            {servers: '1.1.1.1'},
            {servers: ['dns.example']},
            {servers: ['1.1.1.1:99999']},
            {timeout: 0},
            {timeout: '1'},
            {tries: 0},
            {tries: 1.5}
        ].forEach(options => {
            it(`must throw for ${JSON.stringify(options)}`, () => {
                assert.throws(() => new Transport(options), Error);
            });
        });

        it('must take servers in the formats of dns.getServers()', () => {
            const transport = new Transport({
                servers: ['192.0.2.1', '192.0.2.1:5353', '2001:db8::1', '[2001:db8::1]:5353']
            });

            assert.deepEqual(transport._servers, [
                {address: '192.0.2.1', port: 53, family: 4},
                {address: '192.0.2.1', port: 5353, family: 4},
                {address: '2001:db8::1', port: 53, family: 6},
                {address: '2001:db8::1', port: 5353, family: 6}
            ]);
        });
    });
});
