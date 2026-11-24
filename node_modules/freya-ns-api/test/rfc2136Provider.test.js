const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const net = require('net');
const fs = require('fs');
const path = require('path');

const rfc = require('../services/certificateService/rfc2136Provider');

const SECRET = crypto.randomBytes(32);
const SECRET_B64 = SECRET.toString('base64');
const VALUE = 'A'.repeat(43);
const NAME = '_acme-challenge.example.test';
const OPTIONS = { zone: 'example.test', keyName: 'acme-key', secret: SECRET_B64 };

// ---- a fake master name server that checks the signature on its own (code written separately from the provider) ----
const wireName = (n) => Buffer.concat([...n.replace(/\.$/, '').split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
const be = (n, size) => { const b = Buffer.alloc(size); b.writeUIntBE(n, 0, size); return b; };

// Reads the request: returns the sections as records and the TSIG facts.
function readRequest(buf) {
    let at = 12;
    const skipName = () => { while (buf[at] !== 0) at += buf[at] + 1; at += 1; };
    const nameAt = (from) => { const labels = []; let p = from; while (buf[p] !== 0) { labels.push(buf.toString('ascii', p + 1, p + 1 + buf[p])); p += buf[p] + 1; } return labels.join('.'); };
    const counts = { zone: buf.readUInt16BE(4), update: buf.readUInt16BE(8), additional: buf.readUInt16BE(10) };
    const zoneName = nameAt(at); skipName(); at += 4;
    const updates = [];
    for (let i = 0; i < counts.update; i++) {
        const name = nameAt(at); skipName();
        const type = buf.readUInt16BE(at), klass = buf.readUInt16BE(at + 2), ttl = buf.readUInt32BE(at + 4), len = buf.readUInt16BE(at + 8);
        const rdata = buf.subarray(at + 10, at + 10 + len); at += 10 + len;
        updates.push({ name, type, klass, ttl, text: rdata.subarray(1, 1 + rdata[0]).toString() });
    }
    const tsigStart = at;
    const keyName = nameAt(at); skipName(); at += 10;
    const algorithm = nameAt(at); skipName();
    const timeSigned = buf.readUIntBE(at, 6), fudge = buf.readUInt16BE(at + 6), macLen = buf.readUInt16BE(at + 8);
    const mac = buf.subarray(at + 10, at + 10 + macLen);
    return { id: buf.readUInt16BE(0), counts, zoneName, updates, tsigStart, keyName, algorithm, timeSigned, fudge, mac };
}

function verifyRequest(buf, r) {
    const body = Buffer.from(buf.subarray(0, r.tsigStart)); body.writeUInt16BE(r.counts.additional - 1, 10);
    const vars = Buffer.concat([wireName(r.keyName), be(255, 2), be(0, 4), wireName(r.algorithm), be(r.timeSigned, 6), be(r.fudge, 2), be(0, 2), be(0, 2)]);
    const expected = crypto.createHmac('sha256', SECRET).update(Buffer.concat([body, vars])).digest();
    return crypto.timingSafeEqual(expected, r.mac);
}

function answerFor(buf, r, { rcode = 0, secret = SECRET, keyName = r.keyName, skewSeconds = 0, sign = true, id = r.id, flipMacBit = false } = {}) {
    const header = Buffer.concat([be(id, 2), be(0x8000 | (5 << 11) | rcode, 2), be(1, 2), be(0, 2), be(0, 2), be(0, 2)]);
    const zone = Buffer.concat([wireName(r.zoneName), be(6, 2), be(1, 2)]);
    const message = Buffer.concat([header, zone]);
    if (!sign) return message;
    const timeSigned = r.timeSigned + skewSeconds;
    const vars = Buffer.concat([wireName(keyName), be(255, 2), be(0, 4), wireName('hmac-sha256'), be(timeSigned, 6), be(300, 2), be(0, 2), be(0, 2)]);
    const mac = crypto.createHmac('sha256', secret).update(Buffer.concat([be(r.mac.length, 2), r.mac, message, vars])).digest();
    if (flipMacBit) mac[0] ^= 1;
    const rdata = Buffer.concat([wireName('hmac-sha256'), be(timeSigned, 6), be(300, 2), be(mac.length, 2), mac, be(r.id, 2), be(0, 2), be(0, 2)]);
    const tsig = Buffer.concat([wireName(keyName), be(250, 2), be(255, 2), be(0, 4), be(rdata.length, 2), rdata]);
    const signed = Buffer.concat([message, tsig]); signed.writeUInt16BE(1, 10);
    return signed;
}

// behaviour(request, rawBuffer, socket) -> Buffer | null (no answer) | 'close'
async function withServer(behaviour, run) {
    const seen = [];
    const server = net.createServer((socket) => {
        const chunks = [];
        socket.on('data', (d) => {
            chunks.push(d);
            const all = Buffer.concat(chunks);
            if (all.length < 2 || all.length < 2 + all.readUInt16BE(0)) return;
            const raw = all.subarray(2, 2 + all.readUInt16BE(0));
            const req = readRequest(raw);
            req.validSignature = verifyRequest(raw, req);
            seen.push(req);
            const out = behaviour(req, raw, socket);
            if (out === 'close') return socket.end();
            if (out) socket.write(Buffer.concat([be(out.length, 2), out]));
        });
        socket.on('error', () => {});
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try { return await run(`127.0.0.1:${server.address().port}`, seen); } finally { await new Promise((resolve) => server.close(resolve)); }
}
const good = (req, raw) => answerFor(raw, req);

test('create sends one signed UPDATE that adds the TXT record in class IN with ttl 60', async () => {
    await withServer(good, async (server, seen) => {
        await rfc.createProvider({ ...OPTIONS, server }).create(NAME, VALUE);
        assert.equal(seen.length, 1);
        const [r] = seen;
        assert.equal(r.validSignature, true);
        assert.equal(r.zoneName, 'example.test');
        assert.equal(r.keyName, 'acme-key');
        assert.equal(r.algorithm, 'hmac-sha256');
        assert.deepEqual(r.updates, [{ name: NAME, type: 16, klass: 1, ttl: 60, text: VALUE }]);
    });
});

test('remove deletes exactly one record (class NONE, ttl 0), never the whole record set (class ANY)', async () => {
    await withServer(good, async (server, seen) => {
        await rfc.createProvider({ ...OPTIONS, server }).remove(NAME, VALUE);
        assert.deepEqual(seen[0].updates, [{ name: NAME, type: 16, klass: 254, ttl: 0, text: VALUE }]);
        assert.equal(seen[0].validSignature, true);
    });
});

test('every supported algorithm is signed, MD5 and SHA-1 are refused', async () => {
    for (const bad of ['hmac-md5.sig-alg.reg.int', 'hmac-md5', 'hmac-sha1', 'hmac-sha224', 'nonsense']) {
        assert.throws(() => rfc.createProvider({ ...OPTIONS, server: '127.0.0.1', algorithm: bad }), /KEY_ALGORITHM/);
    }
    for (const algorithm of ['hmac-sha256', 'HMAC-SHA512.', 'hmac-sha384']) {
        assert.doesNotThrow(() => rfc.createProvider({ ...OPTIONS, server: '127.0.0.1', algorithm }));
    }
});

test('the answer must be signed: an unsigned NOERROR is not accepted', async () => {
    await withServer((req, raw) => answerFor(raw, req, { sign: false }), async (server) => {
        await assert.rejects(rfc.createProvider({ ...OPTIONS, server }).create(NAME, VALUE), /without a TSIG signature/);
    });
});

test('an answer with a wrong signature, a wrong key or a wrong secret is not accepted', async () => {
    await withServer((req, raw) => answerFor(raw, req, { flipMacBit: true }), async (server) => {
        await assert.rejects(rfc.createProvider({ ...OPTIONS, server }).create(NAME, VALUE), /signature of the answer is wrong/);
    });
    await withServer((req, raw) => answerFor(raw, req, { secret: crypto.randomBytes(32) }), async (server) => {
        await assert.rejects(rfc.createProvider({ ...OPTIONS, server }).create(NAME, VALUE), /signature of the answer is wrong/);
    });
    await withServer((req, raw) => answerFor(raw, req, { keyName: 'other-key' }), async (server) => {
        await assert.rejects(rfc.createProvider({ ...OPTIONS, server }).create(NAME, VALUE), /another key/);
    });
});

test('an answer whose time differs by more than the fudge is not accepted (replay)', async () => {
    await withServer((req, raw) => answerFor(raw, req, { skewSeconds: -3600 }), async (server) => {
        await assert.rejects(rfc.createProvider({ ...OPTIONS, server }).create(NAME, VALUE), /clocks|signature/);
    });
});

test('an answer to another request (wrong id) is not accepted', async () => {
    await withServer((req, raw) => answerFor(raw, req, { id: (req.id + 1) & 0xffff }), async (server) => {
        await assert.rejects(rfc.createProvider({ ...OPTIONS, server }).create(NAME, VALUE), /does not belong/);
    });
});

test('refusals say what to check, and never contain the secret', async () => {
    for (const rcode of [5, 9]) {
        await withServer((req, raw) => answerFor(raw, req, { sign: false, rcode }), async (server) => {
            await assert.rejects(rfc.createProvider({ ...OPTIONS, server }).create(NAME, VALUE), (err) => {
                assert.match(err.message, /not authorized/);
                assert.ok(!err.message.includes(SECRET_B64));
                return true;
            });
        });
    }
    await withServer((req, raw) => answerFor(raw, req, { rcode: 10 }), async (server) => {
        await assert.rejects(rfc.createProvider({ ...OPTIONS, server }).create(NAME, VALUE), /NOTZONE/);
    });
});

test('no server, a closed connection, a silent server and a cut-off answer are errors, not hangs', async () => {
    await assert.rejects(rfc.createProvider({ ...OPTIONS, server: '127.0.0.1:1' }).create(NAME, VALUE), /could not be reached/);
    await withServer(() => 'close', async (server) => {
        await assert.rejects(rfc.createProvider({ ...OPTIONS, server }).create(NAME, VALUE), /closed the connection/);
    });
    await withServer(() => null, async (server) => {
        await assert.rejects(rfc.createProvider({ ...OPTIONS, server, timeout: 200 }).create(NAME, VALUE), /did not answer/);
    });
    await withServer((req, raw) => answerFor(raw, req).subarray(0, 20), async (server) => {
        await assert.rejects(rfc.createProvider({ ...OPTIONS, server }).create(NAME, VALUE), /cut off|too short|closed/);
    });
});

test('names, values and the zone are checked before anything is sent', async () => {
    await withServer(good, async (server, seen) => {
        const p = rfc.createProvider({ ...OPTIONS, server });
        await assert.rejects(p.create('www.example.test', VALUE), /Only names that start with _acme-challenge/);
        await assert.rejects(p.create('_acme-challenge.', VALUE), /Only names/);
        await assert.rejects(p.create('_acme-challenge.example.org', VALUE), /not inside the zone/);
        await assert.rejects(p.create('_acme-challenge.evilexample.test', VALUE), /not inside the zone/);
        await assert.rejects(p.create(NAME, 'short'), /wrong form/);
        await assert.rejects(p.create(NAME, VALUE + '"; DROP'), /wrong form/);
        await assert.rejects(p.remove('_acme-challenge.a b.example.test', VALUE), /Not a valid DNS name/);
        await assert.rejects(p.create(`_acme-challenge.${'a'.repeat(64)}.example.test`, VALUE), /Not a valid DNS name/);
        assert.equal(seen.length, 0);
    });
});

test('the configuration is checked: zone, key name, server, secret', () => {
    const base = { ...OPTIONS, server: '127.0.0.1' };
    assert.throws(() => rfc.createProvider({ ...base, zone: '' }), /needs the zone/);
    assert.throws(() => rfc.createProvider({ ...base, keyName: '' }), /Not a valid DNS name/);
    assert.throws(() => rfc.createProvider({ ...base, secret: '' }), /needs the TSIG key secret/);
    assert.throws(() => rfc.createProvider({ ...base, secret: 'not base64 !!' }), /base64/);
    assert.throws(() => rfc.createProvider({ ...base, secret: Buffer.alloc(8).toString('base64') }), /too short/);
    assert.throws(() => rfc.createProvider({ ...base, server: '' }), /FREYA_ACME_RFC2136_SERVER/);
    assert.throws(() => rfc.createProvider({ ...base, server: 'host:99999' }), /bad port/);
    assert.throws(() => rfc.createProvider({ ...base, server: 'bad host' }), /FREYA_ACME_RFC2136_SERVER/);
    assert.deepEqual(rfc.parseServer('ns.example.org'), { host: 'ns.example.org', port: 53 });
    assert.deepEqual(rfc.parseServer('10.0.0.1:5353'), { host: '10.0.0.1', port: 5353 });
    assert.deepEqual(rfc.parseServer('[::1]:53'), { host: '::1', port: 53 });
});

test('the secret can come from a file (first line) and is not required in the environment', async () => {
    const file = path.join(require('os').tmpdir(), `freya-tsig-${process.pid}.key`);
    fs.writeFileSync(file, `${SECRET_B64}\nsecond line is ignored\n`, { mode: 0o600 });
    try {
        await withServer(good, async (server, seen) => {
            await rfc.createProvider({ zone: 'example.test', keyName: 'acme-key', secretFile: file, server }).create(NAME, VALUE);
            assert.equal(seen[0].validSignature, true);
        });
    } finally { fs.rmSync(file, { force: true }); }
});

// ---- the real thing: an exchange recorded from BIND 9.18 (a throwaway test key, not a secret) ----
const capture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'rfc2136-bind-capture.json'), 'utf8'));

for (const kind of ['add', 'delete']) {
    test(`BIND recording (${kind}): our request is byte for byte what we sign, and BIND's signed answer verifies`, () => {
        const c = capture[kind];
        const secret = Buffer.from(capture.secretBase64, 'base64');
        const message = rfc.buildUpdate({ id: c.id, zone: capture.zone, [kind === 'add' ? 'adds' : 'deletes']: [{ name: NAME, value: VALUE }] });
        const signed = rfc.sign(message, { keyName: capture.keyName, algorithm: capture.algorithm, secret, now: c.now });
        assert.equal(signed.signed.toString('hex'), c.request);
        assert.equal(signed.mac.toString('hex'), c.requestMac);
        const answer = Buffer.from(c.answer, 'hex');
        const parsed = rfc.parseMessage(answer);
        assert.equal(parsed.header.rcode, 0);
        assert.doesNotThrow(() => rfc.verifyAnswer(answer, parsed, { id: c.id, mac: signed.mac }, { keyName: capture.keyName, algorithm: capture.algorithm, secret, now: c.now }));
        // one changed bit anywhere in the answer, or the wrong request MAC, breaks it
        const tampered = Buffer.from(answer); tampered[tampered.length - 20] ^= 1;
        assert.throws(() => rfc.verifyAnswer(tampered, rfc.parseMessage(tampered), { id: c.id, mac: signed.mac }, { keyName: capture.keyName, algorithm: capture.algorithm, secret, now: c.now }));
        assert.throws(() => rfc.verifyAnswer(answer, parsed, { id: c.id, mac: Buffer.alloc(32) }, { keyName: capture.keyName, algorithm: capture.algorithm, secret, now: c.now }), /signature/);
    });
}

test('the reader refuses name loops and cut-off data', () => {
    const loop = Buffer.concat([Buffer.alloc(12), Buffer.from([0xc0, 12])]);
    loop.writeUInt16BE(1, 4);
    assert.throws(() => rfc.parseMessage(loop), /loops|cut off/);
    assert.throws(() => rfc.parseMessage(Buffer.alloc(5)), /too short/);
});

// ---- Gordon's review 2026-11-24: the permissions of the key file ----
const unixOnly = process.platform === 'win32';
function keyFile(mode, content = `${SECRET_B64}\n`) {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'freya-key-'));
    const file = path.join(dir, 'acme.key');
    fs.writeFileSync(file, content);
    fs.chmodSync(file, mode);
    return { dir, file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const withFile = (file) => ({ ...OPTIONS, secret: undefined, secretFile: file, server: '127.0.0.1:1' });

test('a key file that group or others can read or change is refused before any connection', { skip: unixOnly }, async () => {
    for (const mode of [0o644, 0o640, 0o660, 0o666, 0o604, 0o602, 0o622]) {
        const k = keyFile(mode);
        try {
            assert.throws(() => rfc.createProvider(withFile(k.file)), (err) => {
                assert.match(err.message, /read or changed by group or others/, mode.toString(8));
                assert.ok(!err.message.includes(SECRET_B64), 'the secret is not in the message');
                return true;
            });
        } finally { k.cleanup(); }
    }
    const ok = keyFile(0o600);
    try { assert.doesNotThrow(() => rfc.createProvider(withFile(ok.file))); } finally { ok.cleanup(); }
    const ro = keyFile(0o400);
    try { assert.doesNotThrow(() => rfc.createProvider(withFile(ro.file))); } finally { ro.cleanup(); }
});

test('no network is touched when the key file is refused', { skip: unixOnly }, async () => {
    const k = keyFile(0o644);
    let connected = 0;
    try {
        assert.throws(() => rfc.createProvider({ ...withFile(k.file), connect: () => { connected++; throw new Error('no'); } }), /group or others/);
        assert.equal(connected, 0);
    } finally { k.cleanup(); }
});

test('a symlink to the key file is followed and the REAL file is checked', { skip: unixOnly }, () => {
    const open = keyFile(0o644);
    const private_ = keyFile(0o600);
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'freya-link-'));
    try {
        fs.symlinkSync(open.file, path.join(dir, 'to-open'));
        fs.symlinkSync(private_.file, path.join(dir, 'to-private'));
        assert.throws(() => rfc.createProvider(withFile(path.join(dir, 'to-open'))), /group or others/);
        assert.doesNotThrow(() => rfc.createProvider(withFile(path.join(dir, 'to-private'))));
    } finally { open.cleanup(); private_.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a key file of another user, a folder, a missing file are refused; Windows says to use the environment', { skip: unixOnly }, () => {
    const k = keyFile(0o600);
    try {
        const view = { ...fs, statSync: (p) => new Proxy(fs.statSync(p), { get: (t, key) => (key === 'uid' ? 4242 : typeof t[key] === 'function' ? t[key].bind(t) : t[key]) }) };
        assert.throws(() => rfc.createProvider({ ...withFile(k.file), fsApi: view }), /another user/);
        assert.throws(() => rfc.createProvider(withFile(k.dir)), /regular file/);
        assert.throws(() => rfc.createProvider(withFile(path.join(k.dir, 'nothing'))), /does not exist/);
        assert.throws(() => rfc.createProvider({ ...withFile(k.file), platform: 'win32' }), /not supported on Windows.*FREYA_ACME_RFC2136_KEY_SECRET/);
        // the environment variable still works everywhere
        assert.doesNotThrow(() => rfc.createProvider({ ...OPTIONS, server: '127.0.0.1:1', platform: 'win32' }));
    } finally { k.cleanup(); }
});
