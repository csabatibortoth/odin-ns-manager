// Keeps this server in step with a primary one. On a schedule it signs in to the
// primary, reads its export (/api/backup/export) and imports it here, the way
// the import of the user interface does. The primary needs no setting, only an
// admin account to sign in with.
//
// The copy goes one way, from the primary to this server. As with every import,
// nothing is deleted here: a zone that was deleted on the primary stays.
const http = require('http');
const https = require('https');
const config = require('../../config/config');
const mailService = require('./mailService');

const TICK = 30 * 1000;
const REQUEST_TIMEOUT = 60 * 1000;
const MAX_BYTES = 200 * 1024 * 1024;

const logs = () => require('../apiService/apiService').logService;

const state = { running: false, lastRunAt: null, lastSuccessAt: null, lastError: null, lastResult: null, primary: null, trigger: null };
let timer = null;
let onApplied = () => {};

// A request to the primary: resolves with the parsed JSON of the answer
function request(method, path, { body, token } = {}) {
    const base = new URL(config.syncUrl);
    const secure = base.protocol === 'https:';
    const payload = body === undefined ? null : JSON.stringify(body);

    return new Promise((resolve, reject) => {
        const req = (secure ? https : http).request(
            {
                method,
                hostname: base.hostname,
                port: base.port || (secure ? 443 : 80),
                path: `${base.pathname.replace(/\/$/, '')}${path}`,
                timeout: REQUEST_TIMEOUT,
                rejectUnauthorized: !config.syncInsecure,
                headers: {
                    Accept: 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                },
            },
            (res) => {
                const chunks = [];
                let size = 0;
                res.on('data', (chunk) => {
                    size += chunk.length;
                    if (size > MAX_BYTES) req.destroy(new Error('The answer of the primary is too large'));
                    else chunks.push(chunk);
                });
                res.on('end', () => {
                    let data = null;
                    try {
                        data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    } catch {
                        // Not JSON: the status says what happened
                    }
                    if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
                    else reject(new Error(data?.error || `The primary answered ${res.statusCode}`));
                });
            }
        );
        req.on('timeout', () => req.destroy(new Error('The primary did not answer in time')));
        req.on('error', (err) => reject(new Error(err.code ? `${err.message} (${err.code})` : err.message)));
        req.end(payload);
    });
}

function assertSetUp() {
    if (!config.syncUrl || !config.syncUser || !config.syncPassword) {
        throw Object.assign(new Error('Set the address of the primary and the user and password to sign in with'), { status: 409 });
    }
    if (!config.syncSections.length) throw Object.assign(new Error('Choose what to copy'), { status: 409 });
}

// Copies once. Resolves with the report of the import; a failure is
// remembered, logged and mailed, and thrown to the caller.
async function run(trigger = 'schedule') {
    if (state.running) throw Object.assign(new Error('A synchronization is running already'), { status: 409 });
    state.running = true;
    state.trigger = trigger;
    state.lastRunAt = new Date();
    try {
        assertSetUp();
        const { token } = await request('POST', '/api/auth/login', { body: { username: config.syncUser, password: config.syncPassword } });
        const document = await request('GET', `/api/backup/export?include=${encodeURIComponent(config.syncSections.join(','))}`, { token });
        if (document?.format !== 'freya-ns-api-export') throw new Error('The primary did not answer with an export');

        const backupService = require('freya-ns-api/services/backupService/backupService');
        const result = await backupService.importData(document, { existing: config.syncExisting }, { username: 'synchronization' });

        state.primary = { version: document.version, exportedAt: document.exportedAt };
        state.lastResult = result;
        state.lastSuccessAt = new Date();
        state.lastError = null;
        logs().addInfoLogBasicInfoEntry('Synchronized with ', config.syncUrl, ': ', result.errors?.length ? `${result.errors.length} item(s) refused` : 'done');
        onApplied(result);
        mailService.report('sync', null, { title: 'The synchronization' });
        return result;
    } catch (err) {
        state.lastError = err.message;
        logs().addErrorLogErrorEntry('Synchronization failed: ', err.message);
        mailService.report('sync', err.message, { title: 'The synchronization' });
        throw err;
    } finally {
        state.running = false;
    }
}

function due() {
    if (!config.syncEnabled || state.running) return false;
    return !state.lastRunAt || Date.now() - state.lastRunAt.getTime() >= config.syncInterval * 60 * 1000;
}

// callback(result) is called after something was imported, so the DNS server
// can pick up the zones and the blocking
function start(callback) {
    onApplied = callback || onApplied;
    if (timer) return;
    timer = setInterval(() => {
        if (due()) run().catch(() => {}); // already recorded and logged
    }, TICK);
    timer.unref();
}

function stop() {
    clearInterval(timer);
    timer = null;
}

function getState() {
    const next = config.syncEnabled && state.lastRunAt ? new Date(state.lastRunAt.getTime() + config.syncInterval * 60 * 1000) : null;
    return { enabled: config.syncEnabled, url: config.syncUrl, sections: config.syncSections, interval: config.syncInterval, ...state, nextRunAt: next };
}

module.exports = { run, start, stop, state: getState };
