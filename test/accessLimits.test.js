// The resolver access list: the safe default, closed on what cannot be read, the machine itself, the checks when
// saving, and the table of the refused. (Phil's cases; test/accessService.test.js is Steve's file.)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach } = require('node:test');

for (const name of Object.keys(process.env)) if (name.startsWith('ODIN_')) delete process.env[name];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odin-limits-'));
process.env.ODIN_SETTINGS_FILE = path.join(dir, 'settings.json');

const config = require('../config/config');
const access = require('../services/serverService/accessService');
const cidr = require('../services/serverService/cidr');

beforeEach(() => access.reset());
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('the default is this machine and the private networks, nothing public', () => {
    assert.equal(config.nsRecursionAllowed.includes('0.0.0.0/0'), false);
    assert.equal(config.nsRecursionAllowed.includes('::/0'), false);
    for (const ok of ['127.0.0.1', '127.9.9.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.50.7', '100.64.1.1', '169.254.1.1', '::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', '::ffff:192.168.1.1']) {
        assert.equal(access.mayRecurse(ok), true, `${ok} may`);
    }
    for (const no of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '192.169.0.1', '100.128.0.1', '2001:db8::1', '2606:4700::1111', '::ffff:8.8.8.8']) {
        assert.equal(access.mayRecurse(no), false, `${no} may not`);
    }
});

test('an address that cannot be read is refused: closed is the safe side', () => {
    for (const bad of [undefined, null, '', 'garbage', '999.1.1.1', 42, {}]) assert.equal(access.mayRecurse(bad), false);
});

test('a client that is this machine is never refused, under any of its addresses', () => {
    config.update({ nsRecursionAllowed: ['203.0.113.0/24'] });
    const mine = Object.values(os.networkInterfaces()).flat().map((item) => item.address)[0];
    assert.equal(access.mayRecurse(mine), true);
    assert.equal(access.mayRecurse('127.0.0.1'), true);
    config.update({ nsRecursionAllowed: null });
});

test('entries are checked when saved; an empty list means nobody but this machine', () => {
    for (const bad of ['192.168.0.0/33', '::/129', 'example.com', '10.0.0.0/8/8', '10.0.0.0/x', '300.1.1.1/8']) {
        assert.throws(() => config.update({ nsRecursionAllowed: ['10.0.0.0/8', bad] }), (err) => Boolean(err.details.nsRecursionAllowed), bad);
    }
    assert.equal(cidr.parseEntry('10.0.0.0/8').prefix, 8);
    assert.equal(cidr.parseEntry('10.0.0.1').prefix, 32);
    assert.equal(cidr.parseEntry('::1').prefix, 128);
    assert.equal(cidr.parseEntry('::/0').family, 'ipv6');
    config.update({ nsRecursionAllowed: [] });
    assert.equal(access.mayRecurse('192.168.1.1'), false);
    assert.equal(access.mayRecurse('127.0.0.1'), true, 'this machine');
    config.update({ nsRecursionAllowed: null });
});

test('the refused are counted per client in a table that cannot grow without bound', () => {
    for (let i = 0; i < 5; i++) access.noteRefused('8.8.8.8', 1000 + i);
    access.noteRefused('1.1.1.1', 2000);
    access.noteRefused(undefined, 3000);
    assert.equal(access.state().refused, 7);
    assert.deepEqual(access.refusedClients().map((c) => [c.client, c.count]), [['8.8.8.8', 5], ['unknown', 1], ['1.1.1.1', 1]]); // same count: the latest first

    access.reset();
    for (let i = 0; i < access.MAX_CLIENTS + 50; i++) access.noteRefused(`203.0.${Math.floor(i / 250)}.${(i % 250) + 1}`, i);
    assert.equal(access.state().clients, access.MAX_CLIENTS);
    assert.equal(access.state().refused, access.MAX_CLIENTS + 50);
    assert.equal(access.refusedClients(500).some((c) => c.client === '203.0.0.1'), false, 'the clients seen longest ago made room');
});
