// The rate limit of the answers: the counting, the networks, the sizes of UDP answers (no server needed).
const assert = require('node:assert/strict');
const { test } = require('node:test');

const rl = require('../services/serverService/rateLimitService');

test('the client network: a /24 for IPv4, a /56 for IPv6, IPv4 in IPv6 form is IPv4, rubbish is nothing', () => {
    assert.equal(rl.networkOf('192.0.2.77'), '192.0.2.0/24');
    assert.equal(rl.networkOf('::ffff:192.0.2.200'), '192.0.2.0/24');
    assert.equal(rl.networkOf('2001:db8:1:2:3:4:5:6'), '2001:db8:1:0::/56');
    assert.equal(rl.networkOf('2001:db8:1:2ff:3::1'), '2001:db8:1:200::/56');
    assert.equal(rl.networkOf('2001:db8:1:0:ffff::1'), rl.networkOf('2001:db8:1:ab:1::9'), 'the same /56');
    assert.notEqual(rl.networkOf('2001:db8:1:100::1'), rl.networkOf('2001:db8:1:200::1'), 'another /56');
    assert.equal(rl.networkOf('fe80::1%eth0'), 'fe80:0:0:0::/56');
    for (const bad of ['nonsense', '', null, undefined, '999.1.1.1']) assert.equal(rl.networkOf(bad), null);
});

function clock(start = 1_000_000) {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; } };
}

test('a bucket allows the burst, then limits; time gives tokens back, never more than the burst', () => {
    const c = clock();
    const limiter = rl.createLimiter({ perSecond: 5, slip: 0, now: c.now });
    const verdicts = Array.from({ length: 8 }, () => limiter.check('a'));
    assert.deepEqual(verdicts, ['allow', 'allow', 'allow', 'allow', 'allow', 'drop', 'drop', 'drop']);
    c.advance(400); // 2 tokens
    assert.deepEqual([limiter.check('a'), limiter.check('a'), limiter.check('a')], ['allow', 'allow', 'drop']);
    c.advance(60_000); // a long time: still only the burst
    assert.deepEqual(Array.from({ length: 7 }, () => limiter.check('a')), ['allow', 'allow', 'allow', 'allow', 'allow', 'drop', 'drop']);
});

test('keys are independent', () => {
    const limiter = rl.createLimiter({ perSecond: 1, slip: 0, now: clock().now });
    assert.equal(limiter.check('a'), 'allow');
    assert.equal(limiter.check('a'), 'drop');
    assert.equal(limiter.check('b'), 'allow');
});

test('slip: every n-th limited answer is a "slip"; 0 never, 1 always; the count starts again after an allowed answer', () => {
    const c = clock();
    const run = (slip) => {
        const limiter = rl.createLimiter({ perSecond: 1, slip, now: c.now });
        limiter.check('k');
        return Array.from({ length: 6 }, () => limiter.check('k'));
    };
    assert.deepEqual(run(0), ['drop', 'drop', 'drop', 'drop', 'drop', 'drop']);
    assert.deepEqual(run(1), ['slip', 'slip', 'slip', 'slip', 'slip', 'slip']);
    assert.deepEqual(run(2), ['drop', 'slip', 'drop', 'slip', 'drop', 'slip']);
    assert.deepEqual(run(3), ['drop', 'drop', 'slip', 'drop', 'drop', 'slip']);
});

test('the table is bounded: endless keys do not make it grow, the longest unused key goes first', () => {
    const limiter = rl.createLimiter({ perSecond: 1, slip: 0, maxKeys: 100, now: clock().now });
    for (let i = 0; i < 5000; i++) limiter.check(`name-${i}`);
    assert.equal(limiter.size(), 100);
    // a key in use stays: "hot" is used again and again while others come and go
    const hot = rl.createLimiter({ perSecond: 1, slip: 0, maxKeys: 10, now: clock().now });
    assert.equal(hot.check('hot'), 'allow');
    for (let i = 0; i < 50; i++) {
        hot.check(`x${i}`);
        assert.equal(hot.check('hot'), 'drop', 'a limited key is not forgotten while it is used');
    }
});

const settings = (extra = {}) => ({ nsRateLimitEnabled: true, nsRateLimitPerSecond: 2, nsRateLimitSlip: 2, ...extra });
const query = (extra = {}) => ({ address: '198.51.100.7', transport: 'udp', kind: 'answer', name: 'WWW.Example.test', type: 'A', zone: 'example.test', ...extra });

test('decide: answers per name and type, nxdomain per zone, refused per network; the name is not case sensitive', () => {
    rl.reset();
    const config = settings();
    const ask = (extra) => rl.decide({ config }, query(extra));
    assert.deepEqual([ask(), ask({ name: 'www.example.test' }), ask({ name: 'www.EXAMPLE.test' })], ['send', 'send', 'drop']);
    assert.equal(ask({ type: 'AAAA' }), 'send', 'another type is another answer');
    assert.equal(ask({ name: 'mail.example.test' }), 'send', 'another name is another answer');
    assert.equal(ask({ address: '198.51.101.7' }), 'send', 'another network');
    assert.equal(ask({ address: '198.51.100.250', name: 'www.example.test' }), 'slip', 'the same /24: it is the 2nd limited answer of that key (slip 2)');
    // random names below one zone count together
    const verdicts = Array.from({ length: 6 }, (_, i) => ask({ kind: 'nxdomain', name: `random${i}.example.test` }));
    assert.deepEqual(verdicts, ['send', 'send', 'drop', 'slip', 'drop', 'slip']);
    assert.equal(ask({ kind: 'nxdomain', name: 'x.other.test', zone: 'other.test' }), 'send', 'another zone');
    const refused = Array.from({ length: 4 }, (_, i) => ask({ kind: 'refused', name: `name${i}.example.org`, zone: null }));
    assert.deepEqual(refused, ['send', 'send', 'drop', 'slip']);
});

test('decide: TCP, a switched-off limit, an exempt client and an unreadable address are never limited', () => {
    rl.reset();
    const config = settings({ nsRateLimitPerSecond: 1 });
    const sent = (extra, cfg = config, exempt) => Array.from({ length: 5 }, () => rl.decide({ config: cfg, exempt }, query(extra))).every((v) => v === 'send');
    assert.equal(sent({ transport: 'tcp' }), true);
    assert.equal(sent({}, settings({ nsRateLimitEnabled: false })), true);
    assert.equal(sent({}, config, (address) => address === '198.51.100.7'), true);
    assert.equal(sent({ address: 'not an address' }), true);
    assert.equal(sent({ address: undefined }), true);
    assert.equal(sent({}), false, 'and the same query is limited when none of these applies');
});

test('decide: a new limit takes effect at once; the counters say what happened', () => {
    rl.reset();
    const config = settings({ nsRateLimitPerSecond: 1, nsRateLimitSlip: 1 });
    rl.decide({ config }, query());
    assert.equal(rl.decide({ config }, query()), 'slip');
    assert.equal(rl.decide({ config: { ...config, nsRateLimitPerSecond: 50 } }, query()), 'send', 'a new setting, a new table');
    assert.deepEqual(rl.state(), { dropped: 0, slipped: 1, truncated: 0, tracked: 1 });
});

// A question packet: header + question (+ an OPT record of EDNS0 with a payload size)
function packet(name, payload) {
    const labels = name.split('.').flatMap((l) => [Buffer.from([l.length]), Buffer.from(l)]);
    const header = Buffer.from([0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, payload ? 1 : 0]);
    const question = Buffer.concat([...labels, Buffer.from([0, 0, 1, 0, 1])]);
    if (!payload) return Buffer.concat([header, question]);
    const opt = Buffer.alloc(11);
    opt.writeUInt8(0, 0); opt.writeUInt16BE(41, 1); opt.writeUInt16BE(payload, 3); opt.writeUInt16BE(0, 9);
    return Buffer.concat([header, question, opt]);
}

test('the UDP size: 512 without EDNS0, what the client announces within 512..1232 with it, 512 for rubbish', () => {
    assert.equal(rl.udpLimit(packet('www.example.test')), 512);
    assert.equal(rl.udpLimit(packet('www.example.test', 4096)), 1232);
    assert.equal(rl.udpLimit(packet('www.example.test', 1400)), 1232);
    assert.equal(rl.udpLimit(packet('www.example.test', 900)), 900);
    assert.equal(rl.udpLimit(packet('www.example.test', 100)), 512);
    assert.equal(rl.udpLimit(Buffer.alloc(3)), 512);
    assert.equal(rl.udpLimit(undefined), 512);
    const cut = packet('www.example.test', 4096);
    for (let n = 0; n < cut.length; n++) assert.ok([512, 1232].includes(rl.udpLimit(cut.subarray(0, n))), `cut at ${n}`);
});

test('truncate leaves a TC answer with nothing in it', () => {
    const query = { _answers: [1, 2, 3], _anCount: 3, _flags: { rcode: 3, tc: false } };
    rl.truncate(query);
    assert.deepEqual(query, { _answers: [], _anCount: 0, _flags: { rcode: 0, tc: true } });
});
