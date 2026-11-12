// The part of the API that is about this service itself: its status and the
// history of it, its settings, the maintenance of the DNS server, and its
// logs. Mounted at /api/service, next to the API of freya-ns-api, and
// answering in the same way.
const fs = require('fs');
const net = require('net');
const path = require('path');
const { Resolver } = require('dns').promises;
const express = require('express');

const config = require('../../config/config');
const build = require('../serverService/buildInfo');
const searchService = require('../serverService/searchService');
const statusService = require('../serverService/statusService');
const zoneService = require('../serverService/zoneService');

const LOOKUP_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR', 'SOA', 'SRV', 'TXT'];
const LOG_TARGETS = ['log', 'error', 'security'];
const MAX_LOG_LINES = 1000;
const MAX_LOG_BYTES = 512 * 1024; // of the end of the file

// Where a query has to be sent to reach our own DNS server
function nameServerAddress() {
    const any = { '0.0.0.0': '127.0.0.1', '::': '::1' };
    const host = any[config.serverIPAddress] || config.serverIPAddress;
    return net.isIPv6(host) ? `[${host}]:${config.nsServerPort}` : `${host}:${config.nsServerPort}`;
}

// Every answer as one line of text, in the notation of a zone file
const ANSWER_TEXT = {
    MX: (mx) => `${mx.priority} ${mx.exchange}`,
    SRV: (srv) => `${srv.priority} ${srv.weight} ${srv.port} ${srv.name}`,
    TXT: (parts) => parts.join(''),
};
const soaText = (soa) =>
    `${soa.nsname} ${soa.hostmaster} ${soa.serial} ${soa.refresh} ${soa.retry} ${soa.expire} ${soa.minttl}`;

function status() {
    const memory = process.memoryUsage();
    return {
        name: config.serverName,
        company: config.companyName,
        version: config.version,
        build,
        type: config.type,
        startedAt: statusService.startedAt,
        uptime: Math.round(process.uptime()),
        node: process.version,
        memory: memory.rss,
        dns: {
            address: config.serverIPAddress,
            port: config.nsServerPort,
            tcp: config.nsTcpEnabled,
            queries: { ...statusService.queries },
        },
        zones: { enabled: config.nsZonesEnabled, refresh: config.nsZoneRefresh, ...zoneService.state() },
        cache: { enabled: config.nsCacheEnabled, entries: searchService.cacheSize(), max: config.nsCacheMaxEntries },
        upstream: searchService.upstreamServers(),
    };
}

// Asks our own DNS server, over the network, like any client of it does
async function lookup(query) {
    const HttpError = require('freya-ns-api/services/httpError');

    const name = typeof query.name === 'string' ? query.name.trim().replace(/\.$/, '') : '';
    const type = typeof query.type === 'string' ? query.type.toUpperCase() : 'A';
    if (!name || name.length > 253 || !/^[a-z0-9_*]([a-z0-9_*.-]*[a-z0-9_])?$/i.test(name)) {
        throw new HttpError(400, 'Validation failed', { name: 'name must be a domain name' });
    }
    if (!LOOKUP_TYPES.includes(type)) {
        throw new HttpError(400, 'Validation failed', { type: `type must be one of: ${LOOKUP_TYPES.join(', ')}` });
    }

    const resolver = new Resolver({ timeout: 3000, tries: 1 });
    resolver.setServers([nameServerAddress()]);

    const zone = zoneService.zoneOf(name);
    let source = 'upstream';
    if (zone) source = 'zone';
    else if (zoneService.isStandalone(name)) source = 'records';
    const result = { name, type, zone, source, answers: [], error: null };
    const started = performance.now();
    try {
        const answers = await resolver.resolve(name, type);
        result.answers = type === 'SOA' ? [soaText(answers)] : answers.map(ANSWER_TEXT[type] || String);
    } catch (err) {
        result.error = err.code || err.message;
    }
    result.ms = Math.round((performance.now() - started) * 10) / 10;
    return result;
}

// The end of one of the log files of a day
async function readLog(query) {
    const HttpError = require('freya-ns-api/services/httpError');
    if (!config.logingEnabled) throw new HttpError(404, 'Logging is not enabled');

    const target = query.target === undefined ? 'log' : query.target;
    if (!LOG_TARGETS.includes(target)) throw new HttpError(400, `target must be one of: ${LOG_TARGETS.join(', ')}`);

    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const date = query.date === undefined ? `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` : query.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'date must be written as YYYY-MM-DD');

    const lines = Math.min(MAX_LOG_LINES, Math.max(1, Number.parseInt(query.lines, 10) || 200));

    // The folder and the file names are the ones of the log service of freya-ns-api
    const folder = path.resolve(path.dirname(require.resolve('freya-ns-api/package.json')), process.env.FREYA_LOG_FOLDER);
    const file = path.join(folder, `${target}-${date.replaceAll('-', '.')}.log`);

    let text = '';
    let truncated = false;
    try {
        const handle = await fs.promises.open(file, 'r');
        try {
            const { size } = await handle.stat();
            const length = Math.min(size, MAX_LOG_BYTES);
            const buffer = Buffer.alloc(length);
            await handle.read(buffer, 0, length, size - length);
            text = buffer.toString('utf8');
            truncated = length < size;
        } finally {
            await handle.close();
        }
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }

    let entries = text.split(/\r?\n/).filter(Boolean);
    if (truncated) entries.shift(); // the first line is most likely cut in half
    truncated = truncated || entries.length > lines;
    entries = entries.slice(-lines);
    return { target, date, lines: entries, truncated };
}

// What every router of ours starts with: the headers of an answer of the
// API, and the JSON body of the request
function prepare(router) {
    router.use((req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        next();
    });
    router.use(express.json({ limit: '100kb' }));
    return router;
}

// ... and ends with: what is not found, and the errors, answered as freya-ns-api does
function finish(router) {
    const { logService } = require('./apiService');

    router.use((req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    // eslint-disable-next-line no-unused-vars
    router.use((err, req, res, next) => {
        const status = err.status || err.statusCode || 500;
        if (status >= 500) logService.addErrorLogErrorEntry(`${req.method} ${req.originalUrl} - `, err.stack || err);
        res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message, details: status >= 500 ? undefined : err.details });
    });

    return router;
}

function createRouter() {
    const { authenticate, requireRole } = require('freya-ns-api/services/authService/authService');
    const HttpError = require('freya-ns-api/services/httpError');
    const { logService } = require('./apiService');

    const router = prepare(express.Router());
    const adminOnly = requireRole('admin');

    // What a client has to know before anybody is signed in
    router.get('/info', (req, res) => {
        res.json({
            name: config.serverName,
            company: config.companyName,
            version: config.version,
            build,
            authEnabled: config.authEnabled,
            dnsWriteRoles: config.dnsWriteRoles,
        });
    });

    router.get('/status', authenticate, (req, res) => {
        res.json(status());
    });

    // The history of the queries, the memory and the cache, for the graphs of the dashboard
    router.get('/metrics', authenticate, (req, res) => {
        const range = req.query.range === undefined ? '1h' : req.query.range;
        if (!statusService.RANGES.includes(range)) throw new HttpError(400, `range must be one of: ${statusService.RANGES.join(', ')}`);
        res.json(statusService.history(range));
    });

    router.get('/config', authenticate, adminOnly, (req, res) => {
        res.json(config.describe());
    });

    // body: { key: value } - null brings a setting back to its default
    router.patch('/config', authenticate, adminOnly, (req, res) => {
        const changed = config.update(req.body);
        if (changed.length) logService.addSecurityLogInfoEntry('Settings changed by ', req.user.username, ': ', changed.join(', '));
        res.json({ changed, ...config.describe() });
    });

    router.get('/lookup', authenticate, async (req, res) => {
        res.json(await lookup(req.query));
    });

    router.post('/zones/reload', authenticate, adminOnly, async (req, res) => {
        await zoneService.refresh();
        logService.addInfoLogBasicInfoEntry('DNS zones reloaded by ', req.user.username);
        res.json(status().zones);
    });

    router.post('/cache/clear', authenticate, adminOnly, (req, res) => {
        const cleared = searchService.cacheSize();
        searchService.clearCache();
        logService.addInfoLogBasicInfoEntry('DNS cache cleared by ', req.user.username, ': ', cleared, ' entries');
        res.json({ cleared });
    });

    router.get('/logs', authenticate, adminOnly, async (req, res) => {
        res.json(await readLog(req.query));
    });

    return finish(router);
}

module.exports = { createRouter, prepare, finish };
