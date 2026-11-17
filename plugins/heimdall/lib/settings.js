// The settings of the plugin: where Heimdall is, and who this server is there.
//
// They are kept in data/settings.json (mode 600, as it holds the license key), and the
// environment can override them: HEIMDALL_URL, HEIMDALL_AGENT_UID, HEIMDALL_LICENSE_KEY.
// A setting that comes from the environment can not be changed in the interface.
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = 'settings.json';
const UID = /^[A-Za-z0-9_-]{4,128}$/;
const KEY = /^[\x21-\x7e]{8,512}$/;
const SOURCE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const DEFAULTS = Object.freeze({
    url: '',
    agentUid: '',
    licenseKey: '',
    source: '',
    intervalSeconds: 60,
    allowInsecure: false,
    sendLogs: true,
});

const ENV = { url: 'HEIMDALL_URL', agentUid: 'HEIMDALL_AGENT_UID', licenseKey: 'HEIMDALL_LICENSE_KEY' };

// The address of Heimdall as an origin, or throws why not. http is for this machine only,
// unless allowInsecure is set: the license key would cross the network in the clear.
function checkUrl(value, allowInsecure) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error('The address is not a URL, for example https://heimdall.example.com');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The address has to start with https://');
    if (url.username || url.password) throw new Error('The address must not hold a user name or a password');
    if (url.pathname !== '/' || url.search || url.hash) throw new Error('Give only the address of the server, without a path');
    if (url.protocol === 'http:' && !LOCAL.has(url.hostname) && !allowInsecure) {
        throw new Error('http is only for this machine: use https, or allow an unencrypted connection explicitly');
    }
    return url.origin;
}

// Checks a change (only the fields that are there) against the current settings; returns what to keep
function validate(change, current) {
    const next = { ...current };
    const has = (key) => change[key] !== undefined;

    if (has('allowInsecure')) next.allowInsecure = change.allowInsecure === true;
    if (has('sendLogs')) next.sendLogs = change.sendLogs === true;
    if (has('url')) next.url = String(change.url).trim() === '' ? '' : checkUrl(String(change.url).trim(), next.allowInsecure);
    if (next.url) checkUrl(next.url, next.allowInsecure);

    if (has('agentUid')) {
        next.agentUid = String(change.agentUid).trim();
        if (next.agentUid && !UID.test(next.agentUid)) throw new Error('The agent UID is not what Heimdall gives out');
    }
    // A key that is not sent stays as it is: the interface never gets it back
    if (has('licenseKey') && String(change.licenseKey) !== '') {
        next.licenseKey = String(change.licenseKey).trim();
        if (!KEY.test(next.licenseKey)) throw new Error('The license key is not what Heimdall gives out');
    }
    if (has('source')) {
        next.source = String(change.source).trim();
        if (next.source && !SOURCE.test(next.source)) throw new Error('The name can have letters, digits, . _ : - (up to 64)');
    }
    if (has('intervalSeconds')) {
        const seconds = Number(change.intervalSeconds);
        if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) throw new Error('The interval is between 10 and 3600 seconds');
        next.intervalSeconds = seconds;
    }
    return next;
}

function createSettings(folder, env = process.env) {
    const file = path.join(folder, FILE);
    let saved = { ...DEFAULTS };

    try {
        saved = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (err) {
        if (err.code !== 'ENOENT') throw new Error(`${FILE} can not be read: ${err.message}`);
    }

    // What counts: the file, then the environment on top
    const effective = () => {
        const merged = { ...saved };
        for (const [key, name] of Object.entries(ENV)) if (env[name]) merged[key] = env[name];
        if (!merged.source) merged.source = os.hostname().replace(/[^A-Za-z0-9_.:-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 64) || 'odin';
        return merged;
    };

    return {
        get: effective,
        fromEnvironment: () => Object.keys(ENV).filter((key) => env[ENV[key]]),
        configured() {
            const now = effective();
            return Boolean(now.url && now.agentUid && now.licenseKey);
        },
        // What the interface may see: everything but the key
        describe() {
            const { licenseKey, ...rest } = effective();
            return { ...rest, licenseKeySet: Boolean(licenseKey), fromEnvironment: this.fromEnvironment() };
        },
        update(change) {
            const locked = this.fromEnvironment();
            for (const key of Object.keys(change)) {
                if (locked.includes(key) && String(change[key]) !== '' && change[key] !== saved[key]) throw new Error(`${ENV[key]} is set in the environment of the server, so it can not be changed here`);
            }
            saved = validate(Object.fromEntries(Object.entries(change).filter(([key]) => !locked.includes(key))), saved);
            fs.mkdirSync(folder, { recursive: true });
            // Written next to the file and renamed, so a crash never leaves half of it
            const temporary = `${file}.${process.pid}.tmp`;
            fs.writeFileSync(temporary, JSON.stringify(saved, null, 2), { mode: 0o600 });
            fs.renameSync(temporary, file);
            return this.describe();
        },
        // Forgets the connection (the URL, the agent and the key)
        clear() {
            saved = { ...saved, url: '', agentUid: '', licenseKey: '' };
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
            return this.describe();
        },
    };
}

module.exports = { createSettings, checkUrl, DEFAULTS };
