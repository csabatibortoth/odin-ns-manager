// The provider "cloudflare" against a fake of the API of Cloudflare on a local port: no network, no account.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProvider, API } = require('../services/certificateService/cloudflareProvider');

const TOKEN = 'cf-token-SECRET-1234567890';
const V1 = 'a'.repeat(43);
const V2 = 'b'.repeat(43);
const NAME = '_acme-challenge.example.com';

// A zone "example.com" (id Z1) and its TXT records; counters and switches for the failures.
function fakeCloudflare() {
    const state = { records: [], next: 1, calls: [], fail: 0, failStatus: 500, tokenOk: true, zones: { 'example.com': 'Z1' } };
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://x');
        const body = await new Promise((resolve) => {
            let data = '';
            req.on('data', (chunk) => (data += chunk));
            req.on('end', () => resolve(data ? JSON.parse(data) : null));
        });
        state.calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization, body });
        const send = (status, payload, headers = {}) => res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(payload));
        const ok = (result) => send(200, { success: true, errors: [], result });

        if (req.headers.authorization !== `Bearer ${TOKEN}` || !state.tokenOk) {
            return send(403, { success: false, errors: [{ code: 9109, message: 'Invalid access token' }], result: null });
        }
        if (state.fail > 0) {
            state.fail--;
            return send(state.failStatus, { success: false, errors: [{ code: 1, message: 'try later' }] }, { 'Retry-After': '0' });
        }
        if (req.method === 'GET' && url.pathname === '/zones') {
            const id = state.zones[url.searchParams.get('name')];
            return ok(id ? [{ id, name: url.searchParams.get('name') }] : []);
        }
        const records = url.pathname.match(/^\/zones\/([^/]+)\/dns_records(?:\/(.+))?$/);
        if (!records || records[1] !== 'Z1') return send(404, { success: false, errors: [{ code: 7003, message: 'not found' }] });
        if (req.method === 'GET') {
            return ok(state.records.filter((r) => r.type === url.searchParams.get('type') && r.name === url.searchParams.get('name')));
        }
        if (req.method === 'POST') {
            // Cloudflare returns the content of a TXT record in quotes
            const record = { id: `R${state.next++}`, type: body.type, name: body.name, content: `"${body.content}"`, ttl: body.ttl };
            state.records.push(record);
            return ok(record);
        }
        if (req.method === 'DELETE') {
            const at = state.records.findIndex((r) => r.id === records[2]);
            if (at < 0) return send(404, { success: false, errors: [{ code: 81044, message: 'Record does not exist' }] });
            return ok({ id: state.records.splice(at, 1)[0].id });
        }
        return send(405, {});
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` })));
}

let fake;
test.before(async () => (fake = await fakeCloudflare()));
test.after(() => fake.server.close());
test.beforeEach(() => Object.assign(fake.state, { records: [], calls: [], fail: 0, failStatus: 500, tokenOk: true }));

const provider = (extra = {}) => createProvider({ token: TOKEN, baseUrl: fake.url, sleep: async () => {}, ...extra });

test('finds the zone by name, writes a TXT record with a short TTL and sends the token as a bearer token', async () => {
    await provider().create(NAME, V1);
    assert.deepEqual(fake.state.calls.find((c) => c.path === '/zones').query, { name: 'example.com', status: 'active' });
    const post = fake.state.calls.find((c) => c.method === 'POST');
    assert.deepEqual(post.body, { type: 'TXT', name: NAME, content: V1, ttl: 60 });
    assert.equal(post.auth, `Bearer ${TOKEN}`);
});

test('a name in a sub-zone: the longest suffix that is a zone wins', async () => {
    fake.state.zones['sub.example.com'] = 'Z1';
    await provider().create('_acme-challenge.host.sub.example.com', V1);
    assert.deepEqual(fake.state.calls.filter((c) => c.path === '/zones').map((c) => c.query.name), ['host.sub.example.com', 'sub.example.com']);
});

test('with a zone id nothing is looked up', async () => {
    await provider({ zoneId: 'Z1' }).create(NAME, V1);
    assert.equal(fake.state.calls.some((c) => c.path === '/zones'), false);
    assert.equal(fake.state.records.length, 1);
});

test('two values at one name; remove takes only its own value, also when the content comes back quoted', async () => {
    const p = provider();
    await p.create(NAME, V1);
    await p.create(NAME, V2);
    assert.equal(fake.state.records.length, 2);
    await p.remove(NAME, V1);
    assert.deepEqual(fake.state.records.map((r) => r.content), [`"${V2}"`]);
});

test('a retry does not write the record twice', async () => {
    const p = provider();
    await p.create(NAME, V1);
    await p.create(NAME, V1);
    assert.equal(fake.state.records.length, 1);
});

test('remove also takes a record that an earlier run left, and a record that is already gone is not an error', async () => {
    fake.state.records.push({ id: 'OLD', type: 'TXT', name: NAME, content: `"${V1}"` });
    const p = provider();
    await p.remove(NAME, V1);
    assert.equal(fake.state.records.length, 0);
    await p.remove(NAME, V1);
});

test('never removes a record of another kind or another value', async () => {
    fake.state.records.push({ id: 'KEEP1', type: 'TXT', name: NAME, content: '"v=spf1 -all"' });
    fake.state.records.push({ id: 'KEEP2', type: 'TXT', name: NAME, content: `"${V2}"` });
    await provider().remove(NAME, V1);
    assert.deepEqual(fake.state.records.map((r) => r.id), ['KEEP1', 'KEEP2']);
});

test('refuses names that are not a challenge and values of the wrong form', async () => {
    const p = provider();
    await assert.rejects(p.create('www.example.com', V1), /_acme-challenge/);
    await assert.rejects(p.create(NAME, 'x'), /wrong form/);
    await assert.rejects(p.remove('example.com', V1), /_acme-challenge/);
    assert.equal(fake.state.calls.length, 0);
});

test('a name outside every zone of the account is said so', async () => {
    await assert.rejects(provider().create('_acme-challenge.other.net', V1), /does not belong to a zone of this Cloudflare account/);
});

test('a rejected token: a clear message, and the token is nowhere in it', async () => {
    fake.state.tokenOk = false;
    const err = await provider().create(NAME, V1).catch((e) => e);
    assert.match(err.message, /403.*Invalid access token.*DNS: Edit/);
    assert.equal(err.message.includes(TOKEN), false);
    assert.equal(String(err.stack).includes(TOKEN), false);
});

test('a busy API (429, 500) is tried again, then it works', async () => {
    fake.state.fail = 2;
    fake.state.failStatus = 429;
    await provider().create(NAME, V1);
    assert.equal(fake.state.records.length, 1);
});

test('an API that keeps failing gives up with the answer', async () => {
    fake.state.fail = 99;
    await assert.rejects(provider().create(NAME, V1), /Cloudflare answered 500: try later/);
});

test('an API that cannot be reached: no address, no token in the message', async () => {
    // a port that was free a moment ago: nothing listens there
    const port = await new Promise((resolve) => {
        const probe = http.createServer();
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
    const err = await createProvider({ token: TOKEN, baseUrl: `http://127.0.0.1:${port}`, sleep: async () => {} }).create(NAME, V1).catch((e) => e);
    assert.match(err.message, /Cloudflare could not be reached \(ECONNREFUSED\)/);
    assert.equal(err.message.includes(TOKEN), false);
});

test('the token comes from the file, first line only; without one the provider cannot be built', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cf-')), 'token');
    fs.writeFileSync(file, `${TOKEN}\nsecond line\n`);
    assert.doesNotThrow(() => createProvider({ tokenFile: file }));
    assert.throws(() => createProvider({}), /needs an API token/);
    assert.throws(() => createProvider({ token: '   ' }), /needs an API token/);
});

test('the real address is the one of Cloudflare, over HTTPS', () => {
    assert.equal(API, 'https://api.cloudflare.com/client/v4');
});

test('the registry builds it from the settings, and says what is missing', () => {
    const providers = require('../services/certificateService/dnsProviders');
    assert.ok(providers.names().includes('cloudflare'));
    assert.throws(() => providers.get('cloudflare'), /needs an API token/);
});
