// The settings of the DNS challenge that come after the first ones (Phil's file).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

for (const name of Object.keys(process.env)) if (name.startsWith('ODIN_')) delete process.env[name];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odin-acme-settings-'));
process.env.ODIN_SETTINGS_FILE = path.join(dir, 'settings.json');
const config = require('../config/config');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('the settle wait: 60 seconds by default, from 0 to 120', () => {
    assert.equal(config.acmeDnsSettle, 60);
    config.update({ acmeDnsSettle: 0 });
    // not a live setting: the running value stays, the saved one waits for the next start
    const item = config.describe().groups.flatMap((g) => g.settings).find((s) => s.key === 'acmeDnsSettle');
    assert.deepEqual([item.value, item.pending], [60, 0]);
    for (const bad of [-1, 121, 1.5, '10']) assert.throws(() => config.update({ acmeDnsSettle: bad }), (err) => Boolean(err.details.acmeDnsSettle), String(bad));
    config.update({ acmeDnsSettle: null });
});
