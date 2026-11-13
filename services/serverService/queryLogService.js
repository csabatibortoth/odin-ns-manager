// Reports the queries the DNS server answered to the monitoring of
// freya-ns-api, which keeps the query log, the clients and the hourly metrics.
//
// - A query is noted in memory, and never waits for the database.
// - The notes are written every FLUSH_SECONDS, many at a time.
// - While the database can not be written, the newest MAX_WAITING are kept.
const net = require('net');
const config = require('../../config/config');

const FLUSH_SECONDS = 5;
const BATCH = 5000; // the most the monitoring takes at once
const MAX_WAITING = 50000;

const STATUSES = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };
const NAME = /^[\x21-\x7e]{1,255}$/;
const TYPE = /^[A-Z0-9]{1,16}$/;

let waiting = [];
let timer = null;
let writing = null;
let failing = false;
let recorded = 0;
let dropped = 0;

// Required late: see apiService
const logs = () => require('../apiService/apiService').logService;
const monitoring = () => {
    require('../apiService/apiService');
    return require('freya-ns-api/services/monitoringService/monitoringService');
};

// query: the answered query of the server; blocked: by the blocking; ms: how long the answer took.
// What the monitoring would refuse is left out here, as it refuses a batch as a whole.
function note(query, { blocked = false, ms, failed = false } = {}) {
    if (!timer || !config.nsQueryLogEnabled) return;

    const client = query._client?.address;
    const name = (query.name() || '.').toLowerCase();
    const type = String(query.type() || '').toUpperCase();
    if (!net.isIP(String(client).replace(/^::ffff:/i, '')) || !NAME.test(name) || !TYPE.test(type)) return;

    if (waiting.length >= MAX_WAITING) {
        waiting.shift();
        dropped++;
    }
    waiting.push({
        time: new Date(),
        client,
        name,
        type,
        status: failed ? 'SERVFAIL' : STATUSES[query._flags.rcode] || 'SERVFAIL',
        blocked,
        durationMs: Number.isFinite(ms) ? Math.round(ms * 100) / 100 : null,
    });
}

// Writes what is waiting. Never rejects: what could not be written waits for the next time.
function flush() {
    writing ??= (async () => {
        while (waiting.length) {
            const batch = waiting.slice(0, BATCH);
            try {
                await monitoring().recordQueries({ queries: batch });
                failing = false;
            } catch (err) {
                // A batch the monitoring refuses can not be written later either
                if (err.status === 400) {
                    logs().addErrorLogErrorEntry('Queries were refused by the monitoring: ', JSON.stringify(err.details || err.message));
                } else {
                    if (!failing) logs().addErrorLogErrorEntry('Queries could not be recorded: ', err.stack || err);
                    failing = true;
                    return;
                }
            }
            // The oldest ones may have been dropped meanwhile; the batch is at the start otherwise
            waiting = waiting[0] === batch[0] ? waiting.slice(batch.length) : waiting.filter((entry) => !batch.includes(entry));
            if (!failing) recorded += batch.length;
        }
    })().finally(() => {
        writing = null;
    });
    return writing;
}

// The database has to be connected already
function start() {
    if (!timer) timer = setInterval(flush, FLUSH_SECONDS * 1000).unref();
}

async function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    await flush();
}

module.exports = {
    note,
    flush,
    start,
    stop,
    state: () => ({ enabled: config.nsQueryLogEnabled, watching: timer !== null, failing, waiting: waiting.length, recorded, dropped }),
};
