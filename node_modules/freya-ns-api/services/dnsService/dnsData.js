// What a zone and a record may hold. The values are checked with the validators of
// njord-ns-server itself, so everything the API stores is something the name server can send.
const named = require('njord-ns-server');
const validators = require('njord-ns-server/lib/validators');

const HttpError = require('../httpError');

const invalid = (details) => new HttpError(400, 'Validation failed', details);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Names are stored fully qualified, in lower case and without the trailing dot.
const cleanName = (value) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/\.$/, '') : value);

// The mailbox of a SOA record is written as a domain name; a plain e-mail address is converted to it.
function cleanMailbox(value) {
    const name = cleanName(value);
    if (typeof name !== 'string') return name;
    const [local, domain, ...rest] = name.split('@');
    return domain && !rest.length && !local.includes('.') ? `${local}.${domain}` : name;
}

const HOST = { clean: cleanName, expects: 'a fully qualified host name' };
const UINT16 = 'an integer from 0 to 65535';
const UINT32 = 'an integer from 0 to 4294967295';
const TTL = 'a number of seconds from 0 to 2147483647';

// The fields of the data of each record type, named as the properties of the record classes of
// njord-ns-server: `new named.MXRecord(data.exchange, data)`. SOA is not here: it belongs to the zone.
const RECORD_TYPES = {
    A: { target: { expects: 'an IPv4 address' } },
    AAAA: { target: { expects: 'an IPv6 address' } },
    CNAME: { target: HOST },
    MX: { exchange: HOST, priority: { expects: UINT16, fallback: 0 } },
    NS: { target: HOST },
    PTR: { target: HOST },
    SRV: {
        target: { clean: cleanName, expects: 'a fully qualified domain name' },
        port: { expects: 'an integer from 1 to 65535' },
        priority: { expects: UINT16, fallback: 0 },
        weight: { expects: UINT16, fallback: 10 },
    },
    TXT: { target: { expects: 'a text of at most 65535 bytes' } },
};

const SOA_FIELDS = {
    host: { clean: cleanName, expects: 'the host name of the primary name server' },
    admin: { clean: cleanMailbox, expects: 'a mailbox written as a domain name, e.g. hostmaster.example.com' },
    serial: { expects: UINT32 },
    refresh: { expects: UINT32, fallback: 3600 },
    retry: { expects: UINT32, fallback: 600 },
    expire: { expects: UINT32, fallback: 604800 },
    ttl: { expects: UINT32, fallback: 3600 },
};

function assertOnly(data, allowed) {
    if (!isObject(data)) throw new HttpError(400, 'The request body must be a JSON object');
    const unknown = Object.keys(data).filter((key) => !allowed.includes(key));
    if (unknown.length) throw new HttpError(400, `These fields cannot be set: ${unknown.join(', ')}`);
}

// Returns the fields of `input` cleaned and completed with their defaults, in the order of `fields`.
function parseFields(input, fields, model, path) {
    if (!isObject(input)) throw invalid({ [path]: `${path} must be an object` });

    const details = {};
    for (const key of Object.keys(input)) {
        if (!(key in fields)) details[`${path}.${key}`] = `${path}.${key} is not known; use: ${Object.keys(fields).join(', ')}`;
    }

    const result = {};
    for (const [key, field] of Object.entries(fields)) {
        const value = input[key] ?? field.fallback;
        result[key] = field.clean ? field.clean(value) : value;
        if (value === undefined) details[`${path}.${key}`] = `${path}.${key} is required`;
        else if (!model[key](result[key])) details[`${path}.${key}`] = `${path}.${key} must be ${field.expects}`;
    }

    if (Object.keys(details).length) throw invalid(details);
    return result;
}

function parseType(value) {
    const type = typeof value === 'string' ? value.trim().toUpperCase() : value;
    if (type === 'SOA') throw invalid({ type: 'The SOA record is part of the zone; change it with PATCH /zones/:zoneId' });
    if (!Object.hasOwn(RECORD_TYPES, type)) {
        throw invalid({ type: `type must be one of: ${Object.keys(RECORD_TYPES).join(', ')}` });
    }
    return type;
}

const parseRecordData = (type, input) => parseFields(input, RECORD_TYPES[type], named[`${type}Record`].MODEL, 'data');
const parseSoa = (input) => parseFields(input, SOA_FIELDS, named.SOARecord.MODEL, 'soa');

function parseZoneName(value) {
    const name = cleanName(value);
    if (!validators.nsDomain(name) || !name) throw invalid({ name: 'name must be a domain name, e.g. example.com' });
    return name;
}

// The owner of a record. Accepts "@" for the zone itself, a name relative to the zone ("www"),
// and a fully qualified name ("www.example.com" or "www.example.com."). "*" may be the first label.
function parseOwnerName(value, zoneName) {
    if (typeof value !== 'string' || !value.trim()) throw invalid({ name: 'name is required; use "@" for the zone itself' });

    const raw = value.trim().toLowerCase();
    const inZone = (name) => name === zoneName || name.endsWith(`.${zoneName}`);
    let name;
    if (raw === '@') name = zoneName;
    else if (raw.endsWith('.')) name = raw.slice(0, -1);
    else name = inZone(raw) ? raw : `${raw}.${zoneName}`;

    if (!inZone(name)) throw invalid({ name: `name must be inside the zone ${zoneName}` });
    if (!validators.nsDomain(name.startsWith('*.') ? name.slice(2) : name)) {
        throw invalid({ name: 'name must be a domain name' });
    }
    return name;
}

// A fully qualified domain name, for what is not tied to a zone. "*" may be the first label when `wildcard` is set.
function parseDomainName(value, { field = 'name', wildcard = false } = {}) {
    const name = cleanName(value);
    const bare = wildcard && typeof name === 'string' && name.startsWith('*.') ? name.slice(2) : name;
    if (!bare || !validators.nsDomain(bare)) {
        throw invalid({ [field]: `${field} must be a fully qualified domain name, e.g. www.example.com` });
    }
    return name;
}

// null: no TTL of its own.
function parseTtl(value, field = 'ttl') {
    if (value === undefined || value === null) return null;
    if (!validators.ttl(value)) throw invalid({ [field]: `${field} must be ${TTL}` });
    return value;
}

function parseActive(value) {
    if (typeof value !== 'boolean') throw invalid({ active: 'active must be true or false' });
    return value;
}

module.exports = {
    RECORD_TYPES,
    invalid,
    isObject,
    assertOnly,
    parseType,
    parseRecordData,
    parseSoa,
    parseZoneName,
    parseOwnerName,
    parseDomainName,
    parseTtl,
    parseActive,
};
