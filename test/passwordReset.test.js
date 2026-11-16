// The lost password links: mailed once, valid for one use, and nothing tells whether an address exists.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

for (const name of Object.keys(process.env)) if (name.startsWith('ODIN_')) delete process.env[name];
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'odin-reset-'));
process.env.ODIN_SETTINGS_FILE = path.join(folder, 'settings.json');

const stub = (request, exports) => {
    const file = require.resolve(request);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
const logger = new Proxy({}, { get: () => () => {} });
stub('../services/apiService/apiService', { logService: logger });

const users = [{ _id: 'u1', username: 'ada', email: 'ada@example.com', displayName: 'Ada', active: true, passwordHash: 'old', tokenVersion: 0, save: async function () { this.saved = true; } }];
stub('freya-ns-api/model/mongoDB/userModel', {
    findOne: (filter) => {
        const found = users.find((user) => (filter.email ? user.email === filter.email : user._id === filter._id) && user.active === filter.active);
        return Object.assign(Promise.resolve(found || null), { select: () => Promise.resolve(found || null) });
    },
});
stub('freya-ns-api/services/authService/authService', { hashPassword: async (password) => `hash:${password}` });

const config = require('../config/config');
const mailService = require('../services/serverService/mailService');
const resetService = require('../services/serverService/passwordResetService');

const sent = [];
mailService.send = async (mail) => sent.push(mail);
Object.assign(config, { mailEnabled: true, mailHost: 'smtp.test', mailFrom: 'odin@example.com', publicUrl: 'https://dns.example.com:45452' });

const tokenOf = (mail) => mail.text.match(/#\/reset\/(\S+)/)[1];

test('only an account with that address gets a link, and the answer is the same', async () => {
    await resetService.request('nobody@example.com');
    assert.equal(sent.length, 0);
    await resetService.request('ADA@example.com');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'ada@example.com');
    assert.match(sent[0].text, /^.*https:\/\/dns\.example\.com:45452\/#\/reset\//ms);
});

test('a second request within a minute sends nothing more', async () => {
    await resetService.request('ada@example.com');
    assert.equal(sent.length, 1);
});

test('the link changes the password once, and signs the user out everywhere', async () => {
    const token = tokenOf(sent[0]);
    assert.equal(resetService.check(token), true);
    await assert.rejects(resetService.reset(token, 'short'), /Validation failed/);
    await resetService.reset(token, 'a-new-password');
    assert.equal(users[0].passwordHash, 'hash:a-new-password');
    assert.equal(users[0].tokenVersion, 1);
    assert.equal(resetService.check(token), false);
    await assert.rejects(resetService.reset(token, 'another-password'), /not valid any more/);
});

test('without mail or an address of the interface the lost password is not offered', async () => {
    config.publicUrl = '';
    assert.equal(resetService.isAvailable(), false);
    await assert.rejects(resetService.request('ada@example.com'), /not set up/);
    fs.rmSync(folder, { recursive: true, force: true });
});
