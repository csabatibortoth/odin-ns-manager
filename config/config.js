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
const TRUE_WORDS = ['1', 'true', 'yes', 'on'];

const isUpstream = (value) => {
    try {
        new Resolver().setServers([value]);
        return true;
    } catch {
        return false;
    }
};

// type: string | int | bool | list. `editable: false` keeps a setting out of
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

    { group: 'Management API', key: 'apiEnabled', env: 'ODIN_API_ENABLED', type: 'bool', fallback: true, label: 'Management API', editable: false },
    { group: 'Management API', key: 'uiEnabled', env: 'ODIN_UI_ENABLED', type: 'bool', fallback: true, label: 'User interface', editable: false },
    { group: 'Management API', key: 'httpEnabled', env: 'ODIN_HTTP_ENABLED', type: 'bool', fallback: true, label: 'HTTP listener' },
    { group: 'Management API', key: 'httpServerPort', env: 'ODIN_HTTP_PORT', type: 'int', fallback: 45451, label: 'HTTP port', min: 1, max: 65535 },
    {
        group: 'Management API', key: 'httpsEnabled', env: 'ODIN_HTTPS_ENABLED', type: 'bool', fallback: false, label: 'HTTPS listener',
        hint: 'Takes the place of HTTP, and needs the key and the certificate of freya-ns-api.',
    },
    { group: 'Management API', key: 'httpsServerPort', env: 'ODIN_HTTPS_PORT', type: 'int', fallback: 45452, label: 'HTTPS port', min: 1, max: 65535 },
    {
        group: 'Management API', key: 'authEnabled', env: 'ODIN_AUTH_ENABLED', type: 'bool', fallback: true, label: 'Users have to sign in',
        hint: 'Without it everybody who reaches the API is an admin. For local development only.',
    },
    {
        group: 'Management API', key: 'dnsWriteRoles', env: 'ODIN_DNS_WRITE_ROLES', type: 'list', fallback: ['admin'], label: 'Roles that may change zones and records',
        hint: `Comma separated: ${ROLES.join(', ')}. Every signed-in user may read them.`,
        check: (value) => (value.length > 0 && value.every((role) => ROLES.includes(role))) || `must be one or more of: ${ROLES.join(', ')}`,
    },

    { group: 'Database', key: 'modelServerAddress', env: 'ODIN_DB_ADDRESS', type: 'string', fallback: '127.0.0.1', label: 'MongoDB address', editable: false },
    { group: 'Database', key: 'modelServerPort', env: 'ODIN_DB_PORT', type: 'string', fallback: '27017', label: 'MongoDB port', editable: false },
    { group: 'Database', key: 'modelServerDataBase', env: 'ODIN_DB_NAME', type: 'string', fallback: 'odin-ns-manager-1', label: 'Database name', editable: false },
    { group: 'Database', key: 'modelServerUser', env: 'ODIN_DB_USER', type: 'string', fallback: 'Test', label: 'User', editable: false, empty: true },
    { group: 'Database', key: 'modelServerPwd', env: 'ODIN_DB_PWD', type: 'string', fallback: 'Test', label: 'Password', editable: false, secret: true, empty: true },
];

const BY_KEY = new Map(SETTINGS.map((setting) => [setting.key, setting]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

///--- Reading

// The value of the environment variable of a setting; undefined when it is not set
function fromEnv(setting) {
    const raw = env[setting.env];
    if (raw === undefined) return undefined;
    if (setting.type === 'bool') return TRUE_WORDS.includes(raw.toLowerCase());
    if (setting.type === 'list') return raw.split(',').map((item) => item.trim()).filter(Boolean);
    if (setting.type === 'int') return Number(raw) || undefined;
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

// The value a setting has when the server starts now
const wanted = (setting) => fromEnv(setting) ?? stored[setting.key] ?? setting.fallback;

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
});

module.exports = config;
