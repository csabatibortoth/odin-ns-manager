// The settings: environment before the settings file before the defaults, and
// what the admins may change while the server runs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'odin-config-')), 'settings.json');
fs.writeFileSync(file, JSON.stringify({ nsCacheMaxEntries: 500, nsServerPort: 'fifty-three', secret: 'from-file', httpServerPort: 8080, nsBlockMode: 'nxdomain' }));

for (const name of Object.keys(process.env)) if (name.startsWith('ODIN_')) delete process.env[name];
process.env.ODIN_SETTINGS_FILE = file;
process.env.ODIN_HTTP_PORT = '9000';
process.env.ODIN_QUERY_LOG_RETENTION_DAYS = '0';
process.env.ODIN_NS_BLOCKING_ENABLED = 'false';

const config = require('../config/config');
const setting = (key) => config.describe().groups.flatMap((group) => group.settings).find((item) => item.key === key);

after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));

test('the environment comes before the settings file, and the file before the defaults', () => {
    assert.equal(config.httpServerPort, 9000);
    assert.equal(setting('httpServerPort').source, 'environment');
    assert.equal(config.nsCacheMaxEntries, 500);
    assert.equal(setting('nsCacheMaxEntries').source, 'saved');
    assert.equal(config.nsZoneRefresh, 10);
    assert.equal(setting('nsZoneRefresh').source, 'default');
});

test('what is not valid in the settings file is left out', () => {
    assert.equal(config.nsServerPort, 53);
    assert.equal(config.secret, 'Test');
});

test('zero is a value of the environment', () => {
    assert.equal(config.queryLogRetentionDays, 0);
    assert.equal(setting('queryLogRetentionDays').source, 'environment');
});

test('the settings that moved to the database are kept apart, to be carried over', () => {
    assert.deepEqual(config.legacy, { nsBlockMode: 'nxdomain', nsBlockingEnabled: false });
    assert.equal(config.nsBlockMode, undefined);
    assert.equal(setting('nsBlockMode'), undefined);
});

test('secrets are not described', () => {
    assert.equal('value' in setting('secret'), false);
    assert.equal('value' in setting('modelServerPwd'), false);
    assert.equal('value' in setting('httpsKeyPassphrase'), false);
});

test('a live setting changes at once, and is saved', () => {
    const seen = [];
    config.onChange((keys) => seen.push(...keys));

    assert.deepEqual(config.update({ nsUpstreamServers: '9.9.9.9, 192.0.2.1:5353', nsNegativeCacheTtl: 60 }), ['nsUpstreamServers', 'nsNegativeCacheTtl']);
    assert.deepEqual(config.nsUpstreamServers, ['9.9.9.9', '192.0.2.1:5353']);
    assert.equal(config.nsNegativeCacheTtl, 60);
    assert.deepEqual(seen, ['nsUpstreamServers', 'nsNegativeCacheTtl']);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).nsNegativeCacheTtl, 60);
    assert.equal(config.describe().restartNeeded, false);
});

test('the other settings are saved, and wait for a restart', () => {
    assert.deepEqual(config.update({ nsServerPort: 5353 }), ['nsServerPort']);
    assert.equal(config.nsServerPort, 53);
    assert.equal(setting('nsServerPort').pending, 5353);
    assert.equal(config.describe().restartNeeded, true);

    // null brings a setting back to its default
    assert.deepEqual(config.update({ nsServerPort: null }), ['nsServerPort']);
    assert.equal(config.describe().restartNeeded, false);
});

test('nothing is changed when one of the values is not valid', () => {
    assert.throws(
        () => config.update({ nsNegativeCacheTtl: 90, nsUpstreamTries: 0, nsUpstreamServers: ['not an address'], dnsWriteRoles: ['root'], unknown: 1 }),
        (err) => {
            assert.equal(err.status, 400);
            assert.deepEqual(Object.keys(err.details).sort(), ['dnsWriteRoles', 'nsUpstreamServers', 'nsUpstreamTries', 'unknown']);
            return true;
        }
    );
    assert.equal(config.nsNegativeCacheTtl, 60);
});

test('what would lock everybody out is refused', () => {
    const refused = (changes, key) => assert.throws(() => config.update(changes), (err) => Boolean(err.details[key]));
    refused({ httpServerPort: 8081 }, 'httpServerPort'); // fixed by the environment
    refused({ secret: 'something' }, 'secret'); // not for the user interface
    refused({ uiEnabled: false }, 'uiEnabled');
    refused({ type: 'PROD' }, 'type'); // the secret is still the one of the development
    refused({ httpEnabled: false }, 'httpEnabled'); // HTTPS is not enabled either
});

test('the DNS challenge of Let\'s Encrypt: defaults change nothing, the token is write-only', () => {
    assert.equal(config.acmeChallenge, 'http-01');
    assert.equal(config.acmeDnsProvider, 'zones');
    assert.equal(config.acmeCloudflareToken, '');
    assert.equal('value' in setting('acmeCloudflareToken'), false);
    assert.equal(setting('acmeCloudflareToken').secret, true);
    // a path from the browser would let an admin send the first line of any file to Cloudflare: only the environment
    assert.throws(() => config.update({ acmeCloudflareTokenFile: '/etc/passwd' }), (err) => Boolean(err.details.acmeCloudflareTokenFile));
});

test('a wildcard needs the DNS challenge; the delegation needs its zone; a token is saved but never shown', () => {
    const refused = (changes, key) => assert.throws(() => config.update(changes), (err) => Boolean(err.details[key]));
    config.update({ httpsCertSource: 'letsencrypt' });
    refused({ httpsDomains: ['*.example.com'] }, 'acmeChallenge');
    refused({ httpsDomains: ['not a name'] }, 'httpsDomains');
    refused({ httpsDomains: ['*.example.com'], acmeChallenge: 'dns-01', acmeDnsProvider: 'delegation' }, 'acmeDelegationZone');

    assert.deepEqual(
        config.update({ httpsDomains: ['example.com', '*.example.com'], acmeChallenge: 'dns-01', acmeDnsProvider: 'delegation', acmeDelegationZone: 'acme.example.net' }).sort(),
        ['acmeChallenge', 'acmeDelegationZone', 'acmeDnsProvider', 'httpsDomains']
    );
    config.update({ acmeDnsProvider: 'cloudflare', acmeCloudflareToken: 'cf-secret-token' });
    assert.equal(JSON.stringify(config.describe()).includes('cf-secret-token'), false);
    assert.equal(setting('acmeCloudflareToken').isSet, true);
    // saved for the next start, in a file only the owner can read
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).acmeCloudflareToken, 'cf-secret-token');
    assert.equal(fs.statSync(file).mode & 0o077, 0);
    // empty keeps nothing: null removes the setting
    config.update({ acmeCloudflareToken: null, acmeChallenge: null, acmeDnsProvider: null, acmeDelegationZone: null, httpsDomains: null });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).acmeCloudflareToken, undefined);
});

test('RFC 2136 and the hook: the key secret is write-only, the key file and the hook program are environment only, the settings must be complete', () => {
    const refused = (changes, key) => assert.throws(() => config.update(changes), (err) => Boolean(err.details[key]));
    assert.equal(config.acmeRfc2136KeyAlgorithm, 'hmac-sha256');
    assert.equal(setting('acmeRfc2136KeySecret').secret, true);
    assert.equal('value' in setting('acmeRfc2136KeySecret'), false);
    // a path from the browser would make the server execute any program, or read any file: only the environment
    refused({ acmeHook: '/bin/sh' }, 'acmeHook');
    refused({ acmeRfc2136KeyFile: '/etc/passwd' }, 'acmeRfc2136KeyFile');
    // checks of the single values
    refused({ acmeRfc2136Server: 'bad host' }, 'acmeRfc2136Server');
    refused({ acmeRfc2136Zone: 'not a zone' }, 'acmeRfc2136Zone');
    refused({ acmeRfc2136KeyName: 'bad name;' }, 'acmeRfc2136KeyName');
    refused({ acmeRfc2136KeyAlgorithm: 'hmac-md5' }, 'acmeRfc2136KeyAlgorithm');
    refused({ acmeRfc2136KeySecret: 'not base64 !' }, 'acmeRfc2136KeySecret');
    refused({ acmeHookTimeout: 301 }, 'acmeHookTimeout');
    // together
    config.update({ httpsCertSource: 'letsencrypt', httpsDomains: ['example.com'], acmeChallenge: 'dns-01' });
    refused({ acmeDnsProvider: 'rfc2136', acmeRfc2136Server: 'ns1.example.com' }, 'acmeRfc2136Zone');
    refused({ acmeDnsProvider: 'rfc2136', acmeRfc2136Server: 'ns1.example.com', acmeRfc2136Zone: 'example.com', acmeRfc2136KeyName: 'acme-key' }, 'acmeRfc2136KeySecret');
    refused({ acmeDnsProvider: 'hook' }, 'acmeDnsProvider'); // no ODIN_ACME_HOOK in the environment
    const secret = Buffer.alloc(32, 7).toString('base64');
    assert.ok(config.update({ acmeDnsProvider: 'rfc2136', acmeRfc2136Server: 'ns1.example.com:53', acmeRfc2136Zone: 'example.com', acmeRfc2136KeyName: 'acme-key', acmeRfc2136KeySecret: secret }).includes('acmeDnsProvider'));
    assert.equal(JSON.stringify(config.describe()).includes(secret), false);
    assert.equal(setting('acmeRfc2136KeySecret').isSet, true);
    assert.equal(fs.statSync(file).mode & 0o077, 0);
    config.update({ acmeDnsProvider: null, acmeRfc2136Server: null, acmeRfc2136Zone: null, acmeRfc2136KeyName: null, acmeRfc2136KeySecret: null, acmeChallenge: null, httpsDomains: null });
});
