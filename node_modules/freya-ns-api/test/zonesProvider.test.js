// The provider "zones" against a real MongoDB, in a database of its own that is dropped afterwards.
// Set FREYA_TEST_MONGO to another server if there is none on 127.0.0.1:27017; without a server these tests are skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const URI = process.env.FREYA_TEST_MONGO || 'mongodb://127.0.0.1:27017';
const DB = `freya_test_zones_${process.pid}`;
const V1 = 'a'.repeat(43);
const V2 = 'b'.repeat(43);
const soa = { host: 'ns1.example.com', admin: 'hostmaster.example.com', serial: 1, refresh: 3600, retry: 600, expire: 604800, ttl: 3600 };

let Zone, Record, zones, recordService, backupService, up = false;
let changes = 0;

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
    recordService = require('../services/dnsService/recordService');
    backupService = require('../services/backupService/backupService');
    zones.configure({ onChange: () => void changes++ });
    await Zone.create([
        { name: 'example.com', soa },
        { name: 'sub.example.com', soa },
        { name: 'off.org', soa, active: false },
    ]);
});

test.after(async () => {
    if (up) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
});

// Whether the database is there is known only after the connection was tried: decided when each test runs.
const withDb = (name, fn) =>
    test(name, async (ctx) => {
        if (!up) return ctx.skip('no MongoDB');
        await fn();
    });

withDb('writes a transient TXT record into the zone with the longest matching name', async () => {
    const name = '_acme-challenge.host.sub.example.com';
    await zones.provider().create(name, V1);
    const [record] = await Record.find({ name }).lean();
    assert.equal(record.transient, true);
    assert.equal(record.type, 'TXT');
    assert.deepEqual(record.data, { target: V1 });
    assert.equal(String(record.zone), String((await Zone.findOne({ name: 'sub.example.com' }))._id));
    await zones.provider().remove(name, V1);
    assert.equal(await Record.countDocuments({ name }), 0);
});

withDb('does not raise the serial, but marks the zone changed and tells the host', async () => {
    const before = await Zone.findOne({ name: 'example.com' }).lean();
    const n = changes;
    await new Promise((r) => setTimeout(r, 5));
    await zones.provider().create('_acme-challenge.example.com', V1);
    const after = await Zone.findOne({ name: 'example.com' }).lean();
    assert.equal(after.soa.serial, before.soa.serial);
    assert.ok(after.updatedAt > before.updatedAt);
    assert.equal(changes, n + 1);
    await zones.provider().remove('_acme-challenge.example.com', V1);
});

withDb('two values at one name (wildcard + base name); a retry is not an error; remove takes only its own value', async () => {
    const name = '_acme-challenge.example.com';
    const p = zones.provider();
    await p.create(name, V1);
    await p.create(name, V2);
    await p.create(name, V2);
    assert.equal(await Record.countDocuments({ name }), 2);
    await p.remove(name, V1);
    assert.deepEqual((await Record.find({ name }).lean()).map((r) => r.data.target), [V2]);
    await p.remove(name, V2);
});

withDb('hidden from the record list, the export and the backup', async () => {
    const name = '_acme-challenge.example.com';
    await zones.provider().create(name, V1);
    const zone = await Zone.findOne({ name: 'example.com' });
    const listed = await recordService.listRecords(String(zone._id), {});
    assert.equal(JSON.stringify(listed).includes(V1), false);
    const exported = await backupService.exportData({ include: 'zones,records' });
    assert.ok(exported.data.zones.some((z) => z.name === 'example.com'), 'the export holds the zones');
    assert.equal(JSON.stringify(exported).includes(V1), false);
    // The name server still gets it: the record is in the collection and active.
    assert.equal(await Record.countDocuments({ name, transient: true, active: true }), 1);
    await zones.provider().remove(name, V1);
});

withDb('refuses anything but a challenge name and value, and names outside every zone', async () => {
    const p = zones.provider();
    await assert.rejects(p.create('www.example.com', V1), /_acme-challenge/);
    await assert.rejects(p.create('_acme-challenge.example.com', 'short'), /wrong form/);
    await assert.rejects(p.create('_acme-challenge.other.net', V1), /does not belong to a zone/);
    await assert.rejects(p.create('_acme-challenge.off.org', V1), /does not belong to a zone/); // inactive zone
    assert.equal(await Record.countDocuments({ transient: true }), 0);
});

withDb('never deletes a record a person made, even one that looks the same', async () => {
    const name = '_acme-challenge.example.com';
    const zone = await Zone.findOne({ name: 'example.com' });
    await Record.create({ zone: zone._id, name, type: 'TXT', data: { target: V1 } });
    await zones.provider().remove(name, V1);
    assert.equal(await Record.countDocuments({ name }), 1);
    await Record.deleteMany({ name });
});

withDb('does not write where a CNAME is', async () => {
    const zone = await Zone.findOne({ name: 'example.com' });
    await Record.create({ zone: zone._id, name: '_acme-challenge.alias.example.com', type: 'CNAME', data: { target: 'x.example.net' } });
    await assert.rejects(zones.provider().create('_acme-challenge.alias.example.com', V1), /CNAME/);
});

withDb('visible without a name server of this process looks at the database', async () => {
    const name = '_acme-challenge.example.com';
    const p = zones.provider();
    assert.equal(await p.visible(name, V1), false);
    await p.create(name, V1);
    assert.equal(await p.visible(name, V1), true);
    await p.remove(name, V1);
});

withDb('leftovers are removed at start', async () => {
    await zones.provider().create('_acme-challenge.example.com', V1);
    await zones.provider().create('_acme-challenge.host.sub.example.com', V2);
    assert.equal(await zones.removeLeftovers(), 2);
    assert.equal(await Record.countDocuments({ transient: true }), 0);
});
