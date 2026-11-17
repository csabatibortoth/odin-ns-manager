// The plugin loader: what a folder has to hold, and what a plugin can do with its api.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

for (const name of Object.keys(process.env)) if (name.startsWith('ODIN_')) delete process.env[name];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odin-plugins-'));
process.env.ODIN_SETTINGS_FILE = path.join(root, 'settings.json');
process.env.ODIN_PLUGINS_FOLDER = path.join(root, 'plugins');
process.env.ODIN_PLUGINS_ENABLED = 'good,bad,wrongname,missing,keeper,oldkeeper';

// The log service of freya-ns-api is not needed here
const apiPath = require.resolve('../services/apiService/apiService');
const logged = [];
const logger = new Proxy({}, { get: (_, level) => (...parts) => logged.push([level, parts.join('')]) });
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: { logService: logger } };

const write = (name, files) => {
    for (const [file, content] of Object.entries(files)) {
        const target = path.join(root, 'plugins', name, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
};

const pluginService = require('../services/pluginService/pluginService');
const events = [];
global.__pluginEvents = events;

before(async () => {
    write('good', {
        'plugin.json': JSON.stringify({ name: 'good', version: '1.2.3', description: 'works', roles: ['admin'], ui: { label: 'Good' } }),
        'index.js': `exports.activate = (api) => {
            api.router.get('/hi', (req, res) => res.json({ hi: api.name }));
            api.on('dnsChange', () => global.__pluginEvents.push('dnsChange'));
            api.on('sync', () => { throw new Error('a handler that fails'); });
        };
        exports.deactivate = () => global.__pluginEvents.push('deactivate');`,
        'public/ui.js': 'export function render() {}',
    });
    write('bad', { 'plugin.json': JSON.stringify({ name: 'bad' }), 'index.js': 'exports.activate = () => { throw new Error("no start"); };' });
    write('wrongname', { 'plugin.json': JSON.stringify({ name: 'other' }), 'index.js': 'exports.activate = () => {};' });
    // Where the files of a plugin go: next to the settings, or the old data folder of a plugin that has one
    write('keeper', { 'plugin.json': JSON.stringify({ name: 'keeper' }), 'index.js': 'exports.activate = (api) => { global.__keeper = api.dataFolder; };' });
    write('oldkeeper', { 'plugin.json': JSON.stringify({ name: 'oldkeeper' }), 'index.js': 'exports.activate = (api) => { global.__oldkeeper = api.dataFolder; };', 'data/notes.txt': 'kept' });
    await pluginService.start();
});

after(async () => {
    await pluginService.stop();
    fs.rmSync(root, { recursive: true, force: true });
});

test('a plugin that is right runs, the others are reported and left out', () => {
    const found = Object.fromEntries(pluginService.discover().map((plugin) => [plugin.name, plugin]));
    assert.equal(found.good.state, 'running');
    assert.equal(found.good.version, '1.2.3');
    assert.equal(found.bad.state, 'failed');
    assert.match(found.bad.error, /no start/);
    assert.equal(found.wrongname.state, 'failed');
    assert.match(found.wrongname.error, /names it "other"/);
});

test('the menu holds the pages of the running plugins for the roles that may open them', () => {
    assert.deepEqual(pluginService.menu('admin'), [{ plugin: 'good', label: 'Good', script: 'ui.js', group: 'Plugins' }]);
    assert.deepEqual(pluginService.menu('user'), []);
});

test('events reach the plugins, and a handler that fails does not stop the others', async () => {
    pluginService.emit('sync', {});
    pluginService.emit('dnsChange');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ['dnsChange']);
    assert.ok(logged.some(([, text]) => /a handler that fails/.test(text)));
});

test('only the public folder of a running plugin is served', async () => {
    const express = require('express');
    const app = express();
    // Without the sign in, which is the one of freya-ns-api
    app.use('/plugins', pluginService.createStatic());
    const server = await new Promise((resolve) => {
        const listening = http.createServer(app).listen(0, '127.0.0.1', () => resolve(listening));
    });
    const get = (url) => new Promise((resolve) => http.get(`http://127.0.0.1:${server.address().port}${url}`, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
    }));
    try {
        assert.equal((await get('/plugins/good/ui.js')).status, 200);
        assert.equal((await get('/plugins/good/index.js')).status, 404); // only public/ is served
        assert.equal((await get('/plugins/bad/ui.js')).status, 404);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('the data folder of a plugin is next to the settings, not in the (read-only) program folder, and only the service gets in', () => {
    const expected = path.join(root, 'plugin-data', 'keeper');
    assert.equal(global.__keeper, expected);
    assert.ok(fs.statSync(expected).isDirectory());
    assert.ok(!fs.existsSync(path.join(root, 'plugins', 'keeper', 'data')), 'nothing is made in the folder of the plugin');
    if (process.platform !== 'win32') assert.equal(fs.statSync(expected).mode & 0o777, 0o700);
});

test('a plugin that already has a data folder of its own keeps using it', () => {
    assert.equal(global.__oldkeeper, path.join(root, 'plugins', 'oldkeeper', 'data'));
    assert.equal(fs.readFileSync(path.join(global.__oldkeeper, 'notes.txt'), 'utf8'), 'kept');
    assert.ok(!fs.existsSync(path.join(root, 'plugin-data', 'oldkeeper')));
});
