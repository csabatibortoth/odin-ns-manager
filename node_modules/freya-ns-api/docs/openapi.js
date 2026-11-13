// The OpenAPI 3 description of the API, shown by Swagger UI at /api/docs and served as JSON at
// /api/docs/openapi.json. It is written by hand: a change to a route must be made here as well.
const config = require('../config/config');
const { RECORD_TYPES } = require('../services/dnsService/dnsData');

const WRITERS = `Requires one of the roles that may change the DNS data: \`${config.dnsWriteRoles.join('`, `')}\`.`;

// ---- helpers ----------------------------------------------------------------------------------------------

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const body = (schema) => ({ required: true, content: json(schema) });
const ok = (description, schema) => ({ description, content: json(schema) });
const error = (description) => ({ description, content: json(ref('Error')) });

const ERRORS = {
    400: error('The request is malformed or a value is not valid'),
    401: error('Not signed in, or the token is expired or revoked'),
    403: error('Signed in, but not allowed to do this'),
    404: error('Not found'),
    409: error('Conflicts with what is already stored'),
};

// The answers of an operation: its own, the 401 every operation has, and the listed errors.
const responses = (own, ...errors) => ({
    ...own,
    401: ERRORS[401],
    ...Object.fromEntries(errors.map((status) => [status, ERRORS[status]])),
});

const pathParam = (name, description) => ({
    name,
    in: 'path',
    required: true,
    description,
    schema: { type: 'string', pattern: '^[0-9a-f]{24}$' },
});
const queryParam = (name, schema, description) => ({ name, in: 'query', description, schema });

const PAGING = [
    queryParam('page', { type: 'integer', minimum: 1, default: 1 }, 'The page to return'),
    queryParam('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 }, 'The number of items of a page'),
];
const sortParam = (fields, fallback) =>
    queryParam(
        'sort',
        { type: 'string', enum: fields.flatMap((field) => [field, `-${field}`]), default: fallback },
        'The field to sort by, prefixed with `-` for descending'
    );
const ACTIVE = queryParam('active', { type: 'boolean' }, 'Only the active, or only the inactive ones');
const search = (where) => queryParam('q', { type: 'string' }, `Text search in ${where}`);

// The envelope every list endpoint answers with.
const page = (items) => ({
    type: 'object',
    properties: {
        items: { type: 'array', items },
        page: { type: 'integer' },
        limit: { type: 'integer' },
        total: { type: 'integer', description: 'The number of items on all pages' },
        pages: { type: 'integer' },
    },
});

const TIMESTAMPS = {
    createdAt: { type: 'string', format: 'date-time', readOnly: true },
    updatedAt: { type: 'string', format: 'date-time', readOnly: true },
};
const ID = { type: 'string', readOnly: true, example: '6af57c22d39258fa75d366fa' };
const TTL = { type: 'integer', minimum: 0, maximum: 2147483647 };

// ---- schemas ----------------------------------------------------------------------------------------------

const RECORD_DATA = {
    type: 'object',
    description:
        'The value of the record. Its fields depend on the type: `{ target }` for A, AAAA, CNAME, NS, PTR and TXT; ' +
        '`{ exchange, priority? }` for MX; `{ target, port, priority?, weight? }` for SRV. Host names must be fully qualified.',
    properties: {
        target: { type: 'string', description: 'An address, a host name or a text, by the type' },
        exchange: { type: 'string', description: 'MX: the host name of the mail server' },
        priority: { type: 'integer', minimum: 0, maximum: 65535, description: 'MX and SRV; 0 when left out' },
        weight: { type: 'integer', minimum: 0, maximum: 65535, description: 'SRV; 10 when left out' },
        port: { type: 'integer', minimum: 1, maximum: 65535, description: 'SRV' },
    },
    example: { target: '192.0.2.1' },
};

const recordInput = (name, required) => ({
    type: 'object',
    ...(required ? { required: ['name', 'type', 'data'] } : {}),
    properties: {
        name,
        ...(required ? { type: { type: 'string', enum: Object.keys(RECORD_TYPES), example: 'A' } } : {}),
        data: RECORD_DATA,
        ttl: { ...TTL, nullable: true, description: 'In seconds; `null` for the default' },
        active: { type: 'boolean', default: true },
    },
});
const ZONE_RECORD_NAME = {
    type: 'string',
    description: '`@` for the zone itself, a name relative to the zone (`www`), or a fully qualified name. The first label may be `*`.',
    example: 'www',
};
const STANDALONE_RECORD_NAME = {
    type: 'string',
    description: 'A fully qualified name. The first label may be `*`.',
    example: 'nas.home.lan',
};

const SOA_PROPERTIES = {
    host: { type: 'string', description: 'Host name of the primary name server', example: 'ns1.example.com' },
    admin: {
        type: 'string',
        description: 'Mailbox of the administrator, written as a domain name. An e-mail address is converted. Default: `hostmaster.<name>`',
        example: 'hostmaster.example.com',
    },
    serial: {
        type: 'integer',
        minimum: 0,
        maximum: 4294967295,
        description: 'Raised automatically on every change to the zone or its records',
        example: 2026111200,
    },
    refresh: { type: 'integer', default: 3600 },
    retry: { type: 'integer', default: 600 },
    expire: { type: 'integer', default: 604800 },
    ttl: { type: 'integer', default: 3600 },
};

const BLOCK_LIST_INPUT = {
    name: { type: 'string', minLength: 1, maxLength: 100, example: 'StevenBlack hosts' },
    url: {
        type: 'string',
        format: 'uri',
        description: 'An http or https address of a hosts file, a list of domains, or a list of `||domain^` adblock rules',
        example: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
    },
    description: { type: 'string', maxLength: 500 },
    active: { type: 'boolean', default: true, description: 'The domains of an inactive list are kept, but not blocked' },
};

const BLOCK_RULE_INPUT = {
    domain: { type: 'string', description: 'A fully qualified domain name', example: 'ads.example.com' },
    action: { type: 'string', enum: ['block', 'allow'], description: '`allow` takes a domain out of the block lists' },
    includeSubdomains: { type: 'boolean', default: false, description: 'Whether the rule holds for every name below the domain as well' },
    comment: { type: 'string', maxLength: 500 },
    active: { type: 'boolean', default: true },
};

const BLOCK_SETTINGS = {
    enabled: { type: 'boolean', description: 'The switch of all blocking: when false, nothing is blocked' },
    mode: {
        type: 'string',
        enum: ['NULL_IP', 'NXDOMAIN'],
        description: 'How a blocked name is answered: with `0.0.0.0` and `::`, or as a name that does not exist',
    },
};

const schemas = {
    Error: {
        type: 'object',
        properties: {
            error: { type: 'string', example: 'Validation failed' },
            details: { type: 'object', additionalProperties: { type: 'string' }, description: 'The message of each field that is not valid' },
        },
    },
    Welcome: { type: 'object', properties: { message: { type: 'string' }, version: { type: 'string' } } },
    Credentials: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
            username: { type: 'string', description: 'The username or the e-mail address', example: 'admin' },
            password: { type: 'string', format: 'password' },
        },
    },
    Login: {
        type: 'object',
        properties: {
            token: { type: 'string', description: 'Send it with every request as `Authorization: Bearer <token>`' },
            tokenType: { type: 'string', example: 'Bearer' },
            expiresIn: { type: 'string', example: '1h' },
            user: ref('User'),
        },
    },
    User: {
        type: 'object',
        properties: {
            id: ID,
            username: { type: 'string', example: 'admin' },
            email: { type: 'string', format: 'email' },
            displayName: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'user'] },
            active: { type: 'boolean' },
            lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
            ...TIMESTAMPS,
        },
    },
    UserCreate: {
        type: 'object',
        required: ['username', 'email', 'password'],
        properties: {
            username: { type: 'string', minLength: 3, maxLength: 32, pattern: '^[a-z0-9._-]+$' },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', format: 'password', minLength: 8, maxLength: 128 },
            displayName: { type: 'string', maxLength: 100 },
            role: { type: 'string', enum: ['admin', 'user'], default: 'user' },
            active: { type: 'boolean', default: true },
        },
    },
    UserUpdate: {
        type: 'object',
        description: 'Yourself: `email` and `displayName`. An admin also: `username`, `role` and `active`.',
        properties: {
            username: { type: 'string' },
            email: { type: 'string', format: 'email' },
            displayName: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'user'] },
            active: { type: 'boolean' },
        },
    },
    PasswordChange: {
        type: 'object',
        required: ['newPassword'],
        properties: {
            newPassword: { type: 'string', format: 'password', minLength: 8, maxLength: 128 },
            currentPassword: { type: 'string', format: 'password', description: 'Required when changing your own password' },
        },
    },
    Zone: {
        type: 'object',
        properties: {
            id: ID,
            name: { type: 'string', example: 'example.com' },
            ttl: { ...TTL, description: 'TTL of the records of the zone that do not set their own' },
            active: { type: 'boolean' },
            soa: { type: 'object', properties: SOA_PROPERTIES },
            ...TIMESTAMPS,
        },
    },
    ZoneCreate: {
        type: 'object',
        required: ['name', 'soa'],
        properties: {
            name: { type: 'string', description: 'The domain of the zone. Cannot be changed afterwards', example: 'example.com' },
            soa: { type: 'object', required: ['host'], properties: SOA_PROPERTIES },
            ttl: { ...TTL, default: 3600 },
            active: { type: 'boolean', default: true },
        },
    },
    ZoneUpdate: {
        type: 'object',
        properties: {
            soa: { type: 'object', description: 'The fields that are left out keep their value', properties: SOA_PROPERTIES },
            ttl: TTL,
            active: { type: 'boolean' },
        },
    },
    Record: {
        type: 'object',
        properties: {
            id: ID,
            zone: { type: 'string', nullable: true, description: 'The id of the zone; `null` for a standalone record' },
            name: { type: 'string', description: 'Fully qualified', example: 'www.example.com' },
            type: { type: 'string', enum: Object.keys(RECORD_TYPES) },
            ttl: { ...TTL, nullable: true },
            data: RECORD_DATA,
            active: { type: 'boolean' },
            ...TIMESTAMPS,
        },
    },
    ZoneRecordCreate: recordInput(ZONE_RECORD_NAME, true),
    ZoneRecordUpdate: recordInput(ZONE_RECORD_NAME, false),
    StandaloneRecordCreate: recordInput(STANDALONE_RECORD_NAME, true),
    StandaloneRecordUpdate: recordInput(STANDALONE_RECORD_NAME, false),
    BlockList: {
        type: 'object',
        properties: {
            id: ID,
            ...BLOCK_LIST_INPUT,
            status: {
                type: 'string',
                enum: ['pending', 'ok', 'error'],
                description: '`pending`: not downloaded yet; `ok` / `error`: the outcome of the last download',
            },
            lastError: { type: 'string', nullable: true, description: 'Why the last download failed' },
            refreshedAt: { type: 'string', format: 'date-time', nullable: true, description: 'The last successful download' },
            entryCount: { type: 'integer', description: 'The number of domains of the list' },
            refreshing: { type: 'boolean', description: 'Whether the list is being downloaded right now' },
            ...TIMESTAMPS,
        },
    },
    BlockListCreate: { type: 'object', required: ['name', 'url'], properties: BLOCK_LIST_INPUT },
    BlockListUpdate: { type: 'object', properties: BLOCK_LIST_INPUT },
    BlockRule: { type: 'object', properties: { id: ID, ...BLOCK_RULE_INPUT, ...TIMESTAMPS } },
    BlockRuleCreate: { type: 'object', required: ['domain', 'action'], properties: BLOCK_RULE_INPUT },
    BlockRuleUpdate: { type: 'object', properties: BLOCK_RULE_INPUT },
    BlockSettings: { type: 'object', properties: BLOCK_SETTINGS },
    BlockCheck: {
        type: 'object',
        properties: {
            domain: { type: 'string', example: 'ads.example.com' },
            blocked: { type: 'boolean', description: 'Always false while the blocking is switched off' },
            ...BLOCK_SETTINGS,
            rule: { allOf: [ref('BlockRule')], nullable: true, description: 'The rule that decides, if there is one' },
            lists: {
                type: 'array',
                description: 'The active block lists that hold the domain',
                items: { type: 'object', properties: { id: ID, name: { type: 'string' } } },
            },
        },
    },
    QueryInput: {
        type: 'object',
        required: ['client', 'name', 'type'],
        properties: {
            time: { type: 'string', format: 'date-time', description: 'When the query was answered; now when left out' },
            client: { type: 'string', description: 'The IPv4 or IPv6 address of the client', example: '192.168.1.5' },
            name: { type: 'string', description: 'The name that was asked for', example: 'www.example.com' },
            type: { type: 'string', description: 'The record type that was asked for', example: 'A' },
            status: { type: 'string', default: 'NOERROR', description: 'The response code of the answer', example: 'NOERROR' },
            blocked: { type: 'boolean', default: false, description: 'Whether the name was blocked' },
            durationMs: { type: 'number', minimum: 0, nullable: true, description: 'How long the answer took' },
        },
    },
    Query: {
        type: 'object',
        properties: {
            id: ID,
            time: { type: 'string', format: 'date-time' },
            client: { type: 'string', example: '192.168.1.5' },
            name: { type: 'string', example: 'www.example.com' },
            type: { type: 'string', example: 'A' },
            status: { type: 'string', example: 'NOERROR' },
            blocked: { type: 'boolean' },
            durationMs: { type: 'number', nullable: true },
        },
    },
    Client: {
        type: 'object',
        properties: {
            id: ID,
            address: { type: 'string', example: '192.168.1.5' },
            name: { type: 'string', description: 'Set by hand', example: 'Living room TV' },
            firstSeenAt: { type: 'string', format: 'date-time' },
            lastSeenAt: { type: 'string', format: 'date-time' },
            queries: { type: 'integer', description: 'Counted since the client was first seen' },
            blocked: { type: 'integer' },
        },
    },
    Metrics: {
        type: 'object',
        properties: {
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
            interval: { type: 'string', enum: ['hour', 'day'] },
            totals: {
                type: 'object',
                properties: {
                    queries: { type: 'integer' },
                    blocked: { type: 'integer' },
                    blockedPercent: { type: 'number' },
                    averageDurationMs: { type: 'number', nullable: true },
                    clients: { type: 'integer', description: 'The clients that were seen in the period' },
                    statuses: { type: 'object', additionalProperties: { type: 'integer' }, example: { NOERROR: 120, NXDOMAIN: 4 } },
                    types: { type: 'object', additionalProperties: { type: 'integer' }, example: { A: 90, AAAA: 34 } },
                },
            },
            series: {
                type: 'array',
                description: 'One point for every hour or day of the period, also for those without queries',
                items: {
                    type: 'object',
                    properties: {
                        time: { type: 'string', format: 'date-time', description: 'The start of the hour or day, in UTC' },
                        queries: { type: 'integer' },
                        blocked: { type: 'integer' },
                        averageDurationMs: { type: 'number', nullable: true },
                    },
                },
            },
        },
    },
    Top: {
        type: 'object',
        properties: {
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
            domains: { type: 'array', items: ref('TopName'), description: 'The names that were answered the most' },
            blockedDomains: { type: 'array', items: ref('TopName'), description: 'The names that were blocked the most' },
            clients: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: { address: { type: 'string' }, name: { type: 'string' }, count: { type: 'integer' } },
                },
            },
        },
    },
    TopName: { type: 'object', properties: { name: { type: 'string' }, count: { type: 'integer' } } },
    Export: {
        type: 'object',
        required: ['format', 'formatVersion', 'data'],
        properties: {
            format: { type: 'string', enum: ['freya-ns-api-export'] },
            formatVersion: { type: 'integer', enum: [1] },
            version: { type: 'string', description: 'The version of the system that made the export' },
            exportedAt: { type: 'string', format: 'date-time' },
            data: {
                type: 'object',
                description: 'The sections of the export. An import reads the sections that are there.',
                properties: {
                    zones: { type: 'array', description: 'The zones, each with its `records`', items: { type: 'object' } },
                    records: { type: 'array', description: 'The standalone records', items: { type: 'object' } },
                    blocking: {
                        type: 'object',
                        properties: {
                            settings: ref('BlockSettings'),
                            lists: { type: 'array', description: 'Without their domains: they are downloaded again', items: { type: 'object' } },
                            rules: { type: 'array', items: { type: 'object' } },
                        },
                    },
                    users: { type: 'array', description: 'With their password hashes', items: { type: 'object' } },
                },
            },
        },
    },
    CertificateStatus: {
        type: 'object',
        properties: {
            enabled: { type: 'boolean', description: 'Whether the API is served over HTTPS' },
            source: { type: 'string', enum: ['letsencrypt', 'custom'], description: 'Where the certificate comes from' },
            domains: {
                type: 'array',
                items: { type: 'string' },
                description: "The names the certificate is requested for from Let's Encrypt. Empty for a custom certificate",
            },
            automaticRenewal: { type: 'boolean', description: 'Whether the server renews the certificate by itself' },
            certificate: {
                type: 'object',
                nullable: true,
                description: 'The certificate that is served. `null` when HTTPS is not enabled',
                properties: {
                    subject: { type: 'string', example: 'CN=dns.example.com' },
                    issuer: { type: 'string', example: "C=US, O=Let's Encrypt, CN=E7" },
                    altNames: { type: 'array', items: { type: 'string' }, description: 'The names and addresses the certificate is valid for' },
                    validFrom: { type: 'string', format: 'date-time' },
                    validTo: { type: 'string', format: 'date-time' },
                    daysLeft: { type: 'integer', description: 'Negative when the certificate is expired' },
                    serialNumber: { type: 'string' },
                    fingerprint256: { type: 'string', description: 'The SHA-256 fingerprint' },
                },
            },
            lastCheckAt: { type: 'string', format: 'date-time', nullable: true, description: 'When a renewal was last considered or tried' },
            lastError: { type: 'string', nullable: true, description: 'Why the last renewal failed. `null` after one that succeeded' },
        },
    },
    CertificateUpload: {
        type: 'object',
        required: ['certificate', 'privateKey'],
        properties: {
            certificate: { type: 'string', description: 'The certificate in PEM format, optionally followed by its chain' },
            privateKey: { type: 'string', description: 'The private key of the certificate, in PEM format' },
        },
    },
    ImportReport: {
        type: 'object',
        properties: {
            existing: { type: 'string', enum: ['skip', 'overwrite'] },
            zones: ref('ImportCounts'),
            records: ref('ImportCounts'),
            blockSettings: { type: 'string', enum: ['updated', 'skipped', 'failed'] },
            blockLists: ref('ImportCounts'),
            blockRules: ref('ImportCounts'),
            users: ref('ImportCounts'),
            errors: {
                type: 'array',
                description: 'Why items failed; at most 100 are listed',
                items: {
                    type: 'object',
                    properties: {
                        section: { type: 'string' },
                        item: { type: 'string', nullable: true },
                        error: { type: 'string' },
                        details: { type: 'object', additionalProperties: { type: 'string' } },
                    },
                },
            },
        },
    },
    ImportCounts: {
        type: 'object',
        properties: {
            created: { type: 'integer' },
            updated: { type: 'integer' },
            skipped: { type: 'integer' },
            failed: { type: 'integer' },
        },
    },
};

// ---- paths ------------------------------------------------------------------------------------------------

const USER_ID = pathParam('id', 'The id of the user');
const ZONE_ID = pathParam('zoneId', 'The id of the zone');
const RECORD_ID = pathParam('recordId', 'The id of the record');
const LIST_ID = pathParam('listId', 'The id of the block list');
const RULE_ID = pathParam('ruleId', 'The id of the block rule');
const CLIENT_ID = pathParam('clientId', 'The id of the client');

const MONITORS = `Requires one of the roles of the monitoring: \`${config.monitoringRoles.join('`, `')}\`.`;
const RANGE = [
    queryParam('from', { type: 'string', format: 'date-time' }, 'The start of the period; 24 hours before `to` when left out'),
    queryParam('to', { type: 'string', format: 'date-time' }, 'The end of the period; now when left out'),
];

const RECORD_FILTERS = [
    ...PAGING,
    queryParam('type', { type: 'string', enum: Object.keys(RECORD_TYPES) }, 'Only the records of this type'),
    queryParam('name', { type: 'string' }, 'Only the records of this name'),
    ACTIVE,
    search('the name and the target'),
    sortParam(['name', 'type', 'ttl', 'active', 'createdAt', 'updatedAt'], 'name'),
];

// The five operations of a collection of records: those of a zone, and the standalone ones.
function recordPaths(base, tag, parameters, schemaPrefix, what) {
    return {
        [base]: {
            parameters,
            get: {
                tags: [tag],
                summary: `List ${what}`,
                parameters: RECORD_FILTERS,
                responses: responses({ 200: ok('A page of records', page(ref('Record'))) }, 400, 404),
            },
            post: {
                tags: [tag],
                summary: `Create one of ${what}`,
                description: WRITERS,
                requestBody: body(ref(`${schemaPrefix}RecordCreate`)),
                responses: responses({ 201: ok('The created record', ref('Record')) }, 400, 403, 404, 409),
            },
        },
        [`${base}/{recordId}`]: {
            parameters: [...parameters, RECORD_ID],
            get: {
                tags: [tag],
                summary: `Read one of ${what}`,
                responses: responses({ 200: ok('The record', ref('Record')) }, 404),
            },
            patch: {
                tags: [tag],
                summary: `Update one of ${what}`,
                description: `${WRITERS} The type cannot be changed. The fields of \`data\` that are left out keep their value.`,
                requestBody: body(ref(`${schemaPrefix}RecordUpdate`)),
                responses: responses({ 200: ok('The updated record', ref('Record')) }, 400, 403, 404, 409),
            },
            delete: {
                tags: [tag],
                summary: `Delete one of ${what}`,
                description: WRITERS,
                responses: responses({ 204: { description: 'Deleted' } }, 403, 404),
            },
        },
    };
}

const paths = {
    '/': {
        get: {
            tags: ['Authentication'],
            summary: 'Welcome message and version',
            responses: responses({ 200: ok('The name and the version of the server', ref('Welcome')) }),
        },
    },
    '/auth/login': {
        post: {
            tags: ['Authentication'],
            summary: 'Log in',
            description: 'The only endpoint that can be used without a token. Answers with the token for all the others.',
            security: [],
            requestBody: body(ref('Credentials')),
            responses: {
                200: ok('The token and the user', ref('Login')),
                400: ERRORS[400],
                401: error('Invalid username or password'),
            },
        },
    },
    '/auth/me': {
        get: {
            tags: ['Authentication'],
            summary: 'The current user',
            responses: responses({ 200: ok('The user of the token', ref('User')) }),
        },
    },
    '/auth/logout': {
        post: {
            tags: ['Authentication'],
            summary: 'Log out',
            description: 'Revokes every token of the current user.',
            responses: responses({ 204: { description: 'Logged out' } }),
        },
    },

    '/users': {
        get: {
            tags: ['Users'],
            summary: 'List users',
            description: 'Requires the `admin` role.',
            parameters: [
                ...PAGING,
                search('the username, the e-mail and the display name'),
                queryParam('role', { type: 'string', enum: ['admin', 'user'] }, 'Only the users of this role'),
                ACTIVE,
                queryParam('sort', { type: 'string', example: '-createdAt' }, 'The field to sort by, prefixed with `-` for descending'),
            ],
            responses: responses({ 200: ok('A page of users', page(ref('User'))) }, 400, 403),
        },
        post: {
            tags: ['Users'],
            summary: 'Create a user',
            description: 'Requires the `admin` role.',
            requestBody: body(ref('UserCreate')),
            responses: responses({ 201: ok('The created user', ref('User')) }, 400, 403, 409),
        },
    },
    '/users/{id}': {
        parameters: [USER_ID],
        get: {
            tags: ['Users'],
            summary: 'Read one user',
            description: 'Yourself, or anyone with the `admin` role.',
            responses: responses({ 200: ok('The user', ref('User')) }, 403, 404),
        },
        patch: {
            tags: ['Users'],
            summary: 'Update a user',
            description: 'Yourself, or anyone with the `admin` role. The last active admin cannot be demoted or deactivated.',
            requestBody: body(ref('UserUpdate')),
            responses: responses({ 200: ok('The updated user', ref('User')) }, 400, 403, 404, 409),
        },
        delete: {
            tags: ['Users'],
            summary: 'Delete a user',
            description: 'Requires the `admin` role. The last active admin cannot be deleted.',
            responses: responses({ 204: { description: 'Deleted' } }, 403, 404, 409),
        },
    },
    '/users/{id}/password': {
        parameters: [USER_ID],
        put: {
            tags: ['Users'],
            summary: 'Change a password',
            description: 'Yourself, or anyone with the `admin` role. Invalidates the tokens of the user.',
            requestBody: body(ref('PasswordChange')),
            responses: responses({ 204: { description: 'Changed' } }, 400, 403, 404),
        },
    },

    '/zones': {
        get: {
            tags: ['Zones'],
            summary: 'List zones',
            parameters: [
                ...PAGING,
                search('the name'),
                ACTIVE,
                sortParam(['name', 'active', 'ttl', 'createdAt', 'updatedAt'], 'name'),
            ],
            responses: responses({ 200: ok('A page of zones', page(ref('Zone'))) }, 400),
        },
        post: {
            tags: ['Zones'],
            summary: 'Create a zone',
            description: WRITERS,
            requestBody: body(ref('ZoneCreate')),
            responses: responses({ 201: ok('The created zone', ref('Zone')) }, 400, 403, 409),
        },
    },
    '/zones/{zoneId}': {
        parameters: [ZONE_ID],
        get: {
            tags: ['Zones'],
            summary: 'Read one zone',
            responses: responses({ 200: ok('The zone', ref('Zone')) }, 404),
        },
        patch: {
            tags: ['Zones'],
            summary: 'Update a zone',
            description: `${WRITERS} A zone cannot be renamed.`,
            requestBody: body(ref('ZoneUpdate')),
            responses: responses({ 200: ok('The updated zone', ref('Zone')) }, 400, 403, 404),
        },
        delete: {
            tags: ['Zones'],
            summary: 'Delete a zone and all of its records',
            description: WRITERS,
            responses: responses({ 204: { description: 'Deleted' } }, 403, 404),
        },
    },
    ...recordPaths('/zones/{zoneId}/records', 'Zone records', [ZONE_ID], 'Zone', 'the records of a zone'),
    ...recordPaths('/records', 'Standalone records', [], 'Standalone', 'the standalone records'),

    '/blocking/settings': {
        get: {
            tags: ['Blocking'],
            summary: 'Read the settings of the blocking',
            responses: responses({ 200: ok('The settings', ref('BlockSettings')) }),
        },
        patch: {
            tags: ['Blocking'],
            summary: 'Switch the blocking on or off, or change how a blocked name is answered',
            description: WRITERS,
            requestBody: body(ref('BlockSettings')),
            responses: responses({ 200: ok('The updated settings', ref('BlockSettings')) }, 400, 403),
        },
    },
    '/blocking/check': {
        get: {
            tags: ['Blocking'],
            summary: 'Tell whether a domain is blocked, and why',
            description:
                'A rule wins over the block lists: the rule of the domain itself, or else of the nearest domain above it ' +
                'that includes its subdomains. Without a rule, the domain is blocked when an active list holds exactly this name.',
            parameters: [{ ...queryParam('domain', { type: 'string' }, 'The domain to check'), required: true, example: 'ads.example.com' }],
            responses: responses({ 200: ok('The decision', ref('BlockCheck')) }, 400),
        },
    },
    '/blocking/lists': {
        get: {
            tags: ['Block lists'],
            summary: 'List block lists',
            parameters: [
                ...PAGING,
                search('the name, the url and the description'),
                ACTIVE,
                queryParam('status', { type: 'string', enum: ['pending', 'ok', 'error'] }, 'Only the lists of this status'),
                sortParam(['name', 'url', 'active', 'status', 'entryCount', 'refreshedAt', 'createdAt', 'updatedAt'], 'name'),
            ],
            responses: responses({ 200: ok('A page of block lists', page(ref('BlockList'))) }, 400),
        },
        post: {
            tags: ['Block lists'],
            summary: 'Add a block list',
            description: `${WRITERS} Answers at once with the status \`pending\`; the list is downloaded in the background.`,
            requestBody: body(ref('BlockListCreate')),
            responses: responses({ 201: ok('The created block list', ref('BlockList')) }, 400, 403, 409),
        },
    },
    '/blocking/lists/refresh': {
        post: {
            tags: ['Block lists'],
            summary: 'Download every active block list again',
            description: `${WRITERS} Answers at once; the lists are downloaded in the background, one after the other.`,
            responses: responses(
                {
                    202: ok('The number of lists whose download was started', {
                        type: 'object',
                        properties: { started: { type: 'integer' } },
                    }),
                },
                403
            ),
        },
    },
    '/blocking/lists/{listId}': {
        parameters: [LIST_ID],
        get: {
            tags: ['Block lists'],
            summary: 'Read one block list',
            responses: responses({ 200: ok('The block list', ref('BlockList')) }, 404),
        },
        patch: {
            tags: ['Block lists'],
            summary: 'Update a block list',
            description: `${WRITERS} A new \`url\` is downloaded in the background right away.`,
            requestBody: body(ref('BlockListUpdate')),
            responses: responses({ 200: ok('The updated block list', ref('BlockList')) }, 400, 403, 404, 409),
        },
        delete: {
            tags: ['Block lists'],
            summary: 'Delete a block list and all of its domains',
            description: WRITERS,
            responses: responses({ 204: { description: 'Deleted' } }, 403, 404),
        },
    },
    '/blocking/lists/{listId}/refresh': {
        parameters: [LIST_ID],
        post: {
            tags: ['Block lists'],
            summary: 'Download a block list again',
            description:
                `${WRITERS} Answers when the download is done. The answer is 200 for a failed download as well: ` +
                'its outcome is the `status` of the list, with the reason in `lastError`. A failed download keeps the domains the list had.',
            responses: responses({ 200: ok('The block list after the download', ref('BlockList')) }, 403, 404),
        },
    },
    '/blocking/lists/{listId}/entries': {
        parameters: [LIST_ID],
        get: {
            tags: ['Block lists'],
            summary: 'List the domains of a block list',
            parameters: [...PAGING, queryParam('q', { type: 'string' }, 'A part of the domain')],
            responses: responses({ 200: ok('A page of domains', page({ type: 'string', example: 'ads.example.com' })) }, 404),
        },
    },
    '/blocking/rules': {
        get: {
            tags: ['Block rules'],
            summary: 'List block rules',
            parameters: [
                ...PAGING,
                search('the domain and the comment'),
                queryParam('action', { type: 'string', enum: ['block', 'allow'] }, 'Only the rules of this action'),
                ACTIVE,
                sortParam(['domain', 'action', 'active', 'createdAt', 'updatedAt'], 'domain'),
            ],
            responses: responses({ 200: ok('A page of block rules', page(ref('BlockRule'))) }, 400),
        },
        post: {
            tags: ['Block rules'],
            summary: 'Block or allow a domain by hand',
            description: WRITERS,
            requestBody: body(ref('BlockRuleCreate')),
            responses: responses({ 201: ok('The created block rule', ref('BlockRule')) }, 400, 403, 409),
        },
    },
    '/blocking/rules/{ruleId}': {
        parameters: [RULE_ID],
        get: {
            tags: ['Block rules'],
            summary: 'Read one block rule',
            responses: responses({ 200: ok('The block rule', ref('BlockRule')) }, 404),
        },
        patch: {
            tags: ['Block rules'],
            summary: 'Update a block rule',
            description: WRITERS,
            requestBody: body(ref('BlockRuleUpdate')),
            responses: responses({ 200: ok('The updated block rule', ref('BlockRule')) }, 400, 403, 404, 409),
        },
        delete: {
            tags: ['Block rules'],
            summary: 'Delete a block rule',
            description: WRITERS,
            responses: responses({ 204: { description: 'Deleted' } }, 403, 404),
        },
    },

    '/monitoring/metrics': {
        get: {
            tags: ['Monitoring'],
            summary: 'The counters of a period, as totals and as a series over time',
            description: `${MONITORS} Counted by the hour from the recorded queries, and kept longer than the queries themselves.`,
            parameters: [
                ...RANGE,
                queryParam('interval', { type: 'string', enum: ['hour', 'day'], default: 'hour' }, 'The length of a point of the series; days are those of UTC'),
            ],
            responses: responses({ 200: ok('The metrics', ref('Metrics')) }, 400, 403),
        },
    },
    '/monitoring/top': {
        get: {
            tags: ['Monitoring'],
            summary: 'The most asked and most blocked names, and the busiest clients, of a period',
            description: `${MONITORS} Counted from the stored queries, so it reaches back as far as they are kept.`,
            parameters: [...RANGE, queryParam('limit', { type: 'integer', minimum: 1, maximum: 100, default: 10 }, 'The length of each list')],
            responses: responses({ 200: ok('The lists', ref('Top')) }, 400, 403),
        },
    },
    '/monitoring/queries': {
        get: {
            tags: ['Monitoring'],
            summary: 'List the recorded queries',
            description: MONITORS,
            parameters: [
                ...PAGING,
                queryParam('client', { type: 'string' }, 'Only the queries of this address'),
                queryParam('name', { type: 'string' }, 'Only the queries for this name'),
                queryParam('q', { type: 'string' }, 'A part of the name'),
                queryParam('type', { type: 'string' }, 'Only the queries of this record type'),
                queryParam('status', { type: 'string' }, 'Only the queries with this response code'),
                queryParam('blocked', { type: 'boolean' }, 'Only the blocked, or only the answered ones'),
                queryParam('from', { type: 'string', format: 'date-time' }, 'Only the queries from this time on'),
                queryParam('to', { type: 'string', format: 'date-time' }, 'Only the queries up to this time'),
                sortParam(['time', 'client', 'name', 'type', 'status', 'durationMs'], '-time'),
            ],
            responses: responses({ 200: ok('A page of queries', page(ref('Query'))) }, 400, 403),
        },
        post: {
            tags: ['Monitoring'],
            summary: 'Record queries the name server answered',
            description:
                `${MONITORS} This is what the name server calls. The queries are stored, counted in the metrics of their hour, ` +
                'and their clients are added to the list of clients. A batch with a query that is not valid is refused as a whole.',
            requestBody: body({
                type: 'object',
                required: ['queries'],
                properties: { queries: { type: 'array', minItems: 1, maxItems: 5000, items: ref('QueryInput') } },
            }),
            responses: responses(
                {
                    201: ok('The number of queries that were recorded', {
                        type: 'object',
                        properties: {
                            accepted: { type: 'integer' },
                            stored: { type: 'boolean', description: 'False when the queries are only counted, not kept' },
                        },
                    }),
                },
                400,
                403
            ),
        },
        delete: {
            tags: ['Monitoring'],
            summary: 'Delete the recorded queries',
            description: `${MONITORS} The metrics and the clients stay.`,
            parameters: [queryParam('before', { type: 'string', format: 'date-time' }, 'Only the queries before this time; all of them when left out')],
            responses: responses(
                { 200: ok('The number of queries that were deleted', { type: 'object', properties: { deleted: { type: 'integer' } } }) },
                400,
                403
            ),
        },
    },
    '/monitoring/clients': {
        get: {
            tags: ['Monitoring'],
            summary: 'List the clients of the name server',
            description: MONITORS,
            parameters: [
                ...PAGING,
                search('the address and the name'),
                sortParam(['address', 'name', 'firstSeenAt', 'lastSeenAt', 'queries', 'blocked'], '-lastSeenAt'),
            ],
            responses: responses({ 200: ok('A page of clients', page(ref('Client'))) }, 400, 403),
        },
    },
    '/monitoring/clients/{clientId}': {
        parameters: [CLIENT_ID],
        get: {
            tags: ['Monitoring'],
            summary: 'Read one client',
            description: MONITORS,
            responses: responses({ 200: ok('The client', ref('Client')) }, 403, 404),
        },
        patch: {
            tags: ['Monitoring'],
            summary: 'Give a client a name',
            description: MONITORS,
            requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 100 } } }),
            responses: responses({ 200: ok('The updated client', ref('Client')) }, 400, 403, 404),
        },
        delete: {
            tags: ['Monitoring'],
            summary: 'Forget a client and its counters',
            description: `${MONITORS} Its stored queries stay, and it is listed again when it sends another.`,
            responses: responses({ 204: { description: 'Deleted' } }, 403, 404),
        },
    },

    '/backup/export': {
        get: {
            tags: ['Export and import'],
            summary: 'Export the configuration of the system as one JSON document',
            description:
                'Requires the `admin` role. The monitoring data is not exported. The domains of the block lists are not ' +
                'either: the importing system downloads the lists itself.',
            parameters: [
                queryParam(
                    'include',
                    { type: 'string', default: 'zones,records,blocking', example: 'zones,records,blocking,users' },
                    'The sections to export, comma separated: `zones` (with their records), `records` (the standalone ones), ' +
                        '`blocking` and `users`. The users are exported with their password hashes, and only when asked for.'
                ),
            ],
            responses: responses({ 200: ok('The export, sent as a file to save', ref('Export')) }, 400, 403),
        },
    },
    '/backup/import': {
        post: {
            tags: ['Export and import'],
            summary: 'Import an export',
            description:
                'Requires the `admin` role. What is not there yet is created. Nothing is ever deleted. The import is not ' +
                'all-or-nothing: an item that is refused is counted as failed and listed in `errors`, and the others are imported. ' +
                'The account that runs the import is never changed by it.',
            parameters: [
                queryParam(
                    'existing',
                    { type: 'string', enum: ['skip', 'overwrite'], default: 'skip' },
                    'What happens to what is there already: it is kept as it is, or updated from the export'
                ),
            ],
            requestBody: body(ref('Export')),
            responses: responses({ 200: ok('What was done', ref('ImportReport')) }, 400, 403),
        },
    },

    '/certificate': {
        get: {
            tags: ['Certificate'],
            summary: 'Read the certificate of the HTTPS listener',
            description: 'Requires the `admin` role. The private key is never sent.',
            responses: responses({ 200: ok('The source and the certificate', ref('CertificateStatus')) }, 403),
        },
        put: {
            tags: ['Certificate'],
            summary: 'Replace the custom certificate',
            description:
                'Requires the `admin` role, and `FREYA_HTTPS_CERT_SOURCE=custom`. The certificate and its key are checked, written to ' +
                'the certificate files, and served to every new connection at once: no restart is needed. A certificate that is ' +
                'expired, or a key that does not belong to it, is refused.',
            requestBody: body(ref('CertificateUpload')),
            responses: {
                ...responses({ 200: ok('The certificate that is served now', ref('CertificateStatus')) }, 400, 403),
                409: error("HTTPS is not enabled, or the certificate comes from Let's Encrypt"),
            },
        },
    },
    '/certificate/renew': {
        post: {
            tags: ['Certificate'],
            summary: 'Renew the certificate now',
            description:
                "Requires the `admin` role. With Let's Encrypt a new certificate is requested, whether or not the current one is " +
                'due; mind the limits of the certificate authority. With a custom certificate the files are read again. ' +
                'The answer comes when it is done, which can take a minute.',
            responses: {
                ...responses({ 200: ok('The certificate that is served now', ref('CertificateStatus')) }, 403),
                409: error('HTTPS is not enabled, or the custom files cannot be used'),
                502: error('The certificate authority did not issue a certificate'),
            },
        },
    },
};

module.exports = {
    openapi: '3.0.3',
    info: {
        title: 'Freya NS API',
        version: config.version,
        description:
            'Management API of the Freya DNS server: users, zones, records, the blocking of domains, monitoring, and export / import.\n\n' +
            'Every endpoint except `POST /auth/login` requires signing in. Log in, press **Authorize**, and paste the `token` of the answer.',
        license: { name: 'MIT' },
    },
    servers: [{ url: '/api' }],
    tags: [
        { name: 'Authentication' },
        { name: 'Users' },
        { name: 'Zones' },
        { name: 'Zone records', description: 'The records of a zone' },
        { name: 'Standalone records', description: 'Records that belong to no zone' },
        { name: 'Blocking', description: 'The settings of the blocking, and the check of a domain' },
        { name: 'Block lists', description: 'Lists of domains to block, downloaded from a URL' },
        { name: 'Block rules', description: 'Domains blocked or allowed by hand; they win over the block lists' },
        { name: 'Monitoring', description: 'The queries the name server answered, its clients, and its metrics' },
        { name: 'Export and import', description: 'Moving the configuration to another system' },
        { name: 'Certificate', description: "The certificate of HTTPS: from Let's Encrypt, or a custom one" },
    ],
    // Applies to every operation that does not say otherwise.
    security: [{ bearerAuth: [] }],
    components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
        schemas,
    },
    paths,
};
