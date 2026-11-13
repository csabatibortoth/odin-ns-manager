'use strict';

const dgram  = require('node:dgram');
const dns    = require('node:dns');
const net    = require('node:net');
const crypto = require('node:crypto');

const {DnsError}                    = require('./errors');
const {encodeQuery, decodeMessage}  = require('./wire');

const DNS_PORT = 53;

const DEFAULT_TIMEOUT = 2000;
const DEFAULT_TRIES   = 3;

const RCODE_SERVFAIL = 2;
const RCODE_NOTIMP   = 4;
const RCODE_REFUSED  = 5;

// With these response codes another server may still have an answer
const RETRY_RCODES = new Set([RCODE_SERVFAIL, RCODE_NOTIMP, RCODE_REFUSED]);

/**
 * @typedef {Object} Server
 * @property {string} address
 * @property {number} port
 * @property {number} family
 */

/**
 * @param {string} text - `1.2.3.4`, `1.2.3.4:53`, `::1` or `[::1]:53`, the formats of `dns.getServers()`
 * @throws {Error}
 * @returns {Server}
 */
function parseServer(text) {
    let address = text;
    let port    = DNS_PORT;

    const bracketed = /^\[(.+)\](?::(\d+))?$/.exec(text);
    const withPort  = /^([^:]+):(\d+)$/.exec(text);

    if (bracketed) {
        address = bracketed[1];
        port    = bracketed[2] === undefined ? DNS_PORT : Number(bracketed[2]);
    } else if (withPort) {
        address = withPort[1];
        port    = Number(withPort[2]);
    }

    const family = net.isIP(address);

    if (family === 0 || port < 1 || port > 65535) {
        throw new Error(`invalid DNS server address '${text}'`);
    }

    return {address, port, family};
}

/**
 * Sends DNS queries to recursive resolvers over UDP and falls back to TCP for truncated responses.
 */
class Transport {
    /**
     * @param {Object} [options]
     * @param {string[]} [options.servers] - resolvers to use, the ones of `dns.getServers()` by default
     * @param {number} [options.timeout] - milliseconds to wait for a response of a server
     * @param {number} [options.tries] - how many times to go through the list of servers
     */
    constructor({servers, timeout = DEFAULT_TIMEOUT, tries = DEFAULT_TRIES} = {}) {
        if (servers !== undefined && (!Array.isArray(servers) || servers.length === 0)) {
            throw new Error('servers must be a not empty array of IP addresses');
        }

        if (!Number.isInteger(timeout) || timeout <= 0) {
            throw new Error('timeout must be a positive integer');
        }

        if (!Number.isInteger(tries) || tries <= 0) {
            throw new Error('tries must be a positive integer');
        }

        this._servers = servers?.map(parseServer);
        this._timeout = timeout;
        this._tries   = tries;

        // Index of the server that has answered the last time, it is asked first
        this._preferred = 0;
    }

    /**
     * @param {string} name
     * @param {number} type
     * @param {Object} [flags]
     * @param {boolean} [flags.ad]
     * @param {boolean} [flags.cd]
     * @param {boolean} [flags.dnssecOk]
     * @throws {DnsError}
     * @returns {Promise<DnsMessage>}
     */
    async query(name, type, flags = {}) {
        const servers = this._servers ?? dns.getServers().map(parseServer);

        if (servers.length === 0) {
            throw new DnsError('ECONNREFUSED', 'no DNS servers');
        }

        let lastError;

        for (let attempt = 0; attempt < this._tries; attempt++) {
            let lastResponse;

            for (let i = 0; i < servers.length; i++) {
                const index = (this._preferred + i) % servers.length;

                try {
                    const response = await this._exchange(servers[index], name, type, flags);

                    if (!RETRY_RCODES.has(response.rcode)) {
                        this._preferred = index;

                        return response;
                    }

                    lastResponse = response;
                } catch (error) {
                    lastError = error;
                }
            }

            if (lastResponse) {
                return lastResponse;
            }
        }

        throw lastError;
    }

    /**
     * @param {Server} server
     * @param {string} name
     * @param {number} type
     * @param {Object} flags
     * @returns {Promise<DnsMessage>}
     * @private
     */
    async _exchange(server, name, type, flags) {
        const id     = crypto.randomInt(0x10000);
        const packet = encodeQuery({id, name, type, ...flags});

        const isAnswer = message => {
            const [question] = message.questions;

            return message.qr &&
                message.id === id &&
                message.questions.length === 1 &&
                question.name === name &&
                question.type === type;
        };

        const response = await this._udp(server, packet, isAnswer);

        return response.tc ? this._tcp(server, packet, isAnswer) : response;
    }

    /**
     * @param {Server} server
     * @param {Buffer} packet
     * @param {Function} isAnswer
     * @returns {Promise<DnsMessage>}
     * @private
     */
    _udp(server, packet, isAnswer) {
        return new Promise((resolve, reject) => {
            // A new socket per query: the source port is random, which makes spoofing of a response harder
            const socket = dgram.createSocket(server.family === 6 ? 'udp6' : 'udp4');

            let finished = false;

            const finish = (error, message) => {
                if (finished) {
                    return;
                }

                finished = true;

                clearTimeout(timer);
                socket.close();

                if (error) {
                    reject(error instanceof DnsError ? error : new DnsError('ECONNREFUSED', error.message));
                } else {
                    resolve(message);
                }
            };

            const timer = setTimeout(() => finish(new DnsError('ETIMEOUT')), this._timeout);

            socket.on('error', finish);

            socket.on('message', data => {
                let message;

                try {
                    message = decodeMessage(data);
                } catch {
                    return;
                }

                // Anything that is not the answer to the query is ignored: the real one may still come
                if (isAnswer(message)) {
                    finish(null, message);
                }
            });

            // A connected socket takes datagrams of this server only
            socket.connect(server.port, server.address, () => {
                if (!finished) {
                    socket.send(packet, error => error && finish(error));
                }
            });
        });
    }

    /**
     * @param {Server} server
     * @param {Buffer} packet
     * @param {Function} isAnswer
     * @returns {Promise<DnsMessage>}
     * @private
     */
    _tcp(server, packet, isAnswer) {
        return new Promise((resolve, reject) => {
            const socket = net.connect({host: server.address, port: server.port});
            const chunks = [];

            let received = 0;
            let finished = false;

            const finish = (error, message) => {
                if (finished) {
                    return;
                }

                finished = true;

                socket.destroy();

                if (error) {
                    reject(error instanceof DnsError ? error : new DnsError('ECONNREFUSED', error.message));
                } else {
                    resolve(message);
                }
            };

            socket.setTimeout(this._timeout, () => finish(new DnsError('ETIMEOUT')));

            socket.on('error', finish);
            socket.on('close', () => finish(new DnsError('ECONNREFUSED', 'connection closed')));

            socket.on('connect', () => {
                const length = Buffer.alloc(2);

                length.writeUInt16BE(packet.length);

                socket.write(Buffer.concat([length, packet]));
            });

            socket.on('data', chunk => {
                chunks.push(chunk);
                received += chunk.length;

                if (received < 2) {
                    return;
                }

                const data = Buffer.concat(chunks);
                const size = data.readUInt16BE(0);

                if (data.length < size + 2) {
                    return;
                }

                try {
                    const message = decodeMessage(data.subarray(2, size + 2));

                    if (!isAnswer(message)) {
                        throw new RangeError('not the answer to the query');
                    }

                    finish(null, message);
                } catch (error) {
                    finish(new DnsError('EBADRESP', error.message));
                }
            });
        });
    }
}

module.exports = Transport;
