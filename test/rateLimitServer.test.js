// The real server process asked over UDP and TCP: identical answers to one client network are limited and slip, other names
// and TCP are not, REFUSED floods are limited, the machine itself and the resolver clients are not, big answers are cut to a
// TRUNCATED one for UDP. Needs MongoDB on 127.0.0.1:27017 (or ODIN_TEST_MONGO); without it the tests are skipped.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const dgram = require('node:dgram');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const mongoose = require('mongoose');

const ROOT = path.resolve(__dirname, '..');
const MONGO = process.env.ODIN_TEST_MONGO || 'mongodb://127.0.0.1:27017';
const DB = `odin_test_ratelimit_${process.pid}`;
const soa = { host: 'ns1.example.test', admin: 'hostmaster.example.test', serial: 1, refresh: 3600, retry: 600, expire: 604800, ttl: 3600 };
const TYPES = { A: 1, TXT: 16 };

let up = false;
const servers = [];
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'odin-ratelimit-'));

const freePort = () => new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
    });
});

async function start(name, extra) {
    const dns = await freePort();
    const http = await freePort();
    const dir = path.join(folder, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('ODIN_') || key.startsWith('FREYA_')) delete env[key];
    Object.assign(env, {
        ODIN_SETTINGS_FILE: path.join(dir, 'settings.json'), ODIN_LOG_FOLDER: dir, ODIN_DB_ADDRESS: '127.0.0.1', ODIN_DB_NAME: DB, ODIN_DB_USER: '', ODIN_DB_PWD: '',
        ODIN_NS_PORT: String(dns), ODIN_NS_ADDRESS: '127.0.0.1', ODIN_HTTP_PORT: String(http), ODIN_AUTH_ENABLED: 'false', ODIN_DOCS_ENABLED: 'false',
        ODIN_NS_ZONE_REFRESH: '1', ODIN_NS_UPSTREAM: '127.0.0.1:9', ODIN_NS_QUERY_LOG_ENABLED: 'false', ...extra,
    });
    const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
    servers.push(child);
    for (let i = 0; i < 80; i++) {
        if (await fetch(`http://127.0.0.1:${http}/api/service/status`).then((r) => r.ok).catch(() => false)) return { dns, http };
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`the server ${name} did not start`);
}

function question(name, type, edns) {
    const labels = name.split('.').flatMap((label) => [Buffer.from([label.length]), Buffer.from(label)]);
    const parts = [Buffer.from([0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, edns ? 1 : 0]), ...labels, Buffer.from([0, 0, TYPES[type], 0, 1])];
    if (edns) {
        const opt = Buffer.alloc(11);
        opt.writeUInt16BE(41, 1); opt.writeUInt16BE(edns, 3);
        parts.push(opt);
    }
    return Buffer.concat(parts);
}
const summary = (message) => ({ rcode: message[3] & 0x0f, tc: Boolean(message[2] & 0x02), answers: message.readUInt16BE(6), size: message.length });

// One UDP question from a chosen local address; resolves with the summary, or null when nothing came back in `wait` ms
function ask(dns, name, { type = 'A', from = '127.0.0.2', edns, wait = 400 } = {}) {
    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        const timer = setTimeout(() => { socket.close(); resolve(null); }, wait);
        socket.on('message', (message) => { clearTimeout(timer); socket.close(); resolve(summary(message)); });
        socket.bind(0, from, () => socket.send(question(name, type, edns), dns, '127.0.0.1'));
    });
}

// n questions at the same moment (so that the clock gives no tokens back while they are counted)
const burst = (dns, names, options) => Promise.all(names.map((name) => ask(dns, name, { wait: 800, ...options })));

function askTcp(dns, name, type = 'A') {
    return new Promise((resolve, reject) => {
        const packet = question(name, type);
        const socket = net.connect({ host: '127.0.0.1', port: dns, localAddress: '127.0.0.2' });
        const chunks = [];
        socket.on('connect', () => socket.write(Buffer.concat([Buffer.from([packet.length >> 8, packet.length & 255]), packet])));
        socket.on('data', (data) => {
            chunks.push(data);
            const all = Buffer.concat(chunks);
            if (all.length >= 2 && all.length >= 2 + all.readUInt16BE(0)) { socket.destroy(); resolve(summary(all.subarray(2, 2 + all.readUInt16BE(0)))); }
        });
        socket.on('error', reject);
        setTimeout(() => { socket.destroy(); reject(new Error('no TCP answer')); }, 4000);
    });
}

before(async () => {
    try {
        await mongoose.connect(`${MONGO}/${DB}`, { serverSelectionTimeoutMS: 1500 });
        up = true;
    } catch {
        return;
    }
    const db = mongoose.connection;
    const zone = await db.collection('zones').insertOne({ name: 'example.test', ttl: 300, active: true, soa, createdAt: new Date(), updatedAt: new Date() });
    const record = (name, type, data) => ({ zone: zone.insertedId, name, type, ttl: null, data, active: true, createdAt: new Date(), updatedAt: new Date() });
    await db.collection('records').insertMany([
        record('www.example.test', 'A', { target: '192.0.2.10' }),
        record('other.example.test', 'A', { target: '192.0.2.11' }),
        ...[1, 2, 3].map((n) => record('big.example.test', 'TXT', { target: `${n}`.repeat(200) })),
    ]);
});

after(async () => {
    for (const child of servers) child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (up) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    fs.rmSync(folder, { recursive: true, force: true });
});

const withDb = (name, fn) => test(name, async (ctx) => {
    if (!up) return ctx.skip('no MongoDB');
    await fn();
});

// 127.0.0.2 is "somebody else" to the server; the resolver list is set so that this client is NOT one of its own
const STRANGER = { ODIN_NS_RECURSION_ALLOWED: '203.0.113.0/24', ODIN_NS_RATE_LIMIT_PER_SECOND: '5', ODIN_NS_RATE_LIMIT_SLIP: '2' };

withDb('the same answer to one network is limited after the burst: dropped, and every second one is a short "ask over TCP"; other names, other types and TCP are not', async () => {
    const { dns, http } = await start('limit', STRANGER);
    const results = await burst(dns, Array(20).fill('www.example.test'));
    const answered = results.filter((r) => r && !r.tc);
    const slipped = results.filter((r) => r?.tc);
    const silent = results.filter((r) => r === null);
    assert.ok(answered.length >= 5 && answered.length <= 8, `the burst (5) plus what the clock gave back: ${answered.length}`);
    assert.ok(answered.every((r) => r.rcode === 0 && r.answers === 1));
    assert.ok(slipped.length >= 5, `slipped: ${slipped.length}`);
    assert.ok(slipped.every((r) => r.answers === 0 && r.rcode === 0 && r.size < 60), 'a slip is tiny: nothing to reflect');
    assert.ok(silent.length >= 5, `dropped: ${silent.length}`);
    assert.equal(answered.length + slipped.length + silent.length, 20);

    assert.deepEqual((await ask(dns, 'other.example.test'))?.answers, 1, 'another name is not limited');
    assert.deepEqual(await askTcp(dns, 'www.example.test'), { rcode: 0, tc: false, answers: 1, size: (await askTcp(dns, 'www.example.test')).size }, 'TCP is never limited');
    const status = await (await fetch(`http://127.0.0.1:${http}/api/service/status`)).json();
    assert.equal(status.dns.queries.limited, slipped.length + silent.length);
    assert.equal(status.dns.rateLimit.dropped + status.dns.rateLimit.slipped, status.dns.queries.limited);
    assert.equal(status.dns.rateLimit.slipped >= slipped.length - 0, true);
});

withDb('random names below a zone share one counter; REFUSED answers are limited per network', async () => {
    const { dns } = await start('nxrefused', STRANGER);
    const nx = await burst(dns, Array.from({ length: 15 }, (_, i) => `random${i}.example.test`));
    assert.equal(nx.filter((r) => r && r.rcode === 3).length >= 5, true, 'the first ones are answered: no such name');
    assert.equal(nx.filter((r) => r === null || r.tc).length >= 5, true, `limited: ${nx.filter((r) => r === null || r.tc).length}`);
    const refused = await burst(dns, Array.from({ length: 15 }, (_, i) => `name${i}.example.org`));
    assert.equal(refused.filter((r) => r?.rcode === 5).length >= 5, true);
    assert.equal(refused.filter((r) => r === null || r.tc).length >= 5, true, 'a REFUSED flood is limited too');
});

withDb('the machine itself and (by default) the clients of the resolver list are not limited; switching the trust off limits them', async () => {
    const own = await start('own', STRANGER);
    assert.ok((await burst(own.dns, Array(25).fill('www.example.test'), { from: '127.0.0.1', wait: 1500 })).every((r) => r?.answers === 1), 'own address: all 25 answered');

    const trusted = await start('trusted', { ODIN_NS_RATE_LIMIT_PER_SECOND: '5' }); // loopback is on the default resolver list
    assert.ok((await burst(trusted.dns, Array(25).fill('www.example.test'), { wait: 1500 })).every((r) => r?.answers === 1), 'resolver client: all 25 answered');

    const untrusting = await start('untrusting', { ODIN_NS_RATE_LIMIT_PER_SECOND: '5', ODIN_NS_RATE_LIMIT_TRUST_RESOLVERS: 'false' });
    const results = await burst(untrusting.dns, Array(25).fill('www.example.test'));
    assert.equal(results.filter((r) => r === null || r.tc).length >= 8, true);
    // trust off: the machine itself is still not limited
    assert.ok((await burst(untrusting.dns, Array(25).fill('www.example.test'), { from: '127.0.0.1', wait: 1500 })).every((r) => r?.answers === 1), 'own address with trust off');

    const off = await start('off', { ...STRANGER, ODIN_NS_RATE_LIMIT_ENABLED: 'false' });
    assert.ok((await burst(off.dns, Array(25).fill('www.example.test'), { wait: 1500 })).every((r) => r?.answers === 1), 'limit off: all 25 answered');
});

withDb('a big answer: truncated over UDP without EDNS0 (512 bytes), whole with EDNS0 1232 and over TCP; a tiny answer is untouched', async () => {
    const { dns, http } = await start('size', { ODIN_NS_RATE_LIMIT_ENABLED: 'false', ODIN_NS_RECURSION_ALLOWED: '203.0.113.0/24' });
    const plain = await ask(dns, 'big.example.test', { type: 'TXT' });
    assert.deepEqual([plain.tc, plain.answers, plain.rcode], [true, 0, 0]);
    assert.ok(plain.size < 60);
    const edns = await ask(dns, 'big.example.test', { type: 'TXT', edns: 4096 });
    assert.equal(edns.tc, false);
    assert.equal(edns.answers, 3);
    assert.ok(edns.size > 600 && edns.size <= 1232);
    const small = await ask(dns, 'big.example.test', { type: 'TXT', edns: 600 }); // announces 600: 512 is the floor, the answer is ~700
    assert.equal(small.tc, true);
    const tcp = await askTcp(dns, 'big.example.test', 'TXT');
    assert.deepEqual([tcp.tc, tcp.answers], [false, 3]);
    assert.equal((await ask(dns, 'www.example.test')).answers, 1);
    const status = await (await fetch(`http://127.0.0.1:${http}/api/service/status`)).json();
    assert.equal(status.dns.rateLimit.truncated, 2);
});

withDb('a packet that is cut off or built to confuse does not hang the server', async () => {
    const { dns } = await start('junk', STRANGER);
    const send = (buffer) => new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        socket.send(buffer, dns, '127.0.0.1', () => { socket.close(); resolve(); });
    });
    const base = question('www.example.test', 'A', 4096);
    for (let cut = 12; cut < base.length; cut += 3) await send(base.subarray(0, cut));
    const loop = Buffer.concat([Buffer.from([0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 5]), Buffer.from([0xc0, 12, 0, 1, 0, 1]), Buffer.alloc(40, 0xc0)]);
    await send(loop);
    assert.equal((await ask(dns, 'other.example.test', { from: '127.0.0.3', wait: 2000 }))?.answers, 1, 'the server still answers');
});
