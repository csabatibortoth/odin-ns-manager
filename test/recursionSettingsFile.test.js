// What the list of clients becomes when the server starts with a settings file of an earlier release (no such key), with
// a file that holds an invalid value, and with one that sets it: the answer has to be safe in every case.
// (QA's case "legacy settings file", written again here after a file of the same name was replaced.)
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odin-legacy-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Loads the config in a process of its own, with the given settings file (and environment), and asks the access service
function behaviour(name, file, extraEnv = {}) {
    const settings = path.join(dir, `${name}.json`);
    fs.writeFileSync(settings, typeof file === 'string' ? file : JSON.stringify(file));
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('ODIN_')) delete env[key];
    Object.assign(env, { ODIN_SETTINGS_FILE: settings, ...extraEnv });
    const script = `
        const access = require('./services/serverService/accessService');
        const config = require('./config/config');
        const asks = ['127.0.0.1', '192.168.1.10', '10.9.9.9', '203.0.113.9', '8.8.8.8', '2606:4700::1111'];
        console.log(JSON.stringify({ list: config.nsRecursionAllowed, allowed: asks.filter((a) => access.mayRecurse(a)) }));`;
    const run = spawnSync(process.execPath, ['-e', script], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return { ...JSON.parse(run.stdout.trim().split('\n').pop()), stderr: run.stderr };
}

const PRIVATE_ONLY = ['127.0.0.1', '192.168.1.10', '10.9.9.9'];

test('a settings file of an earlier release (no such key): the safe default applies', () => {
    const result = behaviour('legacy', { serverName: 'old', nsServerPort: 5353, nsUpstreamServers: ['9.9.9.9'], httpServerPort: 8080 });
    assert.deepEqual(result.allowed, PRIVATE_ONLY);
    assert.ok(result.list.includes('192.168.0.0/16') && !result.list.includes('0.0.0.0/0'));
});

test('no settings file at all: the safe default applies', () => {
    const result = behaviour('empty', '{}');
    assert.deepEqual(result.allowed, PRIVATE_ONLY);
});

test('an invalid value in the file is ignored, with a message, and the default applies', () => {
    for (const bad of [['not-an-address'], ['192.168.0.0/33'], 'everybody', 42, [7]]) {
        const result = behaviour('bad', { nsRecursionAllowed: bad });
        assert.deepEqual(result.allowed, PRIVATE_ONLY, JSON.stringify(bad));
        assert.match(result.stderr, /nsRecursionAllowed/, 'says that it is ignored');
    }
});

test('a damaged file does not open the resolver either', () => {
    const result = behaviour('damaged', '{ "nsRecursionAllowed": ["0.0.0.0/0"');
    assert.deepEqual(result.allowed, PRIVATE_ONLY);
});

test('a valid list in the file replaces the default; the environment wins over the file', () => {
    // 127.0.0.1 is this machine itself: always allowed
    assert.deepEqual(behaviour('custom', { nsRecursionAllowed: ['203.0.113.0/24'] }).allowed, ['127.0.0.1', '203.0.113.9']);
    const env = behaviour('env', { nsRecursionAllowed: ['203.0.113.0/24'] }, { ODIN_NS_RECURSION_ALLOWED: '8.8.8.8' });
    assert.deepEqual(env.allowed, ['127.0.0.1', '8.8.8.8']);
});

test('an unusable value in the environment never opens the resolver', () => {
    const result = behaviour('envbad', {}, { ODIN_NS_RECURSION_ALLOWED: 'everybody,please' });
    // the environment is read as a list of texts; an entry that is no address matches nothing, so only this machine is served
    assert.equal(result.allowed.includes('8.8.8.8'), false);
    assert.equal(result.allowed.includes('2606:4700::1111'), false);
});
