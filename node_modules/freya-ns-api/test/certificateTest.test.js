// The test of the certificate setup: a whole order against the STAGING authority that installs nothing.
// Fake ACME client (no network), the provider "zones" on a real MongoDB in a database of its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');

const URI = process.env.FREYA_TEST_MONGO || 'mongodb://127.0.0.1:27017';
const DB = `freya_test_certtest_${process.pid}`;
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'freya-acme-test-'));
const soa = { host: 'ns1.example.com', admin: 'hostmaster.example.com', serial: 1, refresh: 3600, retry: 600, expire: 604800, ttl: 3600 };
const VALUE = (c) => c.repeat(43);

Object.assign(process.env, {
    FREYA_HTTPS_ENABLED: 'true',
    FREYA_HTTPS_CERT_SOURCE: 'letsencrypt',
    FREYA_HTTPS_DOMAINS: 'example.com,*.example.com',
    FREYA_ACME_DIRECTORY: 'production', // the real certificate comes from production; the test must not
    FREYA_ACME_CHALLENGE: 'dns-01',
    FREYA_ACME_DNS_PROVIDER: 'zones',
    FREYA_ACME_DNS_WAIT: '5',
    FREYA_ACME_FOLDER: folder,
    FREYA_ACME_HTTP_PORT: '1', // never opened with dns-01
    FREYA_LOGGING_ENABLED: 'false',
});

let hasOpenssl = true;
try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
    hasOpenssl = false;
}

let up = false;
let Zone, Record, service, acme;
const orders = []; // what the fake authority was asked: { directoryUrl, accountKey }
let mode = 'ok';
let gate = null; // a promise the fake waits for: to hold an order open

function sign(csr) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freya-ca-'));
    const run = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
    run('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/CN=test', '-days', '2');
    fs.writeFileSync(path.join(dir, 'x.csr'), csr);
    fs.writeFileSync(path.join(dir, 'ext'), 'subjectAltName=DNS:example.com,DNS:*.example.com\n');
    run('x509', '-req', '-in', 'x.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'x.crt', '-days', '2', '-extfile', 'ext');
    return fs.readFileSync(path.join(dir, 'x.crt'), 'utf8');
}

test.before(async () => {
    try {
        await mongoose.connect(`${URI}/${DB}`, { serverSelectionTimeoutMS: 1500 });
        up = true;
    } catch {
        return;
    }
    ({ Zone, Record } = require('../model/mongoDB/manager'));
    await Record.init();
    await Zone.create({ name: 'example.com', soa });

    acme = require('acme-client');
    acme.Client = class {
        constructor(options) {
            this.options = options;
        }
        async auto(options) {
            orders.push({ directoryUrl: this.options.directoryUrl, accountKey: String(this.options.accountKey) });
            const values = [VALUE('a'), VALUE('b')];
            const authz = { identifier: { type: 'dns', value: 'example.com' } };
            const challenges = values.map((value) => [{ type: 'dns-01' }, value]);
            try {
                for (const [challenge, value] of challenges) await options.challengeCreateFn(authz, challenge, value);
                if (gate) await gate;
                if (mode === 'fail') throw new Error('the authority said invalid');
            } catch (err) {
                for (const [challenge, value] of challenges) await options.challengeRemoveFn(authz, challenge, value).catch(() => {});
                throw err;
            }
            for (const [challenge, value] of challenges) await options.challengeRemoveFn(authz, challenge, value);
            return sign(options.csr);
        }
    };
    service = require('../services/certificateService/certificateService');
});

test.after(async () => {
    if (up) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    fs.rmSync(folder, { recursive: true, force: true });
});

const withDb = (name, fn) =>
    test(name, async (ctx) => {
        if (!up) return ctx.skip('no MongoDB');
        if (!hasOpenssl) return ctx.skip('no openssl');
        await fn();
    });

// Everything below the folder of the real certificate, with the content: to see that the test changed nothing there
function snapshot() {
    const out = {};
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'test') walk(full);
            } else out[path.relative(folder, full)] = fs.readFileSync(full, 'utf8');
        }
    };
    walk(folder);
    return out;
}

withDb('a test needs a certificate to be served first (HTTPS on)', async () => {
    await assert.rejects(Promise.resolve().then(() => service.test({ username: 'a' })), /HTTPS is not enabled/);
});

withDb('a passing test: the steps, the staging authority, nothing installed, nothing left behind', async () => {
    mode = 'ok';
    await service.renew(); // the real certificate, from "production"
    const before = snapshot();
    const fingerprint = service.status().certificate.fingerprint256;
    const realOrder = orders.at(-1);
    assert.equal(realOrder.directoryUrl, acme.directory.letsencrypt.production);

    const result = await service.test({ username: 'admin' });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.directory, acme.directory.letsencrypt.staging);
    assert.deepEqual(result.challenge, { type: 'dns-01', provider: 'zones' });
    assert.deepEqual(
        result.steps.map((s) => s.step),
        ['test started', 'order placed', 'record written', 'record visible', 'record written', 'record visible', 'record removed', 'record removed',
            'challenge records cleaned up', 'authority validated the names', 'certificate issued by the test authority']
    );
    assert.ok(result.steps.every((s) => s.ok) && result.steps.every((s, i, all) => i === 0 || s.ms >= all[i - 1].ms));

    // the test asked the staging authority, with an account of its own
    const testOrder = orders.at(-1);
    assert.equal(testOrder.directoryUrl, acme.directory.letsencrypt.staging);
    assert.notEqual(testOrder.accountKey, realOrder.accountKey);
    // nothing of the real certificate changed: same files, same certificate served, no record left
    assert.deepEqual(snapshot(), before);
    assert.equal(service.status().certificate.fingerprint256, fingerprint);
    assert.equal(await Record.countDocuments({ transient: true }), 0);
    // what the status remembers
    assert.equal(service.status().lastTest.ok, true);
    assert.equal(service.status().lastError, null);
});

withDb('a failing test: the reason ends the steps, no record is left, the real certificate state is not touched', async () => {
    mode = 'fail';
    const before = snapshot();
    const result = await service.test({ username: 'admin' });
    assert.equal(result.ok, false);
    assert.match(result.error, /the authority said invalid/);
    const last = result.steps.at(-1);
    assert.deepEqual([last.step, last.ok, last.detail], ['failed', false, 'the authority said invalid']);
    assert.ok(result.steps.some((s) => s.step === 'record written'));
    assert.ok(result.steps.some((s) => s.step === 'challenge records cleaned up'));
    assert.equal(result.steps.some((s) => s.step === 'authority validated the names'), false);
    assert.equal(await Record.countDocuments({ transient: true }), 0);
    assert.deepEqual(snapshot(), before);
    // a failed test is not a failed renewal
    assert.equal(service.status().lastError, null);
    assert.equal(service.status().lastTest.ok, false);
});

withDb('two tests at once share one order', async () => {
    mode = 'ok';
    let release;
    gate = new Promise((resolve) => (release = resolve));
    const before = orders.length;
    const first = service.test({ username: 'a' });
    const second = service.test({ username: 'b' });
    assert.equal(first, second);
    release();
    gate = null;
    assert.equal((await first).ok, true);
    assert.equal(orders.length, before + 1);
    // and afterwards a new one can run
    assert.equal((await service.test({ username: 'a' })).ok, true);
});
