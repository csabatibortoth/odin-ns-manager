// What is said about the certificate of HTTPS: the mail when it can not be renewed, and the metrics.
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { problem, start, stop } = require('../services/serverService/certificateWatch');
const { collect, problems } = require('../plugins/heimdall/lib/collect');

const status = (over = {}, daysLeft = 60) => ({ automaticRenewal: true, lastError: null, certificate: { daysLeft }, ...over });

test('no problem: no certificate, a healthy one, one with time left', () => {
    assert.equal(problem(null), null);
    assert.equal(problem({ certificate: null }), null);
    assert.equal(problem(status()), null);
    assert.equal(problem(status({}, 14)), null);
});

test('a failed renewal says why and how long is left', () => {
    assert.match(problem(status({ lastError: 'port 80 is closed' }, 20)), /could not be renewed: port 80 is closed\nIt expires in 20 day/);
});

test('a certificate that is near its end: renewal not yet done, or a certificate of your own', () => {
    assert.match(problem(status({}, 10)), /expires in 10 day.*has not been renewed yet/);
    assert.match(problem(status({ automaticRenewal: false }, 10)), /not renewed automatically: replace it/);
});

test('the watch tells once, and again when it is fine', async () => {
    const told = [];
    let current = status({ lastError: 'x' });
    const check = start({ status: () => current, report: (job, failure) => told.push([job, failure === null ? null : 'failure']), every: 3600_000 });
    check();
    current = status();
    check();
    stop();
    // the real report() deduplicates; here every call is seen: failure, failure, then fine
    assert.deepEqual(told, [['certificate', 'failure'], ['certificate', 'failure'], ['certificate', null]]);
});

test('a status that cannot be read says nothing and does not stop the watch', () => {
    const check = start({ status: () => { throw new Error('boom'); }, report: () => assert.fail('nothing to report'), every: 3600_000 });
    assert.doesNotThrow(check);
    stop();
});

test('mail: the real report() sends one mail per failure and one when it works again', () => {
    const mailService = require('../services/serverService/mailService');
    const sent = [];
    const original = mailService.notify;
    mailService.notify = (subject) => void sent.push(subject);
    try {
        const labels = { title: 'The certificate of HTTPS' };
        mailService.report('certificate-test', 'broken', labels);
        mailService.report('certificate-test', 'broken', labels);
        mailService.report('certificate-test', null, labels);
        assert.deepEqual(sent, ['The certificate of HTTPS failed', 'The certificate of HTTPS works again']);
    } finally {
        mailService.notify = original;
    }
});

const base = {
    uptime: () => 1, memory: () => 1, queries: () => ({}), answerMs: () => 1,
    zones: () => ({}), blocking: () => ({}), cache: () => ({}), queryLog: () => ({}),
};

test('metrics: days left and failing, only when there is a certificate', () => {
    const names = (sources) => collect(sources, { source: 's' }).filter((p) => p.name.startsWith('aesir.certificate'));
    assert.deepEqual(names(base), []);
    assert.deepEqual(names({ ...base, certificate: () => ({ certificate: null }) }), []);
    const points = names({ ...base, certificate: () => status({ lastError: 'x' }, 12) });
    assert.deepEqual(points.map((p) => [p.name, p.value, p.type, p.unit]), [
        ['aesir.certificate.days_left', 12, 'gauge', 'd'],
        ['aesir.certificate.renewal_failing', 1, 'gauge', undefined],
    ]);
});

test('the heimdall plugin logs a failing renewal', () => {
    assert.equal(problems({ ...base, certificate: () => status({ lastError: 'x' }) }).certificate, 'The certificate could not be renewed');
    assert.equal(problems({ ...base, certificate: () => status() }).certificate, null);
    assert.equal(problems(base).certificate, null);
});
