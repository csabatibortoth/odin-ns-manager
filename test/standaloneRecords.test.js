// The standalone records are given as the documents of the database, and asked
// over a real DNS server on a local port; no database is needed.
const assert = require('node:assert/strict');
const { Resolver } = require('node:dns').promises;
const { after, before, test } = require('node:test');

const named = require('njord-ns-server');
const zoneService = require('../services/serverService/zoneService');

const soa = { host: 'ns1.example.com', admin: 'hostmaster.example.com', serial: 2026111200, refresh: 3600, retry: 600, expire: 604800, ttl: 3600 };
const record = (name, type, data, ttl = 3600) => ({ name, type, data, ttl });

const zone = zoneService.buildZone({ name: 'example.com', ttl: 300, soa }, [record('www.example.com', 'A', { target: '192.0.2.2' })]);
const standalone = zoneService.buildStandalone([
    record('nas.home.test', 'A', { target: '10.0.0.5' }, 120),
    record('nas.home.test', 'A', { target: '10.0.0.6' }, 120),
    record('alias.home.test', 'CNAME', { target: 'nas.home.test' }),
    record('to-zone.home.test', 'CNAME', { target: 'www.example.com' }),
    record('*.dev.test', 'A', { target: '10.0.0.9' }),
    record('fixed.dev.test', 'TXT', { target: 'fixed' }),
    record('printer', 'A', { target: '10.0.0.7' }),
    record('shadow.example.com', 'A', { target: '10.0.0.8' }),
    record('broken.home.test', 'A', { target: 5 }),
]);

const server = named.createServer();
const resolver = new Resolver({ tries: 1, timeout: 2000 });
const sources = [];

before(async () => {
    zoneService.replaceZones([zone]);
    zoneService.replaceStandalone(standalone);
    server.on('query', async (query) => {
        const source = await zoneService.resolve(query);
        sources.push(source);
        if (!source) query.setError('erefuse'); // stands for the upstream lookup
        server.send(query);
    });
    await new Promise((resolve) => server.listen(53531, '127.0.0.1', resolve));
    resolver.setServers(['127.0.0.1:53531']);
});

after(() => new Promise((resolve) => server.close(resolve)));

test('records that can not be served are reported, not loaded', () => {
    assert.equal(standalone.records, 8);
    assert.equal(standalone.skipped.length, 1);
    assert.match(standalone.skipped[0], /^A broken\.home\.test/);
});

test('answers the records of a name outside of the zones, with their TTL', async () => {
    assert.deepEqual(await resolver.resolve4('nas.home.test', { ttl: true }), [
        { address: '10.0.0.5', ttl: 120 },
        { address: '10.0.0.6', ttl: 120 },
    ]);
    assert.deepEqual(await resolver.resolve4('NAS.Home.Test'), ['10.0.0.5', '10.0.0.6']);
    assert.deepEqual(await resolver.resolve4('printer'), ['10.0.0.7']);
    assert.equal(sources.at(-1), 'records');
});

test('the other types of such a name are not forwarded', async () => {
    await assert.rejects(resolver.resolve6('nas.home.test'), { code: 'ENODATA' });
});

test('the names around it are left for the upstream', async () => {
    await assert.rejects(resolver.resolve4('other.home.test'), { code: 'EREFUSED' });
    await assert.rejects(resolver.resolve4('home.test'), { code: 'EREFUSED' });
    await assert.rejects(resolver.resolve4('below.nas.home.test'), { code: 'EREFUSED' });
    assert.equal(sources.at(-1), false);
});

test('follows an alias, to a standalone record and into a zone', async () => {
    assert.deepEqual(await resolver.resolve4('alias.home.test'), ['10.0.0.5', '10.0.0.6']);
    assert.deepEqual(await resolver.resolve4('to-zone.home.test'), ['192.0.2.2']);
});

test('a wildcard stands for the names below it that have no records of their own', async () => {
    assert.deepEqual(await resolver.resolve4('app.dev.test'), ['10.0.0.9']);
    assert.deepEqual(await resolver.resolve4('a.b.dev.test'), ['10.0.0.9']);
    await assert.rejects(resolver.resolve4('fixed.dev.test'), { code: 'ENODATA' });
    await assert.rejects(resolver.resolve4('dev.test'), { code: 'EREFUSED' });
});

test('a zone comes before the standalone records', async () => {
    await assert.rejects(resolver.resolve4('shadow.example.com'), { code: 'ENOTFOUND' });
    assert.equal(sources.at(-1), 'zones');
    assert.equal(zoneService.isStandalone('shadow.example.com'), false);
    assert.equal(zoneService.isStandalone('nas.home.test'), true);
});
