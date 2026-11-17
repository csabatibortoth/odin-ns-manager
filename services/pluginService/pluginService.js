// Plugins extend the server. A plugin is a folder in the plugins folder:
//
//   plugins/<name>/plugin.json   { "name", "version", "description", "main", "roles", "ui" }
//   plugins/<name>/index.js      exports activate(api) and, optionally, deactivate()
//   plugins/<name>/public/       files of the user interface, served at /plugins/<name>/
//
// A plugin runs when its name is in the setting "Plugins that run". It is code of
// its own with the rights of the server: only plugins that are trusted should be
// enabled. The api an activated plugin gets is described in docs/plugins.md.
const fs = require('fs');
const path = require('path');
const express = require('express');

const config = require('../../config/config');
const mailService = require('../serverService/mailService');

const ROOT = path.resolve(__dirname, '../..');
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const ROLES = ['admin', 'user'];
const EVENTS = ['dnsChange', 'sync'];

const logs = () => require('../apiService/apiService').logService;

// name -> { manifest, folder, state: 'running' | 'failed' | 'stopped', error, router, handlers, timers, module }
const plugins = new Map();

const folder = () => path.resolve(ROOT, config.pluginsFolder);

// Reads and checks plugin.json; throws with the reason
function readManifest(dir, name) {
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    } catch (err) {
        throw new Error(err.code === 'ENOENT' ? 'plugin.json is missing' : `plugin.json can not be read: ${err.message}`);
    }
    if (manifest.name !== name) throw new Error(`plugin.json names it "${manifest.name}", but the folder is "${name}"`);

    const main = path.resolve(dir, manifest.main || 'index.js');
    if (path.relative(dir, main).startsWith('..') || path.isAbsolute(path.relative(dir, main))) throw new Error('main has to be inside the folder of the plugin');
    const roles = manifest.roles === undefined ? ['admin'] : manifest.roles;
    if (!Array.isArray(roles) || !roles.length || roles.some((role) => !ROLES.includes(role))) throw new Error(`roles has to be a list of: ${ROLES.join(', ')}`);

    let ui = null;
    if (manifest.ui) {
        const script = manifest.ui.script || 'ui.js';
        const target = path.resolve(dir, 'public', script);
        if (!manifest.ui.label || typeof manifest.ui.label !== 'string') throw new Error('ui.label is missing');
        if (path.relative(path.join(dir, 'public'), target).startsWith('..')) throw new Error('ui.script has to be in the public folder');
        ui = { label: manifest.ui.label.slice(0, 40), script, group: typeof manifest.ui.group === 'string' ? manifest.ui.group.slice(0, 40) : 'Plugins' };
    }
    return { name, version: String(manifest.version || ''), description: String(manifest.description || ''), main, roles, ui };
}

// Every folder of the plugins folder, with what is known about it
function discover() {
    let names = [];
    try {
        names = fs.readdirSync(folder(), { withFileTypes: true }).filter((entry) => entry.isDirectory() && NAME.test(entry.name)).map((entry) => entry.name);
    } catch {
        // No plugins folder: no plugins
    }
    return names.sort().map((name) => {
        const dir = path.join(folder(), name);
        const loaded = plugins.get(name);
        const item = { name, enabled: config.pluginsEnabled.includes(name), state: loaded?.state || 'off', error: loaded?.error || null };
        try {
            const manifest = readManifest(dir, name);
            Object.assign(item, { version: manifest.version, description: manifest.description, roles: manifest.roles, ui: manifest.ui });
        } catch (err) {
            item.error = item.error || err.message;
            item.broken = true;
        }
        return item;
    });
}

// Where a plugin keeps its files. The folder of the program is read-only for the service on an installation (it belongs to root), so the
// files go next to the saved settings, which is the one place the service can write: <folder of settings.json>/plugin-data/<name>, that
// is /var/lib/odin-ns-manager/plugin-data/<name> on an installation. Only the service gets in (the files can hold keys). A plugin that
// already has a data folder of its own in its plugin folder (before 2.6.1) keeps using that one.
function dataFolderOf(plugin) {
    const old = path.join(plugin.folder, 'data');
    const data = path.join(path.dirname(config.settingsFile), 'plugin-data', plugin.manifest.name);
    if (!fs.existsSync(data) && fs.existsSync(old)) return old;
    fs.mkdirSync(data, { recursive: true, mode: 0o700 });
    return data;
}

function createApi(plugin) {
    const { name } = plugin.manifest;
    const label = (level) => (...parts) => logs()[level](`Plugin ${name}: `, ...parts);
    const json = express.json({ limit: '1mb' });
    plugin.router = express.Router();
    plugin.router.use(json);

    return Object.freeze({
        name,
        version: plugin.manifest.version,
        // The folder of the plugin, and one it can keep its files in
        folder: plugin.folder,
        dataFolder: dataFolderOf(plugin),
        // The settings of the server that are safe to read
        server: Object.freeze({ name: config.serverName, company: config.companyName, version: config.version }),
        log: { info: label('addInfoLogBasicInfoEntry'), error: label('addErrorLogErrorEntry') },
        mail: Object.freeze({ configured: mailService.isConfigured, send: mailService.send, notify: mailService.notify }),
        // An express router, mounted at /api/plugins/<name>. Only the roles of the plugin get in.
        router: plugin.router,
        // api.on('dnsChange' | 'sync', handler). A handler that throws is logged, and does not stop the server.
        on(event, handler) {
            if (!EVENTS.includes(event)) throw new Error(`The events are: ${EVENTS.join(', ')}`);
            if (typeof handler !== 'function') throw new Error('The handler has to be a function');
            plugin.handlers.push({ event, handler });
        },
        // Runs handler every `seconds` (at least 1) while the plugin runs
        every(seconds, handler) {
            if (!(seconds >= 1) || typeof handler !== 'function') throw new Error('every(seconds, handler): seconds is at least 1');
            const timer = setInterval(() => safely(plugin, 'job', handler), seconds * 1000);
            timer.unref();
            plugin.timers.push(timer);
        },
    });
}

async function safely(plugin, what, fn, ...args) {
    try {
        await fn(...args);
    } catch (err) {
        logs().addErrorLogErrorEntry(`Plugin ${plugin.manifest.name} (${what}) failed: `, err.stack || err);
    }
}

async function activate(name) {
    const dir = path.join(folder(), name);
    const plugin = { folder: dir, manifest: null, state: 'failed', error: null, handlers: [], timers: [], router: null, module: null };
    plugins.set(name, plugin);
    try {
        plugin.manifest = readManifest(dir, name);
        plugin.module = require(plugin.manifest.main);
        if (typeof plugin.module.activate !== 'function') throw new Error('index.js has to export activate(api)');
        await plugin.module.activate(createApi(plugin));
        plugin.state = 'running';
        logs().addInfoLogBasicInfoEntry('Plugin started: ', name, ' ', plugin.manifest.version);
    } catch (err) {
        plugin.error = err.message;
        stopTimers(plugin);
        plugin.handlers = [];
        logs().addErrorLogErrorEntry(`Plugin ${name} could not be started: `, err.stack || err);
    }
}

function stopTimers(plugin) {
    for (const timer of plugin.timers) clearInterval(timer);
    plugin.timers = [];
}

// Starts the plugins that are enabled. A plugin that fails is left out, the others run.
async function start() {
    for (const name of config.pluginsEnabled) {
        if (!NAME.test(name)) continue;
        if (!fs.existsSync(path.join(folder(), name))) {
            plugins.set(name, { state: 'failed', error: 'The folder of the plugin is missing', handlers: [], timers: [] });
            logs().addErrorLogErrorEntry('Plugin folder is missing: ', name);
            continue;
        }
        await activate(name);
    }
    return [...plugins.values()].filter((plugin) => plugin.state === 'running').length;
}

async function stop() {
    for (const plugin of plugins.values()) {
        stopTimers(plugin);
        if (plugin.state === 'running' && typeof plugin.module?.deactivate === 'function') await safely(plugin, 'deactivate', plugin.module.deactivate);
        plugin.state = 'stopped';
    }
}

// Tells the plugins that listen to the event
function emit(event, payload) {
    for (const plugin of plugins.values()) {
        for (const listener of plugin.handlers) if (listener.event === event) safely(plugin, event, listener.handler, payload);
    }
}

// The pages of the plugins that the role may open, for the menu
function menu(role) {
    return [...plugins.values()]
        .filter((plugin) => plugin.state === 'running' && plugin.manifest.ui && plugin.manifest.roles.includes(role))
        .map((plugin) => ({ plugin: plugin.manifest.name, ...plugin.manifest.ui }));
}

// /api/plugins/<name>/...: the routers of the plugins, for signed in users of the roles of the plugin
function createRouter() {
    const { authenticate, requireRole } = require('freya-ns-api/services/authService/authService');
    const router = express.Router();
    router.use('/:name', authenticate, (req, res, next) => {
        const plugin = plugins.get(req.params.name);
        if (!plugin || plugin.state !== 'running' || !plugin.router) return res.status(404).json({ error: 'Not found' });
        return requireRole(...plugin.manifest.roles)(req, res, () => plugin.router(req, res, next));
    });
    return router;
}

// /plugins/<name>/<file>: the files of the user interface of the plugins
function createStatic() {
    const router = express.Router();
    router.use('/:name', (req, res, next) => {
        const plugin = plugins.get(req.params.name);
        if (!plugin || plugin.state !== 'running' || !plugin.manifest.ui) return next();
        return express.static(path.join(plugin.folder, 'public'), { index: false, dotfiles: 'deny' })(req, res, next);
    });
    return router;
}

module.exports = { start, stop, emit, discover, menu, createRouter, createStatic };
