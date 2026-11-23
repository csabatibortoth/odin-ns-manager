// Isolated settings file: this exercises the safe defaults an install or an older
// settings file (created before the recursion setting existed) receives.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

for (const name of Object.keys(process.env)) {
    if (name.startsWith('ODIN_')) delete process.env[name];
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odin-recursion-access-'));
const settingsFile = path.join(directory, 'settings.json');
fs.writeFileSync(settingsFile, JSON.stringify({ nsUpstreamServers: ['9.9.9.9'] }));
process.env.ODIN_SETTINGS_FILE = settingsFile;

const config = require('../config/config');
const access = require('../services/serverService/accessService');

after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('a clean or pre-access-list settings file gets the private-network recursion default', () => {
    assert.deepEqual(config.nsRecursionAllowed, [
        '127.0.0.0/8',
        '10.0.0.0/8',
        '172.16.0.0/12',
        '192.168.0.0/16',
        '100.64.0.0/10',
        '169.254.0.0/16',
        '::1/128',
        'fc00::/7',
        'fe80::/10',
    ]);
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { nsUpstreamServers: ['9.9.9.9'] });
});

test('recursion access checks IPv4, IPv6, and IPv4-mapped client addresses against CIDRs', () => {
    config.nsRecursionAllowed = ['192.168.0.0/16', '2001:db8:1234::/48'];

    assert.equal(access.mayRecurse('192.168.10.25'), true);
    assert.equal(access.mayRecurse('192.169.10.25'), false);
    assert.equal(access.mayRecurse('2001:db8:1234::25'), true);
    assert.equal(access.mayRecurse('2001:db8:1235::25'), false);
    assert.equal(access.mayRecurse('::ffff:203.0.113.9'), false);
    assert.equal(access.mayRecurse(undefined), false);
    assert.equal(access.mayRecurse('not-an-ip'), false);
});

test('live allowlist changes take effect on the next access check', () => {
    config.nsRecursionAllowed = ['198.51.100.0/24'];
    assert.equal(access.mayRecurse('198.51.100.42'), true);
    assert.equal(access.mayRecurse('203.0.113.42'), false);

    config.nsRecursionAllowed = ['203.0.113.0/24'];
    assert.equal(access.mayRecurse('198.51.100.42'), false);
    assert.equal(access.mayRecurse('203.0.113.42'), true);
});
