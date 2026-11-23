// The whole path of a DNS-01 order through certificateService, with a fake ACME client (no network) and the
// provider "zones" on a real MongoDB in a database of its own. The fake calls the two functions exactly as
// acme-client's auto mode does: create, (the authority checks), remove; and remove also when the order fails.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');

const URI = process.env.FREYA_TEST_MONGO || 'mongodb://127.0.0.1:27017';
const DB = `freya_test_cert_${process.pid}`;
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'freya-acme-'));
const soa = { host: 'ns1.example.com', admin: 'hostmaster.example.com', serial: 1, refresh: 3600, retry: 600, expire: 604800, ttl: 3600 };
const VALUE = (c) => c.repeat(43);

// What the settings of the server are, set before the service is loaded.
Object.assign(process.env, {
    FREYA_HTTPS_ENABLED: 'true',
    FREYA_HTTPS_CERT_SOURCE: 'letsencrypt',
    FREYA_HTTPS_DOMAINS: 'example.com,*.example.com',
    FREYA_ACME_CHALLENGE: 'dns-01',
    FREYA_ACME_DNS_PROVIDER: 'zones',
    FREYA_ACME_DNS_WAIT: '5',
    FREYA_ACME_FOLDER: folder,
    FREYA_ACME_HTTP_PORT: '1', // must never be opened with dns-01
    FREYA_LOGGING_ENABLED: 'false',
});

let hasOpenssl = true;
try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
    hasOpenssl = false;
}

let up = false;
let Zone, Record, service;
// What the fake authority did: the TXT values it saw at the moment it checked.
const seen = [];
let mode = 'ok';

// A certificate for the request, signed by a throw-away authority: what readPair accepts.
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

    // acme-client with a fake Client; its crypto helpers stay real.
    const acme = require('acme-client');
    acme.Client = class {
        async auto(options) {
            // the order of example.com and of *.example.com: two authorizations that share one record name
            const values = [VALUE('a'), VALUE('b')];
            const authz = { identifier: { type: 'dns', value: 'example.com' } };
            const challenges = values.map((value) => [{ type: 'dns-01' }, value]);
            try {
                for (const [challenge, value] of challenges) await options.challengeCreateFn(authz, challenge, value);
                seen.push((await Record.find({ transient: true }).lean()).map((r) => r.data.target).sort());
                if (mode === 'fail') throw new Error('the authority said invalid');
            } catch (err) {
                // auto mode removes what it created, also after a failure, and does not let an error of it stop the rest
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

withDb('an order for a wildcard and its base name writes two TXT values, then removes both; no port 80', async () => {
    mode = 'ok';
    await service.renew();
    assert.deepEqual(seen.at(-1), [VALUE('a'), VALUE('b')]);
    assert.equal(await Record.countDocuments({ transient: true }), 0);
    const status = service.status();
    assert.equal(status.lastError, null);
    assert.deepEqual(status.certificate.altNames.sort(), ['*.example.com', 'example.com']);
});

withDb('a failed order leaves no record behind and reports the failure', async () => {
    mode = 'fail';
    await assert.rejects(service.renew(), /the authority said invalid/);
    assert.equal(await Record.countDocuments({ transient: true }), 0);
    assert.match(service.status().lastError, /invalid/);
});

withDb('an unknown provider fails before anything is requested', async () => {
    // not through the environment (read once): the registry is what obtain() asks
    const providers = require('../services/certificateService/dnsProviders');
    assert.throws(() => providers.get('route53'), /not known.*zones/);
});
