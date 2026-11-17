// What is measured: the numbers of this server, as metrics for Heimdall.
//
// Counters only ever go up (use "rate" in Heimdall to see them per second); gauges are what is
// true now. The names start with "aesir." and stay stable, so graphs and rules keep working.
const KINDS = ['total', 'zones', 'records', 'blocked', 'forwarded', 'failed'];

// sources: { uptime, memory, queries, answerMs, zones, blocking, cache, queryLog }, each a function
function collect(sources, { now = Date.now(), source }) {
    const points = [];
    const add = (name, value, { type = 'gauge', unit, labels } = {}) => {
        if (typeof value === 'boolean') value = value ? 1 : 0;
        if (typeof value !== 'number' || !Number.isFinite(value)) return;
        points.push({ name, value, type, ...(unit && { unit }), time: now, source, ...(labels && { labels }) });
    };

    add('aesir.up', 1);
    add('aesir.uptime', sources.uptime(), { unit: 's' });
    add('aesir.memory.rss', sources.memory(), { unit: 'B' });

    const queries = sources.queries();
    for (const kind of KINDS) add('aesir.dns.queries', queries[kind], { type: 'counter', labels: { kind } });
    add('aesir.dns.answer_time', sources.answerMs(), { unit: 'ms' });

    const zones = sources.zones();
    add('aesir.zones', zones.zones);
    add('aesir.zones.records', zones.records);
    add('aesir.zones.standalone_records', zones.standalone);
    add('aesir.zones.failing', Boolean(zones.failing));

    const blocking = sources.blocking();
    add('aesir.blocking.enabled', blocking.enabled);
    add('aesir.blocking.lists', blocking.lists);
    add('aesir.blocking.names', blocking.names);
    add('aesir.blocking.rules', blocking.rules);
    add('aesir.blocking.failing', Boolean(blocking.failing));

    const cache = sources.cache();
    add('aesir.cache.entries', cache.entries);
    add('aesir.cache.max_entries', cache.max);

    const log = sources.queryLog();
    add('aesir.querylog.recorded', log.recorded, { type: 'counter' });
    add('aesir.querylog.dropped', log.dropped, { type: 'counter' });
    add('aesir.querylog.failing', Boolean(log.failing));

    return points;
}

// The problems that are worth a log line when they start and when they end: name -> text, or null when fine
function problems(sources) {
    const zones = sources.zones();
    const blocking = sources.blocking();
    const log = sources.queryLog();
    return {
        zones: zones.failing ? 'The zones could not be read from the database' : null,
        blocking: blocking.failing ? 'The block lists could not be loaded' : null,
        queryLog: log.failing ? 'The query log could not be written' : null,
    };
}

// The real sources: the services of this server
function serverSources() {
    const statusService = require('../../../services/serverService/statusService');
    const zoneService = require('../../../services/serverService/zoneService');
    const blockService = require('../../../services/serverService/blockService');
    const queryLogService = require('../../../services/serverService/queryLogService');
    const searchService = require('../../../services/serverService/searchService');
    const config = require('../../../config/config');
    return {
        uptime: () => Math.round(process.uptime()),
        memory: () => process.memoryUsage().rss,
        queries: () => statusService.queries,
        // The average time of an answer in the last samples; nothing when there was no query
        answerMs: () => statusService.history('15m').ms.filter((ms) => ms !== null).at(-1),
        zones: () => zoneService.state(),
        blocking: () => blockService.state(),
        cache: () => ({ entries: searchService.cacheSize(), max: config.nsCacheMaxEntries }),
        queryLog: () => queryLogService.state(),
    };
}

module.exports = { collect, problems, serverSources, KINDS };
