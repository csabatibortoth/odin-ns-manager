// What the DNS server has done since it was started, for the dashboard: the
// counters of the queries, and their history.
//
// The history is kept in memory, in two resolutions: a sample every
// SAMPLE_SECONDS for the last hour, and one for every minute of the last day.
const SAMPLE_SECONDS = 10;
const SAMPLES_PER_MINUTE = 60 / SAMPLE_SECONDS;
const RECENT_SAMPLES = 3600 / SAMPLE_SECONDS;
const MINUTE_SAMPLES = 24 * 60;

// What the history can be asked for: the length in seconds, and the samples it is answered from
const RANGES = {
    '15m': { seconds: 900, minutes: false },
    '1h': { seconds: 3600, minutes: false },
    '6h': { seconds: 6 * 3600, minutes: true },
    '24h': { seconds: 24 * 3600, minutes: true },
};

const KINDS = ['zones', 'records', 'forwarded', 'failed'];

const startedAt = new Date();
const queries = { total: 0, zones: 0, records: 0, forwarded: 0, failed: 0 };

// Since the last sample
let window = newWindow();
let minute = newWindow();
let minuteSamples = 0;
const recent = []; // samples of SAMPLE_SECONDS
const minutes = []; // samples of a minute
let timer = null;

function newWindow() {
    return { zones: 0, records: 0, forwarded: 0, failed: 0, timed: 0, ms: 0 };
}

// kind: 'zones' or 'records' (answered from our own zones or standalone
// records), 'forwarded' or 'failed'. ms: how long the answer took.
function countQuery(kind, ms) {
    queries.total++;
    queries[kind]++;
    window[kind]++;
    if (ms !== undefined) {
        window.timed++;
        window.ms += ms;
    }
}

function push(list, sample, max) {
    list.push(sample);
    if (list.length > max) list.shift();
}

// Closes the window: gauges is what is measured at this moment, { memory, cache }
function sample(gauges = {}, now = Date.now()) {
    push(recent, { t: now, ...window, ...gauges }, RECENT_SAMPLES);

    // A minute is the sum of its samples, with the last of what is measured
    for (const key of Object.keys(window)) minute[key] += window[key];
    window = newWindow();
    if (++minuteSamples === SAMPLES_PER_MINUTE) {
        push(minutes, { t: now, ...minute, ...gauges }, MINUTE_SAMPLES);
        minute = newWindow();
        minuteSamples = 0;
    }
}

// Takes a sample every SAMPLE_SECONDS; measure() returns the gauges
function start(measure) {
    if (!timer) timer = setInterval(() => sample(measure()), SAMPLE_SECONDS * 1000).unref();
}

function stop() {
    clearInterval(timer);
    timer = null;
}

// The history of a range, as columns: one value for every sample.
// The counts are per sample of `step` seconds; ms is the average time of an
// answer, null when nothing was answered.
function history(range = '1h', now = Date.now()) {
    const { seconds, minutes: byMinute } = RANGES[range];
    const from = now - seconds * 1000;
    const samples = (byMinute ? minutes : recent).filter((entry) => entry.t >= from);

    const column = (pick) => samples.map(pick);
    return {
        range,
        step: byMinute ? 60 : SAMPLE_SECONDS,
        from,
        to: now,
        t: column((entry) => entry.t),
        ...Object.fromEntries(KINDS.map((kind) => [kind, column((entry) => entry[kind])])),
        ms: column((entry) => (entry.timed ? Math.round((entry.ms / entry.timed) * 100) / 100 : null)),
        memory: column((entry) => entry.memory ?? null),
        cache: column((entry) => entry.cache ?? null),
    };
}

module.exports = { startedAt, queries, countQuery, sample, start, stop, history, RANGES: Object.keys(RANGES) };
