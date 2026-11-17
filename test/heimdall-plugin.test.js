// The heimdall plugin: the settings, what is measured, and the delivery to a (fake) Heimdall.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, afterEach, before, test } = require('node:test');

for (const name of Object.keys(process.env)) if (name.startsWith('ODIN_') || name.startsWith('HEIMDALL_')) delete process.env[name];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odin-heimdall-'));
process.env.ODIN_SETTINGS_FILE = path.join(root, 'settings.json');
process.env.ODIN_PLUGINS_FOLDER = path.resolve(__dirname, '../plugins');
process.env.ODIN_PLUGINS_ENABLED = 'heimdall';

const { createSettings, checkUrl } = require('../plugins/heimdall/lib/settings');
const { collect, problems } = require('../plugins/heimdall/lib/collect');
const { createReporter } = require('../plugins/heimdall/lib/reporter');
const { MAX_BATCH } = require('../plugins/heimdall/lib/sender');

// The rules of Heimdall for the name of a metric and of a label (core/src/metrics.js)
const METRIC_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const LABEL_KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

const folder = (name) => fs.mkdtempSync(path.join(root, `${name}-`));

// A Heimdall that remembers what it was sent, and answers what the test says
let heimdall;
let requests;
let answer;
let base;
before(async () => {
    heimdall = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            requests.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString() || 'null') });
            const next = answer(req);
            res.writeHead(next.status, next.headers || {});
            res.end(next.status === 202 ? '{"accepted":1,"dropped":0}' : '{}');
        });
    });
    await new Promise((resolve) => heimdall.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${heimdall.address().port}`;
});
after(() => {
    heimdall.close();
    fs.rmSync(root, { recursive: true, force: true });
});
afterEach(() => {
    requests = [];
    answer = () => ({ status: 202 });
});
requests = [];
answer = () => ({ status: 202 });

const sources = (over = {}) => ({
    uptime: () => 120,
    memory: () => 50_000_000,
    queries: () => ({ total: 10, zones: 4, records: 1, blocked: 2, forwarded: 3, failed: 0 }),
    answerMs: () => 1.5,
    zones: () => ({ zones: 2, records: 7, standalone: 1, failing: false }),
    blocking: () => ({ enabled: true, lists: 1, names: 1000, rules: 3, failing: false }),
    cache: () => ({ entries: 40, max: 5000 }),
    queryLog: () => ({ recorded: 9, dropped: 0, failing: false }),
    ...over,
});

const api = () => ({
    dataFolder: folder('data'),
    server: { name: 'odin', version: '2.6.0' },
    log: { info() {}, error() {} },
});

const connected = { url: undefined, agentUid: 'agent-1234', licenseKey: 'key-0123456789' };
function reporterFor(over = {}) {
    const instance = createReporter({ api: api(), sources: sources(over.sources), env: over.env || {}, now: over.now });
    instance.settings.update({ ...connected, url: base, ...(over.settings || {}) });
    return instance;
}

test('the address must be https, or http for this machine only', () => {
    assert.equal(checkUrl('https://heimdall.example.com', false), 'https://heimdall.example.com');
    assert.equal(checkUrl('http://127.0.0.1:3000', false), 'http://127.0.0.1:3000');
    assert.equal(checkUrl('http://localhost', false), 'http://localhost');
    assert.throws(() => checkUrl('http://heimdall.example.com', false), /only for this machine/);
    assert.equal(checkUrl('http://heimdall.example.com', true), 'http://heimdall.example.com');
    assert.throws(() => checkUrl('ftp://heimdall.example.com', false), /https/);
    assert.throws(() => checkUrl('https://user:secret@heimdall.example.com', false), /user name/);
    assert.throws(() => checkUrl('https://heimdall.example.com/v1', false), /without a path/);
    assert.throws(() => checkUrl('not a url', false), /not a URL/);
});

test('the settings are checked, and the license key never comes back out', () => {
    const settings = createSettings(folder('settings'), {});
    assert.equal(settings.configured(), false);

    assert.throws(() => settings.update({ url: 'https://h.example.com', agentUid: 'a b', licenseKey: 'key-0123456789' }), /agent UID/);
    assert.throws(() => settings.update({ intervalSeconds: 5 }), /between 10 and 3600/);
    assert.throws(() => settings.update({ source: 'bad name!' }), /letters, digits/);
    assert.throws(() => settings.update({ licenseKey: 'short' }), /license key/);

    const described = settings.update({ url: 'https://h.example.com', agentUid: 'agent-1234', licenseKey: 'key-0123456789', intervalSeconds: 30 });
    assert.equal(settings.configured(), true);
    assert.equal(described.licenseKeySet, true);
    assert.equal(JSON.stringify(described).includes('key-0123456789'), false);

    // An empty key keeps the one that is there
    settings.update({ licenseKey: '', source: 'dns-1' });
    assert.equal(settings.get().licenseKey, 'key-0123456789');
    assert.equal(settings.get().source, 'dns-1');

    // Turning http off again refuses an address that needed it
    settings.update({ url: 'http://heimdall.example.com', allowInsecure: true });
    assert.throws(() => settings.update({ allowInsecure: false }), /only for this machine/);
});

test('the settings are written for the owner only, and read again after a restart', () => {
    const dir = folder('persist');
    createSettings(dir, {}).update({ url: 'https://h.example.com', agentUid: 'agent-1234', licenseKey: 'key-0123456789' });
    const file = path.join(dir, 'settings.json');
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(createSettings(dir, {}).configured(), true);
    assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
});

test('the environment wins over the file, and can not be changed in the interface', () => {
    const settings = createSettings(folder('env'), { HEIMDALL_URL: 'https://env.example.com', HEIMDALL_AGENT_UID: 'env-agent', HEIMDALL_LICENSE_KEY: 'env-key-0123456789' });
    assert.equal(settings.configured(), true);
    assert.equal(settings.get().url, 'https://env.example.com');
    assert.deepEqual(settings.describe().fromEnvironment.sort(), ['agentUid', 'licenseKey', 'url']);
    assert.throws(() => settings.update({ url: 'https://other.example.com' }), /HEIMDALL_URL/);
    // What the page sends back unchanged is no change
    assert.doesNotThrow(() => settings.update({ intervalSeconds: 120 }));
});

test('every metric has a name and labels that Heimdall accepts, and counters are marked', () => {
    const points = collect(sources(), { now: 1_000, source: 'dns-1' });
    assert.ok(points.length > 15);
    for (const point of points) {
        assert.match(point.name, METRIC_NAME);
        assert.equal(typeof point.value, 'number');
        assert.ok(['gauge', 'counter'].includes(point.type));
        assert.equal(point.source, 'dns-1');
        for (const [key, value] of Object.entries(point.labels || {})) {
            assert.match(key, LABEL_KEY);
            assert.equal(typeof value, 'string');
        }
    }
    const queries = points.filter((point) => point.name === 'aesir.dns.queries');
    assert.deepEqual(queries.map((point) => point.labels.kind), ['total', 'zones', 'records', 'blocked', 'forwarded', 'failed']);
    assert.ok(queries.every((point) => point.type === 'counter'));
    assert.equal(points.find((point) => point.name === 'aesir.blocking.enabled').value, 1);
});

test('what is missing is left out, not sent as zero', () => {
    const points = collect(sources({ answerMs: () => undefined }), { now: 1, source: 'x' });
    assert.equal(points.some((point) => point.name === 'aesir.dns.answer_time'), false);
});

test('a metric round reaches Heimdall with the credentials of the agent', async () => {
    const reporter = reporterFor({ settings: { source: 'dns-1' } });
    await reporter.tick({ force: true });

    const metrics = requests.find((request) => request.url === '/v1/ingest/metrics');
    assert.ok(metrics, 'metrics were sent');
    assert.equal(metrics.headers['x-agent-uid'], 'agent-1234');
    assert.equal(metrics.headers['x-license-key'], 'key-0123456789');
    assert.equal(metrics.headers['content-type'], 'application/json');
    assert.ok(metrics.body.metrics.length > 15);
    assert.equal(metrics.body.metrics[0].source, 'dns-1');

    const status = reporter.status();
    assert.equal(status.state, 'reporting');
    assert.equal(status.queued, 0);
    assert.equal(status.lastError, null);
    assert.equal(JSON.stringify(status).includes('key-0123456789'), false);
});

test('nothing is measured or sent while the plugin is not set up', async () => {
    const reporter = createReporter({ api: api(), sources: sources(), env: {} });
    await reporter.tick({ force: true });
    assert.equal(requests.length, 0);
    assert.equal(reporter.status().state, 'unconfigured');
});

test('the interval decides when the next round is measured', async () => {
    let clock = 1_000_000;
    const reporter = reporterFor({ now: () => clock, settings: { intervalSeconds: 60 } });
    await reporter.tick();
    const first = requests.filter((request) => request.url.endsWith('/metrics')).length;
    assert.equal(first, 1);
    clock += 30_000;
    await reporter.tick();
    assert.equal(requests.filter((request) => request.url.endsWith('/metrics')).length, 1);
    clock += 31_000;
    await reporter.tick();
    assert.equal(requests.filter((request) => request.url.endsWith('/metrics')).length, 2);
});

test('changes and failures are logged once, as JSON log records, and the names that clients asked are not part of them', async () => {
    let failing = false;
    const reporter = reporterFor({ sources: { zones: () => ({ zones: 1, records: 1, standalone: 0, failing }) } });
    await reporter.tick({ force: true });
    requests.length = 0;

    reporter.onDnsChange();
    reporter.onDnsChange();
    reporter.onSync();
    await reporter.tick({ force: true });
    failing = true;
    await reporter.tick({ force: true });
    await reporter.tick({ force: true }); // still failing: not told again
    failing = false;
    await reporter.tick({ force: true });

    const records = requests.filter((request) => request.url === '/v1/ingest/json').flatMap((request) => request.body);
    const events = records.map((record) => `${record.level}:${record.event}`);
    assert.deepEqual(events, ['info:dnsChange', 'info:sync', 'error:problem', 'info:recovered']);
    assert.equal(records[0].count, 2);
    assert.equal(records[0].app, 'odin-ns-manager');
    assert.equal(records[0].service, records[0].hostname.replace(/[^A-Za-z0-9_.:-]/g, '-'));
    assert.match(records[2].message, /zones could not be read/);
});

test('logs can be switched off, the metrics go on', async () => {
    const reporter = reporterFor({ settings: { sendLogs: false } });
    reporter.onDnsChange();
    await reporter.tick({ force: true });
    assert.equal(requests.some((request) => request.url.endsWith('/json')), false);
    assert.equal(requests.some((request) => request.url.endsWith('/metrics')), true);
});

test('a wrong key is reported, kept for later and tried again after a pause', async () => {
    let clock = 5_000_000;
    answer = () => ({ status: 401 });
    const reporter = reporterFor({ now: () => clock });
    await reporter.tick({ force: true });

    let status = reporter.status();
    assert.equal(status.state, 'failing');
    assert.match(status.lastError, /license key is wrong/);
    assert.ok(status.queued > 0);
    const attempts = requests.length;

    // Inside the pause nothing is sent
    clock += 1_000;
    await reporter.tick();
    assert.equal(requests.length, attempts);

    // After it, and with a right key now, what waited is delivered
    answer = () => ({ status: 202 });
    clock += 60_000;
    await reporter.tick();
    status = reporter.status();
    assert.equal(status.state, 'reporting');
    assert.equal(status.queued, 0);
});

test('a batch that Heimdall refuses for good is dropped, not repeated', async () => {
    answer = () => ({ status: 400 });
    const reporter = reporterFor();
    await reporter.tick({ force: true });
    const status = reporter.status();
    assert.equal(status.queued, 0);
    assert.ok(status.dropped > 0);
    assert.match(status.lastError, /refused/);
});

test('a redirect is never followed: the key does not go to another address', async () => {
    const other = http.createServer((req, res) => {
        other.hits = (other.hits || 0) + 1;
        res.writeHead(202).end();
    });
    await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve));
    try {
        answer = () => ({ status: 307, headers: { location: `http://127.0.0.1:${other.address().port}/v1/ingest/metrics` } });
        const reporter = reporterFor();
        await reporter.tick({ force: true });
        assert.equal(other.hits || 0, 0);
        assert.equal(reporter.status().state, 'failing');
    } finally {
        other.close();
    }
});

test('an unreachable Heimdall is a failure, not a crash', async () => {
    const reporter = reporterFor({ settings: { url: 'http://127.0.0.1:1' } });
    await assert.doesNotReject(reporter.tick({ force: true }));
    assert.equal(reporter.status().state, 'failing');
    assert.match(reporter.status().lastError, /can not be reached/);
});

test('large rounds are sent in batches that Heimdall accepts, and only so much waits', async () => {
    answer = () => ({ status: 503 });
    const reporter = reporterFor();
    const big = Array.from({ length: MAX_BATCH * 2 + 1 }, (_, i) => ({ name: 'aesir.x', value: i }));
    reporter.sender.enqueue('metrics', big);
    assert.equal(reporter.sender.state().queued, big.length);
    answer = () => ({ status: 202 });
    await reporter.sender.flush({ force: true });
    const sizes = requests.map((request) => request.body.metrics.length);
    assert.deepEqual(sizes, [MAX_BATCH, MAX_BATCH, 1]);

    // A server that is away for a long time does not make the memory grow without end
    for (let i = 0; i < 300; i += 1) reporter.sender.enqueue('metrics', [{ name: 'aesir.x', value: i }].concat(Array(MAX_BATCH - 1).fill({ name: 'aesir.x', value: 0 })));
    assert.ok(reporter.sender.state().queued <= 200 * MAX_BATCH);
    assert.ok(reporter.sender.state().dropped > 0);
});

test('the problems of the parts are named', () => {
    const found = problems(sources({ blocking: () => ({ failing: true }), queryLog: () => ({ failing: true }) }));
    assert.equal(found.zones, null);
    assert.match(found.blocking, /block lists/);
    assert.match(found.queryLog, /query log/);
});

test('the plugin is described right for the plugin loader', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../plugins/heimdall/plugin.json'), 'utf8'));
    assert.equal(manifest.name, 'heimdall');
    assert.deepEqual(manifest.roles, ['admin']);
    assert.ok(fs.existsSync(path.join(__dirname, '../plugins/heimdall/public', manifest.ui.script)));
    assert.equal(typeof require('../plugins/heimdall').activate, 'function');
});
