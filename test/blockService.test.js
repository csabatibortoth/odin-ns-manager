// The names of the block lists and the block rules are given as they are read
// from the database, and asked over a real DNS server on a local port; no
// database and no download is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Resolver } = require('node:dns').promises;
const { after, before, test } = require('node:test');

for (const name of Object.keys(process.env)) if (name.startsWith('ODIN_')) delete process.env[name];
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'odin-block-'));
process.env.ODIN_SETTINGS_FILE = path.join(folder, 'settings.json');

const named = require('njord-ns-server');
const blockService = require('../services/serverService/blockService');

const NAMES = ['ads.example.com', 'tracker.example.net', 'two.example.org', 'three.example.org', 'fine.telemetry.test'];
const RULES = [
    { domain: 'telemetry.test', action: 'block', includeSubdomains: true },
    { domain: 'fine.telemetry.test', action: 'allow', includeSubdomains: true },
    { domain: 'two.example.org', action: 'allow', includeSubdomains: false },
    { domain: 'exact.test', action: 'block', includeSubdomains: false },
];

const server = named.createServer();
const resolver = new Resolver({ tries: 1, timeout: 2000 });

before(async () => {
    blockService.replace({ settings: { enabled: true, mode: 'NULL_IP' }, names: NAMES, lists: 1, rules: RULES });
    server.on('query', (query) => {
        if (!blockService.resolve(query)) query.setError('erefuse'); // stands for the upstream lookup
        server.send(query);
    });
    await new Promise((resolve) => server.listen(53532, '127.0.0.1', resolve));
    resolver.setServers(['127.0.0.1:53532']);
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(folder, { recursive: true, force: true });
});

test('a blocked name is answered with the null address', async () => {
    assert.deepEqual(await resolver.resolve4('ads.example.com'), ['0.0.0.0']);
    assert.deepEqual(await resolver.resolve4('ADS.Example.Com'), ['0.0.0.0']);
    assert.deepEqual(await resolver.resolve6('ads.example.com'), ['::']);
    await assert.rejects(resolver.resolveMx('ads.example.com'), { code: 'ENODATA' });
    assert.equal(blockService.reason('ads.example.com'), 'list');
});

test('the other names are left for the upstream', async () => {
    await assert.rejects(resolver.resolve4('example.com'), { code: 'EREFUSED' });
    // A list is matched by the exact name: the names below are not blocked
    await assert.rejects(resolver.resolve4('www.ads.example.com'), { code: 'EREFUSED' });
    assert.equal(blockService.reason('example.com'), null);
});

test('a rule blocks a name, and the names below it when it says so', async () => {
    assert.deepEqual(await resolver.resolve4('telemetry.test'), ['0.0.0.0']);
    assert.deepEqual(await resolver.resolve4('a.b.telemetry.test'), ['0.0.0.0']);
    assert.equal(blockService.reason('a.b.telemetry.test'), 'rule');
    assert.deepEqual(await resolver.resolve4('exact.test'), ['0.0.0.0']);
    await assert.rejects(resolver.resolve4('www.exact.test'), { code: 'EREFUSED' });
});

test('a rule that allows wins over the lists, and the nearest rule over the ones above it', async () => {
    await assert.rejects(resolver.resolve4('two.example.org'), { code: 'EREFUSED' });
    await assert.rejects(resolver.resolve4('fine.telemetry.test'), { code: 'EREFUSED' });
    await assert.rejects(resolver.resolve4('www.fine.telemetry.test'), { code: 'EREFUSED' });
    assert.deepEqual(await resolver.resolve4('other.telemetry.test'), ['0.0.0.0']);
});

test('the answer and the blocking itself follow the settings of the blocking', async () => {
    blockService.replace({ settings: { enabled: true, mode: 'NXDOMAIN' } });
    await assert.rejects(resolver.resolve4('ads.example.com'), { code: 'ENOTFOUND' });
    assert.equal(blockService.state().mode, 'NXDOMAIN');

    blockService.replace({ settings: { enabled: false, mode: 'NXDOMAIN' } });
    await assert.rejects(resolver.resolve4('ads.example.com'), { code: 'EREFUSED' });
    await assert.rejects(resolver.resolve4('telemetry.test'), { code: 'EREFUSED' });
    assert.equal(blockService.isBlocked('ads.example.com'), false);

    blockService.replace({ settings: { enabled: true, mode: 'NULL_IP' } });
    assert.deepEqual(await resolver.resolve4('ads.example.com'), ['0.0.0.0']);
    assert.deepEqual(blockService.state(), { enabled: true, mode: 'NULL_IP', lists: 1, names: 5, rules: 4, watching: false, failing: false, loadedAt: null });
});
