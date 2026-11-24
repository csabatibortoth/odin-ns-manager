// Exercise the real router and auth middleware without starting the DNS server
// or connecting to MongoDB. User lookup is stubbed; token verification and role
// checks remain the production middleware.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

for (const name of Object.keys(process.env)) {
    if (name.startsWith('ODIN_') || name.startsWith('FREYA_')) delete process.env[name];
}

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'odin-config-route-'));
const settingsFile = path.join(folder, 'settings.json');
const originalSettings = { serverName: 'route-security-test', nsServerPort: 5353 };
fs.writeFileSync(settingsFile, JSON.stringify(originalSettings));

const signingKey = 'odin-route-test-signing-key-that-is-not-used-outside-this-test';
process.env.ODIN_SETTINGS_FILE = settingsFile;
process.env.FREYA_SECRET = signingKey;
process.env.FREYA_AUTH_ENABLED = 'true';
process.env.FREYA_LOG_FOLDER = path.join(folder, 'logs');

const users = {
    admin: { _id: 'admin', username: 'qa-admin', role: 'admin', active: true, tokenVersion: 0 },
    member: { _id: 'member', username: 'qa-member', role: 'user', active: true, tokenVersion: 0 },
};
const userModelPath = require.resolve('freya-ns-api/model/mongoDB/userModel');
require.cache[userModelPath] = {
    id: userModelPath,
    filename: userModelPath,
    loaded: true,
    exports: {
        findById: (id) => ({ select: () => ({ lean: async () => users[id] || null }) }),
    },
};

const quietLog = new Proxy({}, { get: () => () => {} });
const apiServicePath = require.resolve('../services/apiService/apiService');
require.cache[apiServicePath] = {
    id: apiServicePath,
    filename: apiServicePath,
    loaded: true,
    exports: { logService: quietLog },
};

const express = require('express');
const router = require('../services/apiService/serviceRoutes').createRouter();
const app = express();
app.use('/api/service', router);

let server;
let baseUrl;
let networkUnavailable = '';
const token = (id) => jwt.sign({ tv: 0 }, signingKey, { subject: id, expiresIn: '5m' });

before(async () => {
    server = http.createServer(app);
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
    } catch (error) {
        if (error.code !== 'EPERM') throw error;
        networkUnavailable = 'the sandbox does not permit loopback HTTP listeners';
        return;
    }
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(folder, { recursive: true, force: true });
});

async function patchConfig(authorization, changes = { acmeCloudflareTokenFile: '/tmp/should-not-be-saved' }) {
    const response = await fetch(`${baseUrl}/api/service/config`, {
        method: 'PATCH',
        headers: {
            'content-type': 'application/json',
            ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(changes),
    });
    return { status: response.status, body: await response.json() };
}

function httpTest(name, run) {
    test(name, async (context) => {
        if (networkUnavailable) return context.skip(networkUnavailable);
        await run();
    });
}

httpTest('unauthenticated callers cannot patch service configuration', async () => {
    const result = await patchConfig();
    assert.equal(result.status, 401);
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), originalSettings);
});

httpTest('authenticated non-admin callers cannot patch service configuration', async () => {
    const result = await patchConfig(`Bearer ${token('member')}`);
    assert.equal(result.status, 403);
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), originalSettings);
});

httpTest('an admin cannot set the environment-only token-file path through HTTP', async () => {
    const result = await patchConfig(`Bearer ${token('admin')}`);
    assert.equal(result.status, 400);
    assert.equal(result.body.error, 'Validation failed');
    assert.ok(result.body.details.acmeCloudflareTokenFile.includes('ODIN_ACME_CLOUDFLARE_TOKEN_FILE'));
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), originalSettings);
});

for (const [key, value, env] of [
    ['acmeRfc2136KeyFile', '/tmp/should-not-be-saved.key', 'ODIN_ACME_RFC2136_KEY_FILE'],
    ['acmeHook', '/tmp/should-not-be-run', 'ODIN_ACME_HOOK'],
]) {
    httpTest(`an admin cannot set ${key} through HTTP`, async () => {
        const result = await patchConfig(`Bearer ${token('admin')}`, { [key]: value });
        assert.equal(result.status, 400);
        assert.equal(result.body.error, 'Validation failed');
        assert.ok(result.body.details[key].includes(env));
        assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), originalSettings);
    });
}
