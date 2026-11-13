'use strict';

/**
 * DNS wire format: domain names, queries and responses.
 *
 * A domain name is kept as a lowercase string of labels joined with dots and without the trailing dot, the root is
 * an empty string. Every byte of a label except `a-z 0-9 - _ *` is written as `\DDD`, so a dot is always
 * a label separator.
 */

const {domainToASCII} = require('node:url');

const TYPE = {
    A:      1,
    NS:     2,
    CNAME:  5,
    SOA:    6,
    AAAA:   28,
    DNAME:  39,
    OPT:    41,
    DS:     43,
    RRSIG:  46,
    NSEC:   47,
    DNSKEY: 48,
    NSEC3:  50
};

const CLASS_IN = 1;

const FLAG_QR = 0x8000;
const FLAG_TC = 0x0200;
const FLAG_RD = 0x0100;
const FLAG_AD = 0x0020;
const FLAG_CD = 0x0010;

const EDNS_DO = 0x8000;

const UDP_PAYLOAD_SIZE = 1232;

const MAX_NAME_LENGTH  = 255;
const MAX_LABEL_LENGTH = 63;

const ROOT_WIRE = Buffer.from([0]);

/**
 * @param {number} byte
 * @returns {boolean}
 */
const isPlainByte = byte =>
    (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) || byte === 0x2d || byte === 0x5f || byte === 0x2a;

/**
 * @param {Buffer} label - raw label bytes
 * @returns {string}
 */
function labelToText(label) {
    let text = '';

    for (let byte of label) {
        if (byte >= 0x41 && byte <= 0x5a) {
            byte += 0x20;
        }

        text += isPlainByte(byte) ? String.fromCharCode(byte) : '\\' + String(byte).padStart(3, '0');
    }

    return text;
}

/**
 * @param {string} text
 * @returns {Buffer} lowercase label bytes
 */
function textToLabel(text) {
    const bytes = [];

    for (let i = 0; i < text.length; i++) {
        let byte = text.charCodeAt(i);

        if (byte === 0x5c) {
            const digits = text.slice(i + 1, i + 4);

            if (/^\d{3}$/.test(digits)) {
                byte = Number(digits);
                i += 3;
            } else {
                byte = text.charCodeAt(++i);
            }
        }

        if (!(byte <= 0xff)) {
            throw new RangeError('invalid character in a domain name');
        }

        bytes.push(byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte);
    }

    return Buffer.from(bytes);
}

/**
 * @param {string} name
 * @returns {string[]}
 */
const splitName = name => name === '' ? [] : name.split('.');

/**
 * @param {string} name
 * @returns {number}
 */
const countLabels = name => splitName(name).length;

/**
 * @param {string} name - not the root
 * @returns {string}
 */
function parentName(name) {
    const dot = name.indexOf('.');

    return dot === -1 ? '' : name.slice(dot + 1);
}

/**
 * @param {string} name
 * @param {string} ancestor
 * @returns {boolean} true if the name is the ancestor itself or is below it
 */
const isSubdomain = (name, ancestor) => ancestor === '' || name === ancestor || name.endsWith('.' + ancestor);

/**
 * @param {string} name
 * @returns {Buffer} canonical (lowercase, not compressed) wire form
 */
function nameToWire(name) {
    const parts = [];
    let length  = 1;

    for (const text of splitName(name)) {
        const label = textToLabel(text);

        if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
            throw new RangeError('invalid label length in a domain name');
        }

        length += label.length + 1;

        parts.push(Buffer.from([label.length]), label);
    }

    if (length > MAX_NAME_LENGTH) {
        throw new RangeError('domain name is too long');
    }

    parts.push(ROOT_WIRE);

    return Buffer.concat(parts);
}

/**
 * Turns a hostname given by a user into the internal form of a name.
 *
 * @param {string} hostname
 * @throws {RangeError}
 * @returns {string}
 */
function normalizeName(hostname) {
    let ascii = hostname;

    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7f]/.test(hostname)) {
        ascii = domainToASCII(hostname);

        if (ascii === '') {
            throw new RangeError('invalid domain name');
        }
    }

    if (ascii.endsWith('.') && !ascii.endsWith('\\.')) {
        ascii = ascii.slice(0, -1);
    }

    const name = splitName(ascii).map(label => labelToText(textToLabel(label))).join('.');

    nameToWire(name);

    return name;
}

/**
 * @param {Buffer} buffer
 * @param {number} start
 * @param {number} end
 * @returns {Buffer}
 */
function slice(buffer, start, end) {
    if (start > end || end > buffer.length) {
        throw new RangeError('truncated DNS message');
    }

    return buffer.subarray(start, end);
}

/**
 * @param {Buffer} buffer - the whole message, compression pointers are followed
 * @param {number} offset
 * @returns {{name: string, wire: Buffer, end: number}} `wire` is not compressed and keeps the letter case
 */
function readName(buffer, offset) {
    const labels = [];
    const raw    = [];

    let position = offset;
    let end      = -1;
    let jumps    = 0;
    let length   = 1;

    for (;;) {
        const size = slice(buffer, position, position + 1)[0];

        if (size === 0) {
            if (end === -1) {
                end = position + 1;
            }

            break;
        }

        if ((size & 0xc0) === 0xc0) {
            const low = slice(buffer, position + 1, position + 2)[0];

            if (end === -1) {
                end = position + 2;
            }

            if (++jumps > 127) {
                throw new RangeError('compression loop in a domain name');
            }

            position = ((size & 0x3f) << 8) | low;

            continue;
        }

        if (size > MAX_LABEL_LENGTH) {
            throw new RangeError('unsupported label type');
        }

        const label = slice(buffer, position, position + 1 + size);

        length += label.length;

        if (length > MAX_NAME_LENGTH) {
            throw new RangeError('domain name is too long');
        }

        raw.push(label);
        labels.push(labelToText(label.subarray(1)));

        position += label.length;
    }

    raw.push(ROOT_WIRE);

    return {name: labels.join('.'), wire: Buffer.concat(raw), end};
}

/**
 * @param {Buffer} bytes - 4 bytes
 * @returns {string}
 */
const formatIPv4 = bytes => bytes.join('.');

/**
 * @param {Buffer} bytes - 16 bytes
 * @returns {string} the shortest form, the same one `inet_ntop` makes
 */
function formatIPv6(bytes) {
    const groups = [];

    for (let i = 0; i < 16; i += 2) {
        groups.push(bytes.readUInt16BE(i));
    }

    let bestStart  = -1;
    let bestLength = 1;

    for (let start = 0; start < 8; start++) {
        let length = 0;

        while (start + length < 8 && groups[start + length] === 0) {
            length++;
        }

        if (length > bestLength) {
            bestStart  = start;
            bestLength = length;
        }
    }

    // ::a.b.c.d and ::ffff:a.b.c.d
    const hasIPv4Tail = bestStart === 0 && (bestLength === 6 || (bestLength === 5 && groups[5] === 0xffff));
    const count       = hasIPv4Tail ? 6 : 8;
    const hex         = groups.slice(0, count).map(group => group.toString(16));

    if (hasIPv4Tail) {
        hex.push(formatIPv4(bytes.subarray(12)));
    }

    if (bestStart === -1) {
        return hex.join(':');
    }

    const head = hex.slice(0, bestStart).join(':');
    const tail = hex.slice(bestStart + bestLength).join(':');

    return `${head}::${tail}`;
}

/**
 * @param {Buffer} buffer - NSEC or NSEC3 type bit maps
 * @returns {Set<number>}
 */
function readTypes(buffer) {
    const types = new Set();

    let position = 0;

    while (position < buffer.length) {
        const [window, size] = slice(buffer, position, position + 2);
        const bitmap         = slice(buffer, position + 2, position + 2 + size);

        if (size < 1 || size > 32) {
            throw new RangeError('invalid type bit map');
        }

        bitmap.forEach((byte, index) => {
            for (let bit = 0; bit < 8; bit++) {
                if (byte & (0x80 >> bit)) {
                    types.add(window * 256 + index * 8 + bit);
                }
            }
        });

        position += 2 + size;
    }

    return types;
}

/**
 * Key tag of a DNSKEY record, RFC 4034 Appendix B.
 *
 * @param {Buffer} rdata
 * @returns {number}
 */
function keyTag(rdata) {
    let sum = 0;

    for (let i = 0; i < rdata.length; i++) {
        sum += i & 1 ? rdata[i] : rdata[i] << 8;
    }

    sum += (sum >> 16) & 0xffff;

    return sum & 0xffff;
}

/**
 * Parses RDATA of the record types this package works with.
 * `rdata` of the result is the canonical form of RDATA (RFC 4034 6.2), which is what gets signed.
 *
 * @param {Buffer} buffer - the whole message
 * @param {number} type
 * @param {number} start
 * @param {number} end
 * @returns {{rdata: Buffer, data: Object|undefined}}
 */
function readRdata(buffer, type, start, end) {
    const rdata = slice(buffer, start, end);

    const exact = size => {
        if (rdata.length !== size) {
            throw new RangeError('invalid RDATA length');
        }
    };

    const atLeast = size => {
        if (rdata.length < size) {
            throw new RangeError('invalid RDATA length');
        }
    };

    switch (type) {
        case TYPE.A:
            exact(4);

            return {rdata, data: {address: formatIPv4(rdata)}};
        case TYPE.AAAA:
            exact(16);

            return {rdata, data: {address: formatIPv6(rdata)}};
        case TYPE.CNAME:
        case TYPE.DNAME: {
            const target = readName(buffer, start);

            if (target.end !== end) {
                throw new RangeError('invalid RDATA length');
            }

            return {rdata: nameToWire(target.name), data: {target: target.name}};
        }
        case TYPE.DS:
            atLeast(5);

            return {
                rdata,
                data: {
                    keyTag:     rdata.readUInt16BE(0),
                    algorithm:  rdata[2],
                    digestType: rdata[3],
                    digest:     rdata.subarray(4)
                }
            };
        case TYPE.DNSKEY:
            atLeast(5);

            return {
                rdata,
                data: {
                    flags:     rdata.readUInt16BE(0),
                    protocol:  rdata[2],
                    algorithm: rdata[3],
                    publicKey: rdata.subarray(4),
                    keyTag:    keyTag(rdata)
                }
            };
        case TYPE.RRSIG: {
            atLeast(19);

            const signer = readName(buffer, start + 18);

            if (signer.end > end) {
                throw new RangeError('invalid RDATA length');
            }

            return {
                rdata,
                data: {
                    typeCovered: rdata.readUInt16BE(0),
                    algorithm:   rdata[2],
                    labels:      rdata[3],
                    originalTtl: rdata.readUInt32BE(4),
                    expiration:  rdata.readUInt32BE(8),
                    inception:   rdata.readUInt32BE(12),
                    keyTag:      rdata.readUInt16BE(16),
                    signerName:  signer.name,
                    signature:   slice(buffer, signer.end, end),
                    // RDATA without the signature, the signer name is in lowercase (RFC 6840 5.1)
                    signedPrefix: Buffer.concat([rdata.subarray(0, 18), nameToWire(signer.name)])
                }
            };
        }
        case TYPE.NSEC: {
            const next   = readName(buffer, start);
            const bitmap = slice(buffer, next.end, end);

            return {
                // The next name keeps its letter case (RFC 6840 5.1)
                rdata: Buffer.concat([next.wire, bitmap]),
                data:  {nextName: next.name, types: readTypes(bitmap)}
            };
        }
        case TYPE.NSEC3: {
            atLeast(6);

            const saltEnd = 5 + rdata[4];
            const hashEnd = saltEnd + 1 + slice(rdata, saltEnd, saltEnd + 1)[0];

            return {
                rdata,
                data: {
                    hashAlgorithm: rdata[0],
                    flags:         rdata[1],
                    iterations:    rdata.readUInt16BE(2),
                    salt:          rdata.subarray(5, saltEnd),
                    nextHash:      slice(rdata, saltEnd + 1, hashEnd),
                    types:         readTypes(rdata.subarray(hashEnd))
                }
            };
        }
        default:
            return {rdata, data: undefined};
    }
}

/**
 * @typedef {Object} DnsRecord
 * @property {string} name
 * @property {number} type
 * @property {number} class
 * @property {number} ttl
 * @property {Buffer} rdata - canonical form
 * @property {Object|undefined} data - parsed RDATA
 */

/**
 * @typedef {Object} DnsMessage
 * @property {number} id
 * @property {number} rcode
 * @property {boolean} qr
 * @property {boolean} tc
 * @property {boolean} ad
 * @property {Array<{name: string, type: number, class: number}>} questions
 * @property {DnsRecord[]} answer
 * @property {DnsRecord[]} authority
 * @property {DnsRecord[]} additional
 */

/**
 * @param {Buffer} buffer
 * @throws {RangeError} if the message is malformed
 * @returns {DnsMessage}
 */
function decodeMessage(buffer) {
    slice(buffer, 0, 12);

    const flags = buffer.readUInt16BE(2);

    const message = {
        id:         buffer.readUInt16BE(0),
        rcode:      flags & 0x000f,
        qr:         Boolean(flags & FLAG_QR),
        tc:         Boolean(flags & FLAG_TC),
        ad:         Boolean(flags & FLAG_AD),
        questions:  [],
        answer:     [],
        authority:  [],
        additional: []
    };

    let position = 12;

    for (let i = buffer.readUInt16BE(4); i > 0; i--) {
        const {name, end} = readName(buffer, position);
        const fixed       = slice(buffer, end, end + 4);

        message.questions.push({name, type: fixed.readUInt16BE(0), class: fixed.readUInt16BE(2)});

        position = end + 4;
    }

    const sections = [message.answer, message.authority, message.additional];

    sections.forEach((section, index) => {
        for (let i = buffer.readUInt16BE(6 + index * 2); i > 0; i--) {
            const {name, end} = readName(buffer, position);
            const fixed       = slice(buffer, end, end + 10);
            const type        = fixed.readUInt16BE(0);
            const ttl         = fixed.readUInt32BE(4);
            const rdataStart  = end + 10;
            const rdataEnd    = rdataStart + fixed.readUInt16BE(8);

            if (type === TYPE.OPT) {
                // Upper bits of the extended RCODE
                message.rcode |= (ttl >>> 24) << 4;

                slice(buffer, rdataStart, rdataEnd);
            } else {
                section.push({
                    name,
                    type,
                    class: fixed.readUInt16BE(2),
                    // RFC 2181 8: a TTL with the top bit set is zero
                    ttl:   ttl > 0x7fffffff ? 0 : ttl,
                    ...readRdata(buffer, type, rdataStart, rdataEnd)
                });
            }

            position = rdataEnd;
        }
    });

    return message;
}

/**
 * @param {Object} query
 * @param {number} query.id
 * @param {string} query.name
 * @param {number} query.type
 * @param {boolean} [query.ad] - ask the server to tell if it has validated the answer
 * @param {boolean} [query.cd] - ask the server not to validate the answer
 * @param {boolean} [query.dnssecOk] - ask for the DNSSEC records
 * @returns {Buffer}
 */
function encodeQuery({id, name, type, ad = false, cd = false, dnssecOk = false}) {
    const header = Buffer.alloc(12);

    header.writeUInt16BE(id, 0);
    header.writeUInt16BE(FLAG_RD | (ad ? FLAG_AD : 0) | (cd ? FLAG_CD : 0), 2);
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(1, 10);

    const question = Buffer.alloc(4);

    question.writeUInt16BE(type, 0);
    question.writeUInt16BE(CLASS_IN, 2);

    // EDNS(0) OPT record: root name, type, UDP payload size, extended RCODE and flags, no options
    const opt = Buffer.alloc(11);

    opt.writeUInt16BE(TYPE.OPT, 1);
    opt.writeUInt16BE(UDP_PAYLOAD_SIZE, 3);
    opt.writeUInt16BE(dnssecOk ? EDNS_DO : 0, 7);

    return Buffer.concat([header, nameToWire(name), question, opt]);
}

/**
 * @typedef {Object} RRset
 * @property {string} name
 * @property {number} type
 * @property {number} ttl - the smallest TTL of the records
 * @property {DnsRecord[]} records
 * @property {DnsRecord[]} rrsigs - signatures that cover this set
 */

/**
 * @param {string} name
 * @param {number} type
 * @returns {string}
 */
const rrsetKey = (name, type) => `${name}/${type}`;

/**
 * @param {DnsRecord[]} section
 * @returns {Map<string, RRset>} sets by `rrsetKey`
 */
function groupRRsets(section) {
    const rrsets = new Map();

    const rrsetOf = (name, type) => {
        const key = rrsetKey(name, type);

        if (!rrsets.has(key)) {
            rrsets.set(key, {name, type, ttl: Infinity, records: [], rrsigs: []});
        }

        return rrsets.get(key);
    };

    for (const record of section) {
        if (record.class !== CLASS_IN) {
            continue;
        }

        if (record.type === TYPE.RRSIG) {
            rrsetOf(record.name, record.data.typeCovered).rrsigs.push(record);
        } else {
            const rrset = rrsetOf(record.name, record.type);

            rrset.records.push(record);
            rrset.ttl = Math.min(rrset.ttl, record.ttl);
        }
    }

    // Signatures without the records they cover are useless
    for (const [key, rrset] of rrsets) {
        if (rrset.records.length === 0) {
            rrsets.delete(key);
        }
    }

    return rrsets;
}

module.exports = {
    TYPE,
    CLASS_IN,
    UDP_PAYLOAD_SIZE,
    labelToText,
    textToLabel,
    splitName,
    countLabels,
    parentName,
    isSubdomain,
    nameToWire,
    normalizeName,
    readName,
    formatIPv6,
    keyTag,
    decodeMessage,
    encodeQuery,
    rrsetKey,
    groupRRsets
};
