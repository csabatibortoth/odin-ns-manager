const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { createProvider, recordToAdd, targetOf } = require('../services/certificateService/delegationProvider');
const { createHandlers } = require('../services/certificateService/dnsChallenge');

const V1 = 'a'.repeat(43);
const V2 = 'b'.repeat(43);
const NAME = '_acme-challenge.example.com';
const TARGET = '_acme-challenge.example.com.acme.example.net';

const recorder = () => {
    const calls = [];
    return { calls, create: async (n, v) => void calls.push(['create', n, v]), remove: async (n, v) => void calls.push(['remove', n, v]) };
};

test('writes at the name in the zone of the delegation, not at the name of the domain', async () => {
    const inner = recorder();
    const p = createProvider({ zone: 'ACME.example.net.', inner });
    await p.create(NAME, V1);
    await p.remove(NAME, V1);
    assert.deepEqual(inner.calls, [['create', TARGET, V1], ['remove', TARGET, V1]]);
});

test('needs a zone, and a name that is one', () => {
    assert.throws(() => createProvider({ inner: recorder() }), /needs FREYA_ACME_DELEGATION_ZONE/);
    assert.throws(() => createProvider({ zone: 'not a name', inner: recorder() }), /not a host name/);
    assert.throws(() => createProvider({ zone: 'x', inner: recorder() }), /not a host name/);
});

test('only challenge names can be delegated', async () => {
    assert.throws(() => targetOf('www.example.com', 'acme.example.net'), /_acme-challenge/);
    await assert.rejects(createProvider({ zone: 'acme.example.net', inner: recorder() }).create('example.com', V1), /_acme-challenge/);
});

test('the record to add: a wildcard counts as its base name', () => {
    assert.deepEqual(recordToAdd('*.Example.com', 'acme.example.net'), { type: 'CNAME', name: NAME, target: TARGET });
    assert.deepEqual(recordToAdd('example.com', 'acme.example.net'), { type: 'CNAME', name: NAME, target: TARGET });
});

test('diagnose says which record is missing, wrong, or right', async () => {
    const make = (found) => createProvider({ zone: 'acme.example.net', inner: recorder(), cname: async () => found });
    assert.match(await make([]).diagnose(NAME), new RegExp(`No CNAME was found at ${NAME}.*${NAME} CNAME ${TARGET}`));
    assert.match(await make(['other.example.org']).diagnose(NAME), /to other\.example\.org, but it has to be _acme-challenge\.example\.com\.acme\.example\.net/);
    assert.match(await make([TARGET]).diagnose(NAME), /CNAME .* is right, but the TXT record .* is not answered.*reachable from the internet/);
});

test('the wait error carries the diagnosis', async () => {
    let t = 0;
    const provider = { ...createProvider({ zone: 'acme.example.net', inner: recorder(), cname: async () => [] }), visible: async () => false };
    const handlers = createHandlers(provider, { waitSeconds: 3, now: () => t, sleep: async (ms) => void (t += ms) });
    await assert.rejects(
        handlers.create({ identifier: { value: 'example.com' } }, { type: 'dns-01' }, V1),
        /could not be seen within 3 seconds.*No CNAME was found at _acme-challenge\.example\.com/
    );
});

// ---- with the provider "zones" on a real MongoDB --------------------------------------------------------------------
const URI = process.env.FREYA_TEST_MONGO || 'mongodb://127.0.0.1:27017';
const DB = `freya_test_deleg_${process.pid}`;
const soa = { host: 'ns1.example.net', admin: 'hostmaster.example.net', serial: 1, refresh: 3600, retry: 600, expire: 604800, ttl: 3600 };
let up = false;
let Zone, Record, zones;

test.before(async () => {
    try {
        await mongoose.connect(`${URI}/${DB}`, { serverSelectionTimeoutMS: 1500 });
        up = true;
    } catch {
        return;
    }
    ({ Zone, Record } = require('../model/mongoDB/manager'));
    await Record.init();
    zones = require('../services/certificateService/zonesProvider');
    await Zone.create({ name: 'acme.example.net', soa });
});
test.after(async () => {
    if (up) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
});
const withDb = (name, fn) =>
    test(name, async (ctx) => {
        if (!up) return ctx.skip('no MongoDB');
        await fn();
    });

withDb('a wildcard and its base name: two TXT values in the delegation zone, removed one by one', async () => {
    const p = createProvider({ zone: 'acme.example.net', inner: zones.provider() });
    await p.create(NAME, V1);
    await p.create(NAME, V2);
    const stored = await Record.find({ transient: true }).lean();
    assert.deepEqual(stored.map((r) => r.name), [TARGET, TARGET]);
    await p.remove(NAME, V1);
    assert.deepEqual((await Record.find({ transient: true }).lean()).map((r) => r.data.target), [V2]);
    await p.remove(NAME, V2);
    assert.equal(await Record.countDocuments({ transient: true }), 0);
});

withDb('a delegation zone that is not hosted here is said so, and nothing is written', async () => {
    const p = createProvider({ zone: 'missing.example.org', inner: zones.provider() });
    await assert.rejects(p.create(NAME, V1), /does not belong to a zone of this server/);
    assert.equal(await Record.countDocuments({ transient: true }), 0);
});
