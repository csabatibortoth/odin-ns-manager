// What the name server did: the queries it answered, the clients that sent them, and the counters
// of every hour. The name server reports its queries here; everything else is derived from them.
const net = require('net');
const mongoose = require('mongoose');
const cron = require('node-cron');

const config = require('../../config/config');
const Client = require('../../model/mongoDB/clientModel');
const Metric = require('../../model/mongoDB/metricModel');
const QueryLog = require('../../model/mongoDB/queryLogModel');
const dnsData = require('../dnsService/dnsData');
const HttpError = require('../httpError');
const { escapeRegex, parseBoolean, parsePaging, parseSort, findPage } = require('../listQuery');
const logService = require('../logService/logService');

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_BATCH = 5000;
const MAX_ERRORS = 20;
const MAX_SERIES_POINTS = 10_000;
// A clock of the name server that is a little ahead is accepted; a time further in the future is a mistake.
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

const QUERY_FIELDS = ['time', 'client', 'name', 'type', 'status', 'blocked', 'durationMs'];
const QUERY_SORTABLE = new Set(['time', 'client', 'name', 'type', 'status', 'durationMs']);
const CLIENT_SORTABLE = new Set(['address', 'name', 'firstSeenAt', 'lastSeenAt', 'queries', 'blocked']);
// These become the keys of the counters of a metric, so nothing but letters and digits may pass.
const TYPE = /^[A-Z0-9]{1,16}$/;
const STATUS = /^[A-Z]{1,16}$/;
// A name as it was asked, which is not always a valid one: any visible ASCII is taken.
const QUERY_NAME = /^[\x21-\x7e]{1,255}$/;

const clientNotFound = () => new HttpError(404, 'Client not found');
const startOfHour = (date) => new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
const startOfDay = (date) => new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS);
const average = (sum, count) => (count ? Math.round((sum / count) * 100) / 100 : null);

// ---- recording --------------------------------------------------------------------------------------------

// An IPv4 address that arrived over an IPv6 socket is the same client as the plain IPv4 address.
function cleanAddress(value) {
    const address = typeof value === 'string' ? value.trim().toLowerCase() : '';
    const mapped = address.startsWith('::ffff:') ? address.slice(7) : address;
    return net.isIPv4(mapped) ? mapped : address;
}

// Returns the query as it is stored, or the message of what is wrong with it.
function parseQuery(input, now) {
    if (!dnsData.isObject(input)) return 'must be an object';
    const unknown = Object.keys(input).filter((key) => !QUERY_FIELDS.includes(key));
    if (unknown.length) return `these fields are not known: ${unknown.join(', ')}`;

    const time = input.time === undefined ? new Date(now) : new Date(input.time);
    if (Number.isNaN(time.getTime())) return 'time must be a date, e.g. 2026-11-13T10:15:00Z';
    if (time.getTime() > now + MAX_CLOCK_SKEW_MS) return 'time must not be in the future';

    const client = cleanAddress(input.client);
    if (!net.isIP(client)) return 'client must be an IPv4 or IPv6 address';

    const rawName = typeof input.name === 'string' ? input.name.trim().toLowerCase() : '';
    const name = rawName.length > 1 && rawName.endsWith('.') ? rawName.slice(0, -1) : rawName;
    if (!QUERY_NAME.test(name)) return 'name must be the name that was asked for';

    const type = typeof input.type === 'string' ? input.type.trim().toUpperCase() : '';
    if (!TYPE.test(type)) return 'type must be a record type, e.g. A';

    const status = input.status === undefined ? 'NOERROR' : String(input.status).trim().toUpperCase();
    if (!STATUS.test(status)) return 'status must be a response code, e.g. NOERROR or NXDOMAIN';

    const blocked = input.blocked ?? false;
    if (typeof blocked !== 'boolean') return 'blocked must be true or false';

    const durationMs = input.durationMs ?? null;
    if (durationMs !== null && !(Number.isFinite(durationMs) && durationMs >= 0)) {
        return 'durationMs must be a number of milliseconds';
    }

    return { time, client, name, type, status, blocked, durationMs };
}

function parseQueries(data) {
    dnsData.assertOnly(data, ['queries']);
    const { queries } = data;
    if (!Array.isArray(queries) || !queries.length || queries.length > MAX_BATCH) {
        throw dnsData.invalid({ queries: `queries must be a list of 1 to ${MAX_BATCH} queries` });
    }

    const now = Date.now();
    const details = {};
    const parsed = queries.map((input, index) => {
        const query = parseQuery(input, now);
        if (typeof query === 'string' && Object.keys(details).length < MAX_ERRORS) details[`queries[${index}]`] = query;
        return query;
    });
    if (Object.keys(details).length) throw dnsData.invalid(details);
    return parsed;
}

// Records the queries the name server answered: stores them, counts them in the metrics of their
// hour, and keeps the list of clients up to date. data: { queries: [{ client, name, type, ... }] }
// A name server that runs beside the API can call this as it is, without going through HTTP.
async function recordQueries(data) {
    const queries = parseQueries(data);

    const hours = new Map();
    const clients = new Map();
    for (const query of queries) {
        const hour = startOfHour(query.time).getTime();
        const counters = hours.get(hour) ?? {};
        const add = (key, amount = 1) => {
            counters[key] = (counters[key] ?? 0) + amount;
        };
        add('queries');
        add(`statuses.${query.status}`);
        add(`types.${query.type}`);
        // Always present, so that a new hour starts with every counter of the model.
        add('blocked', query.blocked ? 1 : 0);
        add('timed', query.durationMs === null ? 0 : 1);
        add('durationMs', query.durationMs ?? 0);
        hours.set(hour, counters);

        const client = clients.get(query.client) ?? { queries: 0, blocked: 0, first: query.time, last: query.time };
        client.queries += 1;
        client.blocked += query.blocked ? 1 : 0;
        if (query.time < client.first) client.first = query.time;
        if (query.time > client.last) client.last = query.time;
        clients.set(query.client, client);
    }

    const stored = config.queryLogRetentionDays > 0;
    await Promise.all([
        stored ? QueryLog.collection.insertMany(queries, { ordered: false }) : null,
        Metric.collection.bulkWrite(
            [...hours].map(([hour, counters]) => ({
                updateOne: { filter: { time: new Date(hour) }, update: { $inc: counters }, upsert: true },
            })),
            { ordered: false }
        ),
        Client.collection.bulkWrite(
            [...clients].map(([address, client]) => ({
                updateOne: {
                    filter: { address },
                    update: {
                        $inc: { queries: client.queries, blocked: client.blocked },
                        $min: { firstSeenAt: client.first },
                        $max: { lastSeenAt: client.last },
                        $setOnInsert: { name: '' },
                    },
                    upsert: true,
                },
            })),
            { ordered: false }
        ),
    ]);

    return { accepted: queries.length, stored };
}

// ---- reading ----------------------------------------------------------------------------------------------

function parseDate(value, field) {
    const date = new Date(typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value);
    if (typeof value !== 'string' || Number.isNaN(date.getTime())) {
        throw new HttpError(400, `${field} must be a date, e.g. 2026-11-13T10:15:00Z`);
    }
    return date;
}

// query: { from, to } - the last 24 hours when both are left out.
function parseRange(query) {
    const to = query.to === undefined ? new Date() : parseDate(query.to, 'to');
    const from = query.from === undefined ? new Date(to.getTime() - DAY_MS) : parseDate(query.from, 'from');
    if (from >= to) throw new HttpError(400, 'from must be before to');
    return { from, to };
}

// query: { page, limit, client, name, q, type, status, blocked, from, to, sort } - the newest first.
async function listQueries(query = {}) {
    const filter = {};
    if (query.client !== undefined) filter.client = cleanAddress(query.client);
    if (query.name !== undefined) filter.name = String(query.name).trim().toLowerCase().replace(/(?<=.)\.$/, '');
    else if (typeof query.q === 'string' && query.q.trim()) filter.name = new RegExp(escapeRegex(query.q.trim().toLowerCase()));
    if (query.type !== undefined) filter.type = String(query.type).toUpperCase();
    if (query.status !== undefined) filter.status = String(query.status).toUpperCase();
    if (query.blocked !== undefined) filter.blocked = parseBoolean(query.blocked, 'blocked');
    if (query.from !== undefined || query.to !== undefined) {
        filter.time = {};
        if (query.from !== undefined) filter.time.$gte = parseDate(query.from, 'from');
        if (query.to !== undefined) filter.time.$lte = parseDate(query.to, 'to');
    }

    return findPage(QueryLog, filter, parsePaging(query), parseSort(query, QUERY_SORTABLE, '-time'), QueryLog.toPublic);
}

// Deletes the stored queries: all of them, or those before `query.before`. The metrics and the clients stay.
async function deleteQueries(query = {}, actor) {
    const filter = query.before === undefined ? {} : { time: { $lt: parseDate(query.before, 'before') } };
    const { deletedCount } = await QueryLog.deleteMany(filter);
    logService.addInfoLogBasicInfoEntry('Query log cleared: ', deletedCount, ' query(ies) by ', actor?.username);
    return { deleted: deletedCount };
}

// The counters of a period, as totals and as a series over time.
// query: { from, to, interval } - interval is "hour" or "day"; days are those of UTC.
async function getMetrics(query = {}) {
    const { from, to } = parseRange(query);
    const interval = query.interval ?? 'hour';
    if (!['hour', 'day'].includes(interval)) throw new HttpError(400, 'interval must be hour or day');

    const [startOf, step] = interval === 'day' ? [startOfDay, DAY_MS] : [startOfHour, HOUR_MS];
    const first = startOf(from).getTime();
    const points = Math.floor((to.getTime() - first) / step) + 1;
    if (points > MAX_SERIES_POINTS) throw new HttpError(400, 'The period is too long for this interval; use interval=day');

    // The metrics are kept by the hour, so the period is widened to whole hours.
    const [hours, clients] = await Promise.all([
        Metric.find({ time: { $gte: startOfHour(from), $lte: to } }).lean(),
        Client.countDocuments({ lastSeenAt: { $gte: from }, firstSeenAt: { $lte: to } }),
    ]);

    const empty = () => ({ queries: 0, blocked: 0, durationMs: 0, timed: 0 });
    const totals = { ...empty(), statuses: {}, types: {} };
    const series = Array.from({ length: points }, () => empty());
    const sum = (target, source) => {
        for (const [key, count] of Object.entries(source ?? {})) target[key] = (target[key] ?? 0) + count;
    };

    for (const hour of hours) {
        const point = series[Math.floor((hour.time.getTime() - first) / step)];
        for (const target of [totals, point]) {
            target.queries += hour.queries;
            target.blocked += hour.blocked;
            target.durationMs += hour.durationMs;
            target.timed += hour.timed;
        }
        sum(totals.statuses, hour.statuses);
        sum(totals.types, hour.types);
    }

    return {
        from,
        to,
        interval,
        totals: {
            queries: totals.queries,
            blocked: totals.blocked,
            blockedPercent: totals.queries ? Math.round((totals.blocked / totals.queries) * 10000) / 100 : 0,
            averageDurationMs: average(totals.durationMs, totals.timed),
            // The clients that were seen in the period.
            clients,
            statuses: totals.statuses,
            types: totals.types,
        },
        series: series.map((point, index) => ({
            time: new Date(first + index * step),
            queries: point.queries,
            blocked: point.blocked,
            averageDurationMs: average(point.durationMs, point.timed),
        })),
    };
}

// The names that were asked for the most, those that were blocked the most, and the busiest clients
// of a period. Counted from the stored queries, so it reaches back as far as they are kept.
// query: { from, to, limit }
async function getTop(query = {}) {
    const { from, to } = parseRange(query);
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 10));

    const top = (match, field) =>
        QueryLog.aggregate([
            { $match: { time: { $gte: from, $lte: to }, ...match } },
            { $group: { _id: `$${field}`, count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: limit },
        ]);
    const [domains, blockedDomains, clients] = await Promise.all([
        top({ blocked: false }, 'name'),
        top({ blocked: true }, 'name'),
        top({}, 'client'),
    ]);
    const named = await Client.find({ address: { $in: clients.map((client) => client._id) } }).select('address name').lean();
    const nameOf = new Map(named.map((client) => [client.address, client.name]));

    return {
        from,
        to,
        domains: domains.map(({ _id, count }) => ({ name: _id, count })),
        blockedDomains: blockedDomains.map(({ _id, count }) => ({ name: _id, count })),
        clients: clients.map(({ _id, count }) => ({ address: _id, name: nameOf.get(_id) ?? '', count })),
    };
}

// ---- clients ----------------------------------------------------------------------------------------------

async function findClient(id) {
    if (!mongoose.isValidObjectId(id)) throw clientNotFound();
    const client = await Client.findById(id);
    if (!client) throw clientNotFound();
    return client;
}

// query: { page, limit, q, sort } - the last seen first.
async function listClients(query = {}) {
    const filter = {};
    if (typeof query.q === 'string' && query.q.trim()) {
        const pattern = new RegExp(escapeRegex(query.q.trim()), 'i');
        filter.$or = [{ address: pattern }, { name: pattern }];
    }
    return findPage(Client, filter, parsePaging(query), parseSort(query, CLIENT_SORTABLE, '-lastSeenAt'), Client.toPublic);
}

async function getClient(id) {
    return (await findClient(id)).toJSON();
}

// data: { name } - everything else of a client comes from its queries.
async function updateClient(id, data, actor) {
    dnsData.assertOnly(data, ['name']);
    if (typeof data.name !== 'string' || data.name.trim().length > 100) {
        throw dnsData.invalid({ name: 'name must be a text of at most 100 characters' });
    }

    const client = await findClient(id);
    client.name = data.name;
    await client.save();
    logService.addInfoLogBasicInfoEntry('Client named: ', client.address, ' = ', client.name, ' by ', actor?.username);
    return client.toJSON();
}

// Forgets the client and its counters. Its stored queries stay, and it is listed again when it sends another.
async function deleteClient(id, actor) {
    const client = await findClient(id);
    await client.deleteOne();
    logService.addInfoLogBasicInfoEntry('Client deleted: ', client.address, ' by ', actor?.username);
}

// ---- retention --------------------------------------------------------------------------------------------

// Deletes the queries and the metrics that are older than the configuration keeps them.
async function purge() {
    const before = (days) => new Date(Date.now() - days * DAY_MS);
    // 0 for the queries: none are stored any more, and those of an earlier setting are removed.
    const queries = await QueryLog.deleteMany({ time: { $lt: before(config.queryLogRetentionDays) } });
    const metrics = config.metricsRetentionDays > 0
        ? await Metric.deleteMany({ time: { $lt: before(config.metricsRetentionDays) } })
        : { deletedCount: 0 };

    if (queries.deletedCount || metrics.deletedCount) {
        logService.addInfoLogBasicInfoEntry(
            'Monitoring data expired: ', queries.deletedCount, ' query(ies), ', metrics.deletedCount, ' hour(s) of metrics'
        );
    }
}

// Runs the purge now, and then every hour. Returns the task.
function startSchedule() {
    const run = () => purge().catch((err) => logService.addErrorLogErrorEntry('Monitoring purge failed: ', err.stack || err));
    run();
    return cron.schedule('17 * * * *', run);
}

module.exports = {
    recordQueries,
    listQueries,
    deleteQueries,
    getMetrics,
    getTop,
    listClients,
    getClient,
    updateClient,
    deleteClient,
    purge,
    startSchedule,
};
