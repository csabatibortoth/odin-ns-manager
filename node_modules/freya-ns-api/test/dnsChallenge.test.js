const test = require('node:test');
const assert = require('node:assert/strict');
const { planFor, challengeName, createHandlers, visibleOnPublicResolvers, visibleOnAuthoritative, authoritativeAddresses, explainFailure } = require('../services/certificateService/dnsChallenge');

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

test('visible on public resolvers: one that has it is enough', async () => {
    const decide = (answers) => visibleOnPublicResolvers('_acme-challenge.example.com', 'v', async (server) => answers[['1.1.1.1', '8.8.8.8'].indexOf(server)]);
    assert.equal(await decide(['yes', 'no']), true);
    assert.equal(await decide(['no', 'yes']), true);
    assert.equal(await decide(['unreachable', 'yes']), true);
    assert.equal(await decide(['no', 'no']), false);
    assert.equal(await decide(['unreachable', 'unreachable']), false);
});

test('visible on the authoritative servers: every one that answers has it, and at least one does', async () => {
    const decide = (answers) => visibleOnAuthoritative('_acme-challenge.example.com', 'v', {
        addresses: async () => ['192.0.2.1', '192.0.2.2'],
        ask: async (server) => answers[['192.0.2.1', '192.0.2.2'].indexOf(server)],
    });
    assert.equal(await decide(['yes', 'yes']), true);
    assert.equal(await decide(['yes', 'unreachable']), true, 'one that does not answer tells nothing');
    assert.equal(await decide(['yes', 'no']), false, 'a name server that does not have it yet: too early');
    assert.equal(await decide(['no', 'no']), false);
    assert.equal(await decide(['unreachable', 'unreachable']), null, 'nobody answered: unknown, the caller falls back');
    assert.equal(await visibleOnAuthoritative('x.example.com', 'v', { addresses: async () => [], ask: async () => 'yes' }), null, 'no servers found: unknown');
});

test('the name servers are found at the nearest parent that has NS records, as addresses', async () => {
    const calls = [];
    const fake = {
        resolveNs: async (zone) => {
            calls.push(zone);
            if (zone === 'example.com') return ['ns1.example.net', 'ns2.example.net'];
            throw Object.assign(new Error('no'), { code: 'ENODATA' });
        },
        resolve4: async (host) => (host === 'ns1.example.net' ? ['192.0.2.1'] : ['192.0.2.2', '192.0.2.1']),
    };
    assert.deepEqual(await authoritativeAddresses('_acme-challenge.www.example.com', fake), ['192.0.2.1', '192.0.2.2']);
    assert.deepEqual(calls, ['www.example.com', 'example.com']);
    assert.deepEqual(await authoritativeAddresses('_acme-challenge.nothing.invalid', { resolveNs: async () => { throw new Error('x'); }, resolve4: async () => [] }), []);
});

test('the settle wait comes after the record is visible, and is reported', async () => {
    const provider = memoryProvider();
    const clock = fakeClock();
    const events = [];
    const handlers = createHandlers(provider, { waitSeconds: 60, settleSeconds: 7, ...clock, onEvent: (type) => events.push(type) });
    await handlers.create(authz('example.com'), dns01, 'VALUE1');
    assert.deepEqual(events, ['record written', 'record visible', 'settled']);
    assert.equal(clock.now(), 7000, 'the record was visible at once: only the settle wait passed');
});

test('no settle wait when it is switched off, and none when the record never became visible', async () => {
    const quick = fakeClock();
    await createHandlers(memoryProvider(), { settleSeconds: 0, ...quick }).create(authz('example.com'), dns01, 'V');
    assert.equal(quick.now(), 0);

    const slow = fakeClock();
    const handlers = createHandlers(memoryProvider({ visibleAfter: Infinity }), { waitSeconds: 10, settleSeconds: 30, ...slow });
    await assert.rejects(handlers.create(authz('example.com'), dns01, 'V'), /could not be seen within 10 seconds/);
    assert.ok(slow.now() < 30_000, 'the settle wait is not spent on a record that is not there');
});

test('explainFailure: only for failures about an old or wrong record', () => {
    assert.match(explainFailure('During secondary validation: Incorrect TXT record "x" (and 1 more) found at _acme-challenge.a.b'), /Wait two minutes/);
    assert.match(explainFailure('Incorrect TXT record "x" found at ...'), /older copy/);
    assert.equal(explainFailure('Cannot issue for "example.com": forbidden by policy'), '');
    assert.equal(explainFailure(undefined), '');
});
