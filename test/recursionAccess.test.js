// The real server process, asked over UDP like any client: a client outside the list gets REFUSED for names that
// are not ours and still gets the answers of our own zones; the default (loopback) lets the same client through.
// Needs MongoDB on 127.0.0.1:27017 (or ODIN_TEST_MONGO); without it the tests are skipped. A database of its own is dropped afterwards.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const dgram = require('node:dgram');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { Resolver } = require('node:dns').promises;
const { after, before, test } = require('node:test');

const mongoose = require('mongoose');

const ROOT = path.resolve(__dirname, '..');
const MONGO = process.env.ODIN_TEST_MONGO || 'mongodb://127.0.0.1:27017';
const DB = `odin_test_access_${process.pid}`;
const soa = { host: 'ns1.example.test', admin: 'hostmaster.example.test', serial: 1, refresh: 3600, retry: 600, expire: 604800, ttl: 3600 };

let up = false;
const servers = [];
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'odin-recursion-'));

const freePort = () =>
    new Promise((resolve) => {
        const probe = net.createServer().listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });

// Starts server.js with its own settings and ports; resolves when the API answers (zones are loaded by then)
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

// A DNS question sent from a chosen local address (127.0.0.2 is not an address of this machine to the server, so it is
// "somebody else"); returns the response code and the number of answers.
function ask(dns, name, type = 'A', from = '127.0.0.2') {
    const TYPES = { A: 1, MX: 15 };
    const labels = name.split('.').flatMap((label) => [Buffer.from([label.length]), Buffer.from(label)]);
    const packet = Buffer.concat([
        Buffer.from([0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]), ...labels, Buffer.from([0, 0, TYPES[type], 0, 1]),
    ]);
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4');
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error(`no answer for ${name} from ${from}`));
        }, 4000);
        socket.on('message', (message) => {
            clearTimeout(timer);
            socket.close();
            resolve({ rcode: message[3] & 0x0f, answers: message.readUInt16BE(6) });
        });
        socket.bind(0, from, () => socket.send(packet, dns, '127.0.0.1'));
    });
}
const REFUSED = 5;
const NXDOMAIN = 3;

before(async () => {
    try {
        await mongoose.connect(`${MONGO}/${DB}`, { serverSelectionTimeoutMS: 1500 });
        up = true;
    } catch {
        return;
    }
    const zone = await mongoose.connection.collection('zones').insertOne({ name: 'example.test', ttl: 300, active: true, soa, createdAt: new Date(), updatedAt: new Date() });
    await mongoose.connection.collection('records').insertOne({ zone: zone.insertedId, name: 'www.example.test', type: 'A', ttl: null, data: { target: '192.0.2.10' }, active: true, createdAt: new Date(), updatedAt: new Date() });
});

after(async () => {
    for (const child of servers) child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (up) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    fs.rmSync(folder, { recursive: true, force: true });
});

const withDb = (name, fn) =>
    test(name, async (ctx) => {
        if (!up) return ctx.skip('no MongoDB');
        await fn();
    });

withDb('a client outside the list: REFUSED for foreign names, our own zones answered, counted and listed', async () => {
    // 127.0.0.2 is not in the list: it is "somebody on the internet"
    const { dns, http } = await start('closed', { ODIN_NS_RECURSION_ALLOWED: '203.0.113.0/24' });

    assert.deepEqual(await ask(dns, 'www.example.test'), { rcode: 0, answers: 1 }, 'an own name is answered for anybody');
    assert.equal((await ask(dns, 'www.example.org')).rcode, REFUSED);
    assert.equal((await ask(dns, 'example.com', 'MX')).rcode, REFUSED);
    // a name below our zone that does not exist is OUR answer (NXDOMAIN), not a refusal
    assert.equal((await ask(dns, 'nothing.example.test')).rcode, NXDOMAIN);
    // the machine itself is never refused (the lookup of the user interface asks from it): forwarded, and it fails here for want of an upstream
    assert.notEqual((await ask(dns, 'www.example.org', 'A', '127.0.0.1')).rcode, REFUSED);

    const status = await (await fetch(`http://127.0.0.1:${http}/api/service/status`)).json();
    assert.equal(status.dns.queries.refused, 2);
    assert.deepEqual(status.dns.recursion.allowed, ['203.0.113.0/24']);
    const refused = await (await fetch(`http://127.0.0.1:${http}/api/service/refused`)).json();
    assert.deepEqual(refused.clients.map((c) => [c.client, c.count]), [['127.0.0.2', 2]]);
});

withDb('the default list lets the loopback range through; the same client is not refused', async () => {
    const { dns } = await start('default', {});
    const answer = await ask(dns, 'www.example.org');
    assert.notEqual(answer.rcode, REFUSED);
    assert.deepEqual(await ask(dns, 'www.example.test'), { rcode: 0, answers: 1 });
});

withDb('an open list on purpose: the foreign client is answered like anybody', async () => {
    const { dns } = await start('open', { ODIN_NS_RECURSION_ALLOWED: '0.0.0.0/0,::/0' });
    assert.notEqual((await ask(dns, 'www.example.org')).rcode, REFUSED);
});
