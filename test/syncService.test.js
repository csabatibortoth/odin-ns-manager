// The synchronization with a primary server, against a small server that stands for it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

for (const name of Object.keys(process.env)) if (name.startsWith('ODIN_')) delete process.env[name];
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'odin-sync-'));
process.env.ODIN_SETTINGS_FILE = path.join(folder, 'settings.json');

const stub = (request, exports) => {
    const file = require.resolve(request);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
const logged = [];
stub('../services/apiService/apiService', { logService: new Proxy({}, { get: (_, level) => (...parts) => logged.push([level, parts.join('')]) }) });
const imported = [];
stub('freya-ns-api/services/backupService/backupService', {
    importData: async (document, query, actor) => {
        imported.push({ document, query, actor });
        return { zones: { created: 1, updated: 0, skipped: 0, failed: 0 }, errors: [] };
    },
});

const config = require('../config/config');
const mailService = require('../services/serverService/mailService');
const syncService = require('../services/serverService/syncService');

const mails = [];
mailService.notify = async (subject) => mails.push(subject);

let primary;
let exportQuery;
let wrongPassword = false;

before(async () => {
    primary = http.createServer((req, res) => {
        const json = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
        if (req.method === 'POST' && req.url === '/api/auth/login') {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                const { username, password } = JSON.parse(body);
                if (wrongPassword || username !== 'sync' || password !== 'secret-pass') return json(401, { error: 'Invalid username or password' });
                return json(200, { token: 'abc' });
            });
        } else if (req.url.startsWith('/api/backup/export')) {
            exportQuery = req.url;
            if (req.headers.authorization !== 'Bearer abc') return json(401, { error: 'no token' });
            return json(200, { format: 'freya-ns-api-export', version: '2.2.0', exportedAt: '2026-11-16T10:00:00Z', data: { zones: [] } });
        } else json(404, { error: 'Not found' });
    });
    await new Promise((resolve) => primary.listen(0, '127.0.0.1', resolve));
    config.syncEnabled = true;
    config.syncUrl = `http://127.0.0.1:${primary.address().port}`;
    config.syncUser = 'sync';
    config.syncPassword = 'secret-pass';
});

after(async () => {
    await new Promise((resolve) => primary.close(resolve));
    fs.rmSync(folder, { recursive: true, force: true });
});

test('a run signs in, reads the export of the chosen sections and imports it', async () => {
    let applied = null;
    syncService.start((result) => (applied = result));
    const result = await syncService.run('manual');
    syncService.stop();

    assert.equal(result.zones.created, 1);
    assert.equal(applied.zones.created, 1);
    assert.match(exportQuery, /include=zones%2Crecords%2Cblocking/);
    assert.equal(imported[0].query.existing, 'overwrite');
    const state = syncService.state();
    assert.equal(state.lastError, null);
    assert.equal(state.primary.version, '2.2.0');
    assert.ok(state.lastSuccessAt);
});

test('a failure is kept, mailed once, and a mail tells when it works again', async () => {
    wrongPassword = true;
    await assert.rejects(syncService.run(), /Invalid username or password/);
    await assert.rejects(syncService.run(), /Invalid username or password/);
    assert.equal(syncService.state().lastError, 'Invalid username or password');
    assert.deepEqual(mails, ['The synchronization failed']);

    wrongPassword = false;
    await syncService.run();
    assert.deepEqual(mails, ['The synchronization failed', 'The synchronization works again']);
    assert.equal(syncService.state().lastError, null);
});

test('without the account of the primary there is nothing to run', async () => {
    config.syncPassword = '';
    await assert.rejects(syncService.run(), /Set the address of the primary/);
    config.syncPassword = 'secret-pass';
});
