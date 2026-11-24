// The test of the certificate setup is for Let's Encrypt only, and uses a directory that was configured on purpose.
const test = require('node:test');
const assert = require('node:assert/strict');

Object.assign(process.env, {
    FREYA_HTTPS_ENABLED: 'true',
    FREYA_HTTPS_CERT_SOURCE: 'custom',
    FREYA_HTTPS_KEY: '/nonexistent/server.key',
    FREYA_HTTPS_CERT: '/nonexistent/server.crt',
    FREYA_LOGGING_ENABLED: 'false',
});

test('a certificate of your own has nothing to test', () => {
    const service = require('../services/certificateService/certificateService');
    // no certificate is served here (the files do not exist), so HTTPS is "not enabled" for the service: refused either way
    assert.throws(() => service.test({ username: 'a' }), (err) => err.status === 409);
});
