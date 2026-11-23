const test = require('node:test');
const assert = require('node:assert/strict');
const { planFor, challengeName, createHandlers } = require('../services/certificateService/dnsChallenge');

const authz = (value) => ({ identifier: { type: 'dns', value } });
const dns01 = { type: 'dns-01' };

// A provider that keeps its records in memory, like a zone would.
function memoryProvider({ visibleAfter = 0 } = {}) {
    const records = [];
    let asked = 0;
    return {
        records,
        create: async (name, value) => void records.push({ name, value }),
        remove: async (name, value) => {
            const at = records.findIndex((r) => r.name === name && r.value === value);
            if (at >= 0) records.splice(at, 1);
        },
        visible: async (name, value) => ++asked > visibleAfter && records.some((r) => r.name === name && r.value === value),
    };
}

// A clock the test moves itself: sleeping advances it.
function fakeClock() {
    let t = 0;
    return { now: () => t, sleep: async (ms) => void (t += ms) };
}

test('planFor: http-01 is the default and needs port 80, not DNS', () => {
    assert.deepEqual(planFor('http-01', ['a.example.com']), { priority: ['http-01'], needsHttp: true, needsDns: false });
});

test('planFor: a wildcard is refused with http-01', () => {
    assert.throws(() => planFor('http-01', ['*.example.com']), /wildcard.*DNS/);
});

test('planFor: dns-01 never opens port 80', () => {
    assert.deepEqual(planFor('dns-01', ['a.example.com', '*.example.com']), { priority: ['dns-01'], needsHttp: false, needsDns: true });
});

test('planFor: auto uses DNS only when a wildcard is there', () => {
    assert.equal(planFor('auto', ['a.example.com']).needsDns, false);
    assert.equal(planFor('auto', ['*.example.com']).needsHttp, false);
    const both = planFor('auto', ['a.example.com', '*.example.com']);
    assert.deepEqual([both.needsHttp, both.needsDns], [true, true]);
});

test('planFor: an unknown mode is an error', () => {
    assert.throws(() => planFor('tls-alpn-01', ['a.example.com']), /must be one of/);
});

test('challengeName: a wildcard and its base name share one record name', () => {
    assert.equal(challengeName('*.Example.com'), '_acme-challenge.example.com');
    assert.equal(challengeName('example.com'), '_acme-challenge.example.com');
});

test('create writes the record and returns once it is visible, with back-off', async () => {
    const provider = memoryProvider({ visibleAfter: 2 });
    const clock = fakeClock();
    const handlers = createHandlers(provider, { waitSeconds: 60, ...clock });
    await handlers.create(authz('example.com'), dns01, 'VALUE1');
    assert.deepEqual(provider.records, [{ name: '_acme-challenge.example.com', value: 'VALUE1' }]);
    assert.equal(clock.now(), 1000 + 2000); // waited twice: 1 s, then 2 s
});

test('create gives up with a clear error after the wait, and the record can still be cleaned up', async () => {
    const provider = memoryProvider({ visibleAfter: Infinity });
    const handlers = createHandlers(provider, { waitSeconds: 10, ...fakeClock() });
    await assert.rejects(handlers.create(authz('example.com'), dns01, 'V'), /could not be seen within 10 seconds/);
    assert.equal(provider.records.length, 1);
    assert.deepEqual(await handlers.cleanup(), []);
    assert.equal(provider.records.length, 0);
});

test('a wildcard and its base name: two values at one name, each removed alone', async () => {
    const provider = memoryProvider();
    const handlers = createHandlers(provider, { ...fakeClock() });
    await handlers.create(authz('example.com'), dns01, 'A');
    await handlers.create(authz('example.com'), dns01, 'B'); // the authorization of *.example.com names example.com too
    assert.equal(provider.records.length, 2);
    await handlers.remove(authz('example.com'), dns01, 'A');
    assert.deepEqual(provider.records, [{ name: '_acme-challenge.example.com', value: 'B' }]);
    assert.equal(handlers.written.size, 1);
});

test('cleanup removes everything left, and an error on one does not stop the rest', async () => {
    const provider = memoryProvider();
    const handlers = createHandlers(provider, { ...fakeClock() });
    await handlers.create(authz('a.example.com'), dns01, '1');
    await handlers.create(authz('b.example.com'), dns01, '2');
    const real = provider.remove;
    provider.remove = async (name, value) => {
        if (value === '1') throw new Error('provider down');
        return real(name, value);
    };
    const errors = await handlers.cleanup();
    assert.equal(errors.length, 1);
    assert.match(errors[0], /a\.example\.com: provider down/);
    assert.deepEqual(provider.records, [{ name: '_acme-challenge.a.example.com', value: '1' }]);
});

test('a challenge of another type is refused', async () => {
    const handlers = createHandlers(memoryProvider(), { ...fakeClock() });
    await assert.rejects(handlers.create(authz('example.com'), { type: 'http-01' }, 'x'), /Not a DNS challenge/);
});

test('the provider registry says what is wrong', () => {
    const providers = require('../services/certificateService/dnsProviders');
    assert.throws(() => providers.get(''), /FREYA_ACME_DNS_PROVIDER is required/);
    assert.throws(() => providers.get('__proto__'), /not known/);
});
