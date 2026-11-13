// The settings of the server. The value of a setting is, in this order:
//
//   1. its environment variable, so secrets do not have to live in a file;
//   2. what is saved in the settings file, by the admins in the user interface;
//   3. its default below.
//
// The module exports the values the server runs with: config.nsServerPort.
// A setting that is marked `live` changes at once when it is saved; the others
// are saved, and take effect at the next start of the server.
const fs = require('fs');
const net = require('net');
const path = require('path');
const { Resolver } = require('dns');

const env = process.env;
const SETTINGS_FILE = path.resolve(__dirname, '..', env.ODIN_SETTINGS_FILE || 'config/settings.json');

const ROLES = ['admin', 'user'];
const rolesCheck = (value) => (value.length > 0 && value.every((role) => ROLES.includes(role))) || `must be one or more of: ${ROLES.join(', ')}`;
const HOST_NAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const TRUE_WORDS = ['1', 'true', 'yes', 'on'];

const isUpstream = (value) => {
    try {
        new Resolver().setServers([value]);
        return true;
    } catch {
        return false;
    }
};

// type: string | int | bool | list; a string with `options` is one of them. `editable: false` keeps a setting out of
// the user interface; `secret` keeps its value out of it as well.
const SETTINGS = [
    { group: 'General', key: 'serverName', env: 'ODIN_SERVER_NAME', type: 'string', fallback: 'odin-ns-manager-1', label: 'Server name', live: true, max: 64 },
    { group: 'General', key: 'companyName', env: 'ODIN_COMPANY_NAME', type: 'string', fallback: 'YourCompany', label: 'Company name', live: true, max: 64 },
    {
        group: 'General', key: 'type', env: 'ODIN_TYPE', type: 'string', fallback: 'DEV', label: 'Environment type', max: 16,
        hint: 'Queries are printed to the console in DEV. Anything else needs a private ODIN_SECRET.',
        check: (value) => /^[A-Za-z0-9_-]+$/.test(value) || 'letters, digits, "_" and "-" only',
    },
    { group: 'General', key: 'secret', env: 'ODIN_SECRET', type: 'string', fallback: 'Test', label: 'Token signing key', editable: false, secret: true },
    { group: 'General', key: 'logingEnabled', env: 'ODIN_LOGGING_ENABLED', type: 'bool', fallback: true, label: 'File logging' },
    { group: 'General', key: 'basicLogFolder', env: 'ODIN_LOG_FOLDER', type: 'string', fallback: 'C:\\Temp\\Odin\\Logs', label: 'Log folder', max: 260 },

    {
        group: 'DNS server', key: 'serverIPAddress', env: 'ODIN_NS_ADDRESS', type: 'string', fallback: '127.0.0.1', label: 'Listen address',
        hint: '0.0.0.0 for every IPv4 address of this machine.',
        check: (value) => net.isIP(value) !== 0 || 'must be an IP address',
    },
    { group: 'DNS server', key: 'nsServerPort', env: 'ODIN_NS_PORT', type: 'int', fallback: 53, label: 'Port', min: 1, max: 65535 },
    { group: 'DNS server', key: 'nsTcpEnabled', env: 'ODIN_NS_TCP_ENABLED', type: 'bool', fallback: true, label: 'Listen on TCP next to UDP' },
    {
        group: 'DNS server', key: 'nsZonesEnabled', env: 'ODIN_NS_ZONES_ENABLED', type: 'bool', fallback: true,
        label: 'Answer the zones and records of the database',
    },
    {
        group: 'DNS server', key: 'nsZoneRefresh', env: 'ODIN_NS_ZONE_REFRESH', type: 'int', fallback: 10, label: 'Check the database every (seconds)',
        live: true, min: 1, max: 3600,
    },

    {
        group: 'Forwarding', key: 'nsUpstreamServers', env: 'ODIN_NS_UPSTREAM', type: 'list', fallback: ['1.1.1.1', '1.0.0.1'], label: 'Upstream DNS servers',
        live: true, hint: 'Comma separated addresses, with an optional port. Empty: the DNS servers of the system.',
        check: (value) => value.every(isUpstream) || 'must be IP addresses, e.g. 1.1.1.1 or 192.0.2.1:5353',
    },
    { group: 'Forwarding', key: 'nsUpstreamTimeout', env: 'ODIN_NS_UPSTREAM_TIMEOUT', type: 'int', fallback: 2000, label: 'Upstream timeout (milliseconds)', live: true, min: 100, max: 60000 },
    { group: 'Forwarding', key: 'nsUpstreamTries', env: 'ODIN_NS_UPSTREAM_TRIES', type: 'int', fallback: 2, label: 'Upstream attempts', live: true, min: 1, max: 10 },
    { group: 'Forwarding', key: 'nsCacheEnabled', env: 'ODIN_NS_CACHE_ENABLED', type: 'bool', fallback: true, label: 'Keep answers in the cache', live: true },
    { group: 'Forwarding', key: 'nsCacheMaxEntries', env: 'ODIN_NS_CACHE_MAX_ENTRIES', type: 'int', fallback: 10000, label: 'Cache size (answers)', live: true, min: 1, max: 1000000 },
    {
        group: 'Forwarding', key: 'nsNegativeCacheTtl', env: 'ODIN_NS_NEGATIVE_CACHE_TTL', type: 'int', fallback: 30, label: 'Keep "no such name" answers for (seconds)',
        live: true, min: 1, max: 86400,
    },
    {
        group: 'Forwarding', key: 'nsDnssec', env: 'ODIN_NS_DNSSEC', type: 'string', fallback: 'off', label: 'DNSSEC for forwarded addresses', live: true,
        hint: 'Checks the A and AAAA answers of the upstream with bragi-ns-client. A forged answer of a signed domain is refused; the domains that are not signed work as before.',
        options: [
            { value: 'off', text: 'Off' },
            { value: 'validate', text: 'Validate the signatures here' },
            { value: 'trust-ad', text: 'Trust the validation of the upstream' },
        ],
    },

    {
        group: 'Blocking', key: 'nsBlocklistRefresh', env: 'ODIN_NS_BLOCKLIST_REFRESH', type: 'int', fallback: 24, label: 'Download the block lists every (hours)',
        live: true, min: 1, max: 720,
        hint: 'The switch of the blocking and the answer for a blocked name are on the Blocking page.',
    },

    {
        group: 'Monitoring', key: 'nsQueryLogEnabled', env: 'ODIN_NS_QUERY_LOG_ENABLED', type: 'bool', fallback: true, label: 'Record the queries', live: true,
        hint: 'The query log, the clients and the hourly metrics. It shows what every client looks up.',
    },
    {
        group: 'Monitoring', key: 'queryLogRetentionDays', env: 'ODIN_QUERY_LOG_RETENTION_DAYS', type: 'int', fallback: 30, label: 'Keep the queries for (days)', min: 0, max: 3650,
        hint: '0: the queries are counted in the metrics and the clients, but not stored.',
    },
    {
        group: 'Monitoring', key: 'metricsRetentionDays', env: 'ODIN_METRICS_RETENTION_DAYS', type: 'int', fallback: 365, label: 'Keep the hourly metrics for (days)', min: 0, max: 36500,
        hint: '0: forever.',
    },
    {
        group: 'Monitoring', key: 'monitoringRoles', env: 'ODIN_MONITORING_ROLES', type: 'list', fallback: ['admin'], label: 'Roles that may read the monitoring',
        hint: `Comma separated: ${ROLES.join(', ')}.`, check: rolesCheck,
    },

    { group: 'Management API', key: 'apiEnabled', env: 'ODIN_API_ENABLED', type: 'bool', fallback: true, label: 'Management API', editable: false },
    { group: 'Management API', key: 'uiEnabled', env: 'ODIN_UI_ENABLED', type: 'bool', fallback: true, label: 'User interface', editable: false },
    { group: 'Management API', key: 'httpEnabled', env: 'ODIN_HTTP_ENABLED', type: 'bool', fallback: true, label: 'HTTP listener' },
    { group: 'Management API', key: 'httpServerPort', env: 'ODIN_HTTP_PORT', type: 'int', fallback: 45451, label: 'HTTP port', min: 1, max: 65535 },
    {
        group: 'Management API', key: 'httpsEnabled', env: 'ODIN_HTTPS_ENABLED', type: 'bool', fallback: false, label: 'HTTPS listener',
        hint: 'Takes the place of HTTP, and needs a certificate: see the HTTPS certificate settings.',
    },
    { group: 'Management API', key: 'httpsServerPort', env: 'ODIN_HTTPS_PORT', type: 'int', fallback: 45452, label: 'HTTPS port', min: 1, max: 65535 },
    {
        group: 'Management API', key: 'authEnabled', env: 'ODIN_AUTH_ENABLED', type: 'bool', fallback: true, label: 'Users have to sign in',
        hint: 'Without it everybody who reaches the API is an admin. For local development only.',
    },
    {
        group: 'Management API', key: 'dnsWriteRoles', env: 'ODIN_DNS_WRITE_ROLES', type: 'list', fallback: ['admin'], label: 'Roles that may change zones, records and the blocking',
        hint: `Comma separated: ${ROLES.join(', ')}. Every signed-in user may read them.`,
        check: rolesCheck,
    },
    { group: 'Management API', key: 'docsEnabled', env: 'ODIN_DOCS_ENABLED', type: 'bool', fallback: true, label: 'Swagger UI at /api/docs' },

    {
        group: 'HTTPS certificate', key: 'httpsCertSource', env: 'ODIN_HTTPS_CERT_SOURCE', type: 'string', fallback: 'custom', label: 'Certificate from',
        options: [{ value: 'custom', text: 'Files of your own' }, { value: 'letsencrypt', text: "Let's Encrypt" }],
        hint: "Let's Encrypt needs the public names below, and port 80 of them reaching this server.",
    },
    {
        group: 'HTTPS certificate', key: 'httpsDomains', env: 'ODIN_HTTPS_DOMAINS', type: 'list', fallback: [], label: "Let's Encrypt: public names of this server",
        hint: 'Comma separated, e.g. dns.example.com. No wildcards, no IP addresses.',
        check: (value) => value.every((name) => HOST_NAME.test(name)) || 'must be full public host names',
    },
    { group: 'HTTPS certificate', key: 'acmeEmail', env: 'ODIN_ACME_EMAIL', type: 'string', fallback: '', label: "Let's Encrypt: e-mail of the account", empty: true, max: 254 },
    {
        group: 'HTTPS certificate', key: 'acmeDirectory', env: 'ODIN_ACME_DIRECTORY', type: 'string', fallback: 'production', label: "Let's Encrypt: directory", max: 500,
        hint: 'production, staging (for trying it out), or the directory URL of another ACME certificate authority.',
        check: (value) => ['production', 'staging'].includes(value) || /^https?:\/\/\S+$/.test(value) || 'must be production, staging or a URL',
    },
    {
        group: 'HTTPS certificate', key: 'acmeHttpPort', env: 'ODIN_ACME_HTTP_PORT', type: 'int', fallback: 80, label: "Let's Encrypt: port that answers the challenge", min: 1, max: 65535,
        hint: 'The authority always connects to port 80 of the name: change it only when that port is forwarded to another one.',
    },
    { group: 'HTTPS certificate', key: 'acmeFolder', env: 'ODIN_ACME_FOLDER', type: 'string', fallback: 'sslcert/letsencrypt', label: "Let's Encrypt: folder of the keys", editable: false },
    { group: 'HTTPS certificate', key: 'httpsKeyFile', env: 'ODIN_HTTPS_KEY', type: 'string', fallback: 'sslcert/server.key', label: 'Own certificate: private key file', editable: false },
    { group: 'HTTPS certificate', key: 'httpsCertFile', env: 'ODIN_HTTPS_CERT', type: 'string', fallback: 'sslcert/server.crt', label: 'Own certificate: certificate file', editable: false },
    {
        group: 'HTTPS certificate', key: 'httpsKeyPassphrase', env: 'ODIN_HTTPS_KEY_PASSPHRASE', type: 'string', fallback: '', label: 'Own certificate: passphrase of the key',
        editable: false, secret: true, empty: true,
    },

    { group: 'Database', key: 'modelServerAddress', env: 'ODIN_DB_ADDRESS', type: 'string', fallback: '127.0.0.1', label: 'MongoDB address', editable: false },
    { group: 'Database', key: 'modelServerPort', env: 'ODIN_DB_PORT', type: 'string', fallback: '27017', label: 'MongoDB port', editable: false },
    { group: 'Database', key: 'modelServerDataBase', env: 'ODIN_DB_NAME', type: 'string', fallback: 'odin-ns-manager-1', label: 'Database name', editable: false },
    { group: 'Database', key: 'modelServerUser', env: 'ODIN_DB_USER', type: 'string', fallback: 'Test', label: 'User', editable: false, empty: true },
    { group: 'Database', key: 'modelServerPwd', env: 'ODIN_DB_PWD', type: 'string', fallback: 'Test', label: 'Password', editable: false, secret: true, empty: true },
];

const BY_KEY = new Map(SETTINGS.map((setting) => [setting.key, setting]));

// Settings of the releases before 2.3.0 that now live in the database, with the blocking of freya-ns-api.
// What was set for them is read once more, to be carried over: see services/apiService/migration.js.
const LEGACY = { nsBlockingEnabled: 'ODIN_NS_BLOCKING_ENABLED', nsBlockMode: 'ODIN_NS_BLOCK_MODE' };
const legacy = {};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

///--- Reading

// The value of the environment variable of a setting; undefined when it is not set
function fromEnv(setting) {
    const raw = env[setting.env];
    if (raw === undefined) return undefined;
    if (setting.type === 'bool') return TRUE_WORDS.includes(raw.toLowerCase());
    if (setting.type === 'list') return raw.split(',').map((item) => item.trim()).filter(Boolean);
    // 0 is a value of its own
    if (setting.type === 'int') return raw.trim() !== '' && Number.isInteger(Number(raw)) ? Number(raw) : undefined;
    return raw || setting.empty ? raw : undefined;
}

// Returns the value in the form it is kept in, or throws an Error with the
// reason it can not be accepted.
function parse(setting, value) {
    const fail = (reason) => {
        throw new Error(reason);
    };

    if (setting.type === 'bool') {
        if (typeof value !== 'boolean') fail('must be true or false');
    } else if (setting.type === 'int') {
        if (!Number.isInteger(value)) fail('must be a whole number');
        if (value < setting.min || value > setting.max) fail(`must be from ${setting.min} to ${setting.max}`);
    } else if (setting.type === 'list') {
        if (typeof value === 'string') value = value.split(',');
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) fail('must be a list of texts');
        value = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
    } else {
        if (typeof value !== 'string') fail('must be a text');
        value = value.trim();
        if (!value && !setting.empty) fail('must not be empty');
        if (setting.max && value.length > setting.max) fail(`must be at most ${setting.max} characters`);
    }

    if (setting.options && !setting.options.some((option) => option.value === value)) {
        fail(`must be one of: ${setting.options.map((option) => option.value).join(', ')}`);
    }
    const checked = setting.check ? setting.check(value) : true;
    if (checked !== true) fail(checked);
    return value;
}

// What is saved in the settings file; what is not valid in it is left out
function readStored() {
    let saved;
    try {
        saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch (err) {
        if (err.code !== 'ENOENT') console.error(`The settings file ${SETTINGS_FILE} can not be read: ${err.message}`);
        return {};
    }

    const stored = {};
    for (const [key, value] of Object.entries(saved && typeof saved === 'object' ? saved : {})) {
        if (key in LEGACY) {
            legacy[key] = value;
            continue;
        }
        const setting = BY_KEY.get(key);
        try {
            if (!setting || setting.editable === false) throw new Error('can not be set here');
            stored[key] = parse(setting, value);
        } catch (err) {
            console.error(`Setting "${key}" of ${SETTINGS_FILE} is ignored: ${err.message}`);
        }
    }
    return stored;
}

let stored = readStored();
if (env[LEGACY.nsBlockingEnabled] !== undefined) legacy.nsBlockingEnabled = TRUE_WORDS.includes(env[LEGACY.nsBlockingEnabled].toLowerCase());
if (env[LEGACY.nsBlockMode] !== undefined) legacy.nsBlockMode = env[LEGACY.nsBlockMode];

// The value a setting has when the server starts now. A value of the
// environment that is not one of the options of the setting is not used.
function wanted(setting) {
    let value = fromEnv(setting);
    if (value !== undefined && setting.options && !setting.options.some((option) => option.value === value)) value = undefined;
    return value ?? stored[setting.key] ?? setting.fallback;
}

const config = {};
for (const setting of SETTINGS) config[setting.key] = wanted(setting);

config.version = require('../package.json').version;
config.modelServerType = 'MNG';

///--- Changing

const listeners = [];

function invalid(details) {
    return Object.assign(new Error('Validation failed'), { status: 400, details });
}

// Every setting with its value, where the value comes from, and whether it
// waits for a restart; grouped for the user interface.
function describe() {
    const groups = [];
    for (const setting of SETTINGS) {
        const fromEnvironment = fromEnv(setting) !== undefined;
        let source = 'default';
        if (fromEnvironment) source = 'environment';
        else if (setting.key in stored) source = 'saved';

        const item = {
            key: setting.key,
            label: setting.label,
            type: setting.type,
            hint: setting.hint,
            options: setting.options,
            min: setting.min,
            max: setting.max,
            env: setting.env,
            source,
            editable: setting.editable !== false && !fromEnvironment,
            live: Boolean(setting.live),
        };
        if (!setting.secret) {
            item.value = config[setting.key];
            item.fallback = setting.fallback;
            // Saved, but the server still runs with the value it was started with
            if (!same(wanted(setting), config[setting.key])) item.pending = wanted(setting);
        }

        let group = groups.find((candidate) => candidate.title === setting.group);
        if (!group) groups.push((group = { title: setting.group, settings: [] }));
        group.settings.push(item);
    }
    return { groups, restartNeeded: groups.some((group) => group.settings.some((item) => 'pending' in item)) };
}

// changes: { key: value } - null brings a setting back to its default. Saves
// them to the settings file, and applies the live ones. Nothing is changed
// when one of them is not valid. Returns the keys that were changed.
function update(changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
        throw Object.assign(new Error('The request body must be a JSON object'), { status: 400 });
    }

    const next = { ...stored };
    const details = {};
    for (const [key, value] of Object.entries(changes)) {
        const setting = BY_KEY.get(key);
        if (!setting) details[key] = `${key} is not a setting`;
        else if (setting.editable === false) details[key] = `${setting.label} can only be set with ${setting.env}`;
        else if (fromEnv(setting) !== undefined) details[key] = `${setting.label} is set by ${setting.env} in the environment`;
        else if (value === null) delete next[key];
        else {
            try {
                next[key] = parse(setting, value);
            } catch (err) {
                details[key] = `${setting.label} ${err.message}`;
            }
        }
    }

    // Changes that would lock everybody out at the next start
    const after = (key) => fromEnv(BY_KEY.get(key)) ?? next[key] ?? BY_KEY.get(key).fallback;
    if (('type' in changes) && !details.type && after('type') !== 'DEV' && config.secret === 'Test') {
        details.type = 'Set ODIN_SECRET to a private value first: the API does not start outside of DEV without it';
    }
    if (!after('httpEnabled') && !after('httpsEnabled')) {
        const key = 'httpsEnabled' in changes && !('httpEnabled' in changes) ? 'httpsEnabled' : 'httpEnabled';
        details[key] ??= 'HTTP or HTTPS has to stay enabled';
    }
    if (Object.keys(details).length) throw invalid(details);

    const changed = Object.keys(changes).filter((key) => !same(stored[key], next[key]));
    if (!changed.length) return [];

    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    const temporary = `${SETTINGS_FILE}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 4)}\n`);
    fs.renameSync(temporary, SETTINGS_FILE);
    stored = next;

    const live = changed.filter((key) => BY_KEY.get(key).live);
    for (const key of live) config[key] = wanted(BY_KEY.get(key));
    if (live.length) for (const listener of listeners) listener(live);
    return changed;
}

// listener(keys) is called after live settings were changed
function onChange(listener) {
    listeners.push(listener);
}

// Not enumerable: the values are what the object is about
Object.defineProperties(config, {
    describe: { value: describe },
    update: { value: update },
    onChange: { value: onChange },
    settingsFile: { value: SETTINGS_FILE },
    // { nsBlockingEnabled?, nsBlockMode? } - what was set before the blocking moved to the database
    legacy: { value: legacy },
});

module.exports = config;
