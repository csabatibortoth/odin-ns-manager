// The zones are given as the documents of the database, and asked over a real
// DNS server on a local port; no database is needed.
const assert = require('node:assert/strict');
const { Resolver } = require('node:dns').promises;
const { after, before, test } = require('node:test');

const named = require('njord-ns-server');
const zoneService = require('../services/serverService/zoneService');

const soa = { host: 'ns1.example.com', admin: 'hostmaster.example.com', serial: 2026111200, refresh: 3600, retry: 600, expire: 604800, ttl: 3600 };
const record = (name, type, data, ttl = null) => ({ name, type, data, ttl });

const example = zoneService.buildZone({ name: 'example.com', ttl: 300, soa }, [
    record('example.com', 'A', { target: '192.0.2.1' }),
    record('example.com', 'NS', { target: 'ns1.example.com' }),
    record('example.com', 'MX', { exchange: 'mail.example.com', priority: 10 }),
    record('example.com', 'TXT', { target: 'v=spf1 -all' }),
    record('www.example.com', 'A', { target: '192.0.2.2' }, 60),
    record('www.example.com', 'A', { target: '192.0.2.3' }, 60),
    record('www.example.com', 'AAAA', { target: '2001:db8::2' }),
    record('alias.example.com', 'CNAME', { target: 'www.example.com' }),
    record('away.example.com', 'CNAME', { target: 'host.example.net' }),
    record('*.apps.example.com', 'A', { target: '192.0.2.9' }),
    record('fixed.apps.example.com', 'TXT', { target: 'fixed' }),
    record('_sip._tcp.example.com', 'SRV', { target: 'sip.example.com', port: 5060, priority: 1, weight: 5 }),
    record('broken.example.com', 'A', { target: 5 }),
    record('odd.example.com', 'LOC', { target: 'x' }),
]);
const sub = zoneService.buildZone({ name: 'sub.example.com', ttl: 300, soa: { ...soa, host: 'ns1.sub.example.com' } }, [
    record('www.sub.example.com', 'A', { target: '198.51.100.1' }),
]);

const server = named.createServer();
const resolver = new Resolver({ tries: 1, timeout: 2000 });

before(async () => {
    zoneService.replaceZones([example, sub]);
    server.on('query', async (query) => {
        if (!(await zoneService.resolve(query))) query.setError('erefuse'); // stands for the upstream lookup
        server.send(query);
    });
    await new Promise((resolve) => server.listen(53530, '127.0.0.1', resolve));
    resolver.setServers(['127.0.0.1:53530']);
});

after(() => new Promise((resolve) => server.close(resolve)));

test('records that can not be served are reported, not loaded', async () => {
    assert.equal(example.skipped.length, 2);
    assert.match(example.skipped[0], /^A broken\.example\.com/);
    assert.match(example.skipped[1], /^LOC odd\.example\.com/);
    await assert.rejects(resolver.resolve4('broken.example.com'), { code: 'ENOTFOUND' });
});

test('answers the records of a name, with their own TTL or the one of the zone', async () => {
    assert.deepEqual(await resolver.resolve4('www.example.com', { ttl: true }), [
        { address: '192.0.2.2', ttl: 60 },
        { address: '192.0.2.3', ttl: 60 },
    ]);
    assert.deepEqual(await resolver.resolve6('www.example.com', { ttl: true }), [{ address: '2001:db8::2', ttl: 300 }]);
});

test('answers every record type', async () => {
    assert.deepEqual(await resolver.resolveNs('example.com'), ['ns1.example.com']);
    const [mx] = await resolver.resolveMx('example.com');
    assert.deepEqual([mx.exchange, mx.priority], ['mail.example.com', 10]);
    assert.deepEqual(await resolver.resolveTxt('example.com'), [['v=spf1 -all']]);
    const [srv] = await resolver.resolveSrv('_sip._tcp.example.com');
    assert.deepEqual([srv.name, srv.port, srv.priority, srv.weight], ['sip.example.com', 5060, 1, 5]);
});

test('answers the SOA record of the zone', async () => {
    const answer = await resolver.resolveSoa('example.com');
    assert.equal(answer.nsname, 'ns1.example.com');
    assert.equal(answer.hostmaster, 'hostmaster.example.com');
    assert.equal(answer.serial, 2026111200);
});

test('the name is not case sensitive', async () => {
    assert.deepEqual(await resolver.resolve4('WWW.Example.COM'), ['192.0.2.2', '192.0.2.3']);
});

test('follows an alias inside the zones', async () => {
    assert.deepEqual(await resolver.resolveCname('alias.example.com'), ['www.example.com']);
    assert.deepEqual(await resolver.resolve4('alias.example.com'), ['192.0.2.2', '192.0.2.3']);
});

test('a wildcard stands for the names that do not exist', async () => {
    assert.deepEqual(await resolver.resolve4('anything.apps.example.com'), ['192.0.2.9']);
    assert.deepEqual(await resolver.resolve4('a.b.apps.example.com'), ['192.0.2.9']);
    // fixed.apps exists, so the wildcard is not for it
    await assert.rejects(resolver.resolve4('fixed.apps.example.com'), { code: 'ENODATA' });
    await assert.rejects(resolver.resolve4('below.fixed.apps.example.com'), { code: 'ENOTFOUND' });
});

test('a name that exists without the asked type has no data; an unknown name is not found', async () => {
    await assert.rejects(resolver.resolveMx('www.example.com'), { code: 'ENODATA' });
    await assert.rejects(resolver.resolve4('apps.example.com'), { code: 'ENODATA' });
    await assert.rejects(resolver.resolve4('nothing.example.com'), { code: 'ENOTFOUND' });
});

test('the longest matching zone answers', async () => {
    assert.deepEqual(await resolver.resolve4('www.sub.example.com'), ['198.51.100.1']);
    await assert.rejects(resolver.resolve4('alias.sub.example.com'), { code: 'ENOTFOUND' });
});

test('names outside of the zones are left for the upstream', async () => {
    await assert.rejects(resolver.resolve4('www.example.org'), { code: 'EREFUSED' });
    await assert.rejects(resolver.resolve4('notexample.com'), { code: 'EREFUSED' });
});

test('a zone that is taken away is not answered any more', async () => {
    zoneService.replaceZones([example]);
    await assert.rejects(resolver.resolve4('www.sub.example.com'), { code: 'ENOTFOUND' });
    zoneService.replaceZones([example, sub]);
});
