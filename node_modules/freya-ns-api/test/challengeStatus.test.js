// What the status of the certificate tells about the challenge: the records the owner of the names has to add.
const test = require('node:test');
const assert = require('node:assert/strict');

Object.assign(process.env, {
    FREYA_HTTPS_ENABLED: 'true',
    FREYA_HTTPS_CERT_SOURCE: 'letsencrypt',
    FREYA_HTTPS_DOMAINS: 'example.com,*.example.com,www.other.org',
    FREYA_ACME_CHALLENGE: 'dns-01',
    FREYA_ACME_DNS_PROVIDER: 'delegation',
    FREYA_ACME_DELEGATION_ZONE: 'acme.example.net',
    FREYA_LOGGING_ENABLED: 'false',
});

test('the delegation provider lists one CNAME per base name, without doubles', () => {
    const { challenge } = require('../services/certificateService/certificateService').status();
    assert.equal(challenge.type, 'dns-01');
    assert.equal(challenge.provider, 'delegation');
    assert.deepEqual(challenge.recordsToAdd, [
        { type: 'CNAME', name: '_acme-challenge.example.com', target: '_acme-challenge.example.com.acme.example.net' },
        { type: 'CNAME', name: '_acme-challenge.www.other.org', target: '_acme-challenge.www.other.org.acme.example.net' },
    ]);
});
