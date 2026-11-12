// The blocklists are given as lists of names, and asked over a real DNS server
// on a local port; no database and no download is needed.
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
const config = require('../config/config');
const blockService = require('../services/serverService/blockService');

const HOSTS = `# Title: a hosts file
127.0.0.1 localhost
127.0.0.1 localhost.localdomain
255.255.255.255 broadcasthost
::1 localhost
0.0.0.0 0.0.0.0

# Start of the list
0.0.0.0 Ads.Example.com
0.0.0.0 tracker.example.net # a comment
0.0.0.0 ads.example.com
127.0.0.1 two.example.org three.example.org
0.0.0.0 not_a_name!
`;

const server = named.createServer();
const resolver = new Resolver({ tries: 1, timeout: 2000 });

before(async () => {
    blockService.replace(
        [{ names: blockService.parseList(HOSTS), subdomains: false }, { names: ['telemetry.test'], subdomains: true }],
        ['fine.telemetry.test', 'two.example.org']
    );
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

test('reads the names of a hosts file, without the ones of the machine itself', () => {
    assert.deepEqual(blockService.parseList(HOSTS), ['ads.example.com', 'tracker.example.net', 'two.example.org', 'three.example.org']);
});

test('reads plain names and the lines of filter lists', () => {
    const text = '! Title: filters\n[Adblock Plus 2.0]\nplain.example.com\n||filter.example.com^\nplain.example.com.\n\nsome words that are not names\n';
    assert.deepEqual(blockService.parseList(text), ['plain.example.com', 'filter.example.com']);
});

test('a blocked name is answered with the null address', async () => {
    assert.deepEqual(await resolver.resolve4('ads.example.com'), ['0.0.0.0']);
    assert.deepEqual(await resolver.resolve4('ADS.Example.Com'), ['0.0.0.0']);
    assert.deepEqual(await resolver.resolve6('ads.example.com'), ['::']);
    await assert.rejects(resolver.resolveMx('ads.example.com'), { code: 'ENODATA' });
});

test('the other names are left for the upstream', async () => {
    await assert.rejects(resolver.resolve4('example.com'), { code: 'EREFUSED' });
    // A hosts file names every name itself: the names below are not blocked
    await assert.rejects(resolver.resolve4('www.ads.example.com'), { code: 'EREFUSED' });
});

test('a list can block the names below its names as well', async () => {
    assert.deepEqual(await resolver.resolve4('telemetry.test'), ['0.0.0.0']);
    assert.deepEqual(await resolver.resolve4('a.b.telemetry.test'), ['0.0.0.0']);
});

test('an allowed name, and the names below it, are not blocked', async () => {
    await assert.rejects(resolver.resolve4('two.example.org'), { code: 'EREFUSED' });
    await assert.rejects(resolver.resolve4('fine.telemetry.test'), { code: 'EREFUSED' });
    await assert.rejects(resolver.resolve4('www.fine.telemetry.test'), { code: 'EREFUSED' });
    assert.deepEqual(await resolver.resolve4('other.telemetry.test'), ['0.0.0.0']);
});

test('the answer and the blocking itself follow the settings', async () => {
    config.update({ nsBlockMode: 'nxdomain' });
    await assert.rejects(resolver.resolve4('ads.example.com'), { code: 'ENOTFOUND' });

    config.update({ nsBlockingEnabled: false });
    await assert.rejects(resolver.resolve4('ads.example.com'), { code: 'EREFUSED' });
    assert.equal(blockService.isBlocked('ads.example.com'), false);

    config.update({ nsBlockingEnabled: true, nsBlockMode: 'null' });
    assert.deepEqual(await resolver.resolve4('ads.example.com'), ['0.0.0.0']);
    assert.throws(() => config.update({ nsBlockMode: 'zero' }), (err) => Boolean(err.details.nsBlockMode));
});
