const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const cron = require('node-cron');

const config = require('../../config/config');
const HttpError = require('../httpError');
const logService = require('../logService/logService');
const dnsChallenge = require('./dnsChallenge');
const dnsProviders = require('./dnsProviders');
const delegationProvider = require('./delegationProvider');

// The certificate of the HTTPS listener. It comes from one of two sources:
//   letsencrypt - requested from Let's Encrypt (or another ACME directory) and renewed by the server itself;
//   custom      - a private key and a certificate from anywhere else, given as files or sent through the API.
// Either way the certificate can be replaced while the server runs: the connections that are open keep
// the one they started with, and every new one gets the new one.

const ROOT = path.resolve(__dirname, '../..');
const SOURCES = ['letsencrypt', 'custom'];
const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const CHALLENGE_PATH = '/.well-known/acme-challenge/';
const DAY = 24 * 60 * 60 * 1000;
// A certificate of Let's Encrypt is renewed when it has less than this left.
const RENEW_DAYS_BEFORE = 30;
// After a renewal that failed, the next one is not tried sooner than this: the limits of Let's Encrypt are strict.
const RETRY_AFTER = 6 * 60 * 60 * 1000;
// A wildcard (*.example.com) is accepted only when the names are proven through DNS.
const HOST_NAME = /^(?=.{1,253}$)(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

const source = config.httpsCertSource;
const resolve = (file) => path.resolve(ROOT, file);
const passphrase = () => (source === 'custom' && config.httpsKeyPassphrase) || undefined;

// What is being served: { key, cert, x509, stamp }.
let active = null;
let tlsServer = null;
let renewing = null;
const state = { lastCheckAt: null, lastError: null, lastFailureAt: 0, lastTest: null };

// ---- reading and checking ------------------------------------------------------------------------------

const validFrom = (x509) => new Date(x509.validFrom);
const validTo = (x509) => new Date(x509.validTo);
const expired = (x509) => validTo(x509) <= Date.now();
const daysLeft = (x509) => Math.floor((validTo(x509) - Date.now()) / DAY);
// A wildcard name is compared as written with the names of the certificate: it is not a host that can be checked.
const covers = (x509, domains) => {
    const names = (x509.subjectAltName || '').split(', ').map((name) => name.replace(/^DNS:/, '').toLowerCase());
    return domains.every((domain) => (dnsChallenge.isWildcard(domain) ? names.includes(domain) : x509.checkHost(domain) !== undefined));
};

// Checks a certificate (optionally followed by its chain) and its private key, both in PEM,
// and returns the certificate itself.
function inspect(certPem, keyPem) {
    const blocks = String(certPem).match(PEM_CERTIFICATE);
    if (!blocks) throw new HttpError(400, 'The certificate is not in PEM format');

    let chain;
    try {
        chain = blocks.map((block) => new crypto.X509Certificate(block));
    } catch {
        throw new HttpError(400, 'The certificate cannot be read');
    }

    let key;
    try {
        key = crypto.createPrivateKey({ key: String(keyPem), passphrase: passphrase() });
    } catch {
        throw new HttpError(400, 'The private key cannot be read: it must be in PEM format, and not protected by another passphrase');
    }
    if (!chain[0].checkPrivateKey(key)) throw new HttpError(400, 'The private key does not belong to the certificate');
    return chain[0];
}

async function readPair(keyFile, certFile) {
    const [key, cert, keyStat, certStat] = await Promise.all([
        fs.promises.readFile(keyFile, 'utf8'),
        fs.promises.readFile(certFile, 'utf8'),
        fs.promises.stat(keyFile),
        fs.promises.stat(certFile),
    ]);
    // The stamp tells whether the files were changed since they were read.
    return { key, cert, x509: inspect(cert, key), stamp: `${keyStat.mtimeMs}:${certStat.mtimeMs}` };
}

// Written beside the target and moved over it, so that a file is never half written.
async function writeFile(file, content, mode) {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporary, content, { mode });
    await fs.promises.rename(temporary, file);
}

async function writePair(keyFile, certFile, key, cert) {
    await writeFile(keyFile, key, 0o600);
    await writeFile(certFile, cert, 0o644);
}

// ---- custom ----------------------------------------------------------------------------------------------

const customFiles = () => ({ key: resolve(config.httpsKeyFile), cert: resolve(config.httpsCertFile) });

async function readCustom() {
    const files = customFiles();
    try {
        return await readPair(files.key, files.cert);
    } catch (err) {
        if (err.code === 'ENOENT') {
            throw new Error(
                `The certificate files were not found: ${files.key} and ${files.cert}. Put the private key and the ` +
                    'certificate there, or set FREYA_HTTPS_CERT_SOURCE=letsencrypt to have a certificate requested.'
            );
        }
        throw new Error(`The certificate in ${files.cert} cannot be used: ${err.message}`);
    }
}

// ---- Let's Encrypt ---------------------------------------------------------------------------------------

function acmeDirectoryUrl() {
    const directories = require('acme-client').directory.letsencrypt;
    const value = config.acmeDirectory;
    if (directories[value]) return directories[value];
    if (!URL.canParse(value) || !/^https?:$/.test(new URL(value).protocol)) {
        throw new Error(`FREYA_ACME_DIRECTORY must be production, staging, or the URL of an ACME directory: ${value}`);
    }
    return value;
}

function acmeDomains() {
    const domains = config.httpsDomains;
    if (!domains.length) {
        throw new Error(
            "FREYA_HTTPS_DOMAINS is required to get a certificate from Let's Encrypt: set it to the public name of this " +
                'server, e.g. dns.example.com. To use a certificate of your own instead, set FREYA_HTTPS_CERT_SOURCE=custom.'
        );
    }
    const invalid = domains.filter((domain) => !HOST_NAME.test(domain));
    if (invalid.length) {
        throw new Error(
            `FREYA_HTTPS_DOMAINS holds a name Let's Encrypt cannot check: ${invalid.join(', ')}. ` +
                'Only full public host names are possible (and wildcards like *.example.com with the dns-01 challenge): no IP addresses.'
        );
    }
    // Throws when a wildcard is combined with http-01, or the mode is unknown.
    dnsChallenge.planFor(config.acmeChallenge, domains);
    return domains;
}

// One folder per directory, so that the account and the certificate of staging and production never mix.
function acmeFiles() {
    const folder = path.join(resolve(config.acmeFolder), new URL(acmeDirectoryUrl()).host.replace(/[^a-z0-9.-]/gi, '_'));
    return {
        account: path.join(folder, 'account.key'),
        key: path.join(folder, 'server.key'),
        cert: path.join(folder, 'server.crt'),
    };
}

// Answers the HTTP-01 challenge: the certificate authority asks for a token over plain HTTP, on port 80
// of every name, to see that the name leads to this server. Nothing else is served, and only while
// a certificate is being requested.
function startChallengeServer(tokens) {
    const server = http.createServer((req, res) => {
        const url = req.url.split('?')[0];
        const answer = req.method === 'GET' && url.startsWith(CHALLENGE_PATH) && tokens.get(url.slice(CHALLENGE_PATH.length));
        if (!answer) return res.writeHead(404).end();
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(answer);
    });
    return new Promise((resolve, reject) => {
        server.once('error', (err) =>
            reject(
                new Error(
                    `port ${config.acmeHttpPort} cannot be opened to answer the challenge (${err.code}). Let's Encrypt connects to ` +
                        'port 80 of the name: free it, or forward it to FREYA_ACME_HTTP_PORT.'
                )
            )
        );
        server.listen(config.acmeHttpPort, () => resolve(server));
    });
}

// Places an order for the names of FREYA_HTTPS_DOMAINS and returns { key, cert } (PEM). Nothing is stored here:
// `directoryUrl` is the authority to ask, `accountFile` where the key of the account is kept, and `onStep(step, detail)`
// hears what happens (used by the test; the real renewal ignores it).
// `accountFile: null` uses an account that exists for this order only: the authority remembers which names an account
// has proven and does not ask again for them, so an account that is used twice would skip the very challenge that a test
// is meant to try.
async function placeOrder({ directoryUrl, accountFile, onStep = () => {} }) {
    const acme = require('acme-client');
    const domains = acmeDomains();

    let accountKey = accountFile ? await fs.promises.readFile(accountFile).catch(() => null) : null;
    if (!accountKey) {
        accountKey = await acme.crypto.createPrivateEcdsaKey();
        if (accountFile) await writeFile(accountFile, accountKey, 0o600);
    }

    const client = new acme.Client({ directoryUrl, accountKey });
    // A new key with every certificate.
    const [key, csr] = await acme.crypto.createCsr(
        { commonName: domains[0], altNames: domains },
        await acme.crypto.createPrivateEcdsaKey()
    );

    const plan = dnsChallenge.planFor(config.acmeChallenge, domains);
    // Fails before anything is requested when the provider is missing or unknown.
    const dnsHandlers = plan.needsDns
        ? dnsChallenge.createHandlers(dnsProviders.get(config.acmeDnsProvider), {
              waitSeconds: config.acmeDnsWait,
              settleSeconds: Math.min(Math.max(config.acmeDnsSettle, 0), 120),
              log: (message) => logService.addInfoLogBasicInfoEntry('ACME ', message),
              onEvent: onStep,
          })
        : null;

    const tokens = new Map();
    // Port 80 is opened only when a name is proven over HTTP.
    const challengeServer = plan.needsHttp ? await startChallengeServer(tokens) : null;
    onStep('order placed', domains.join(', '));
    let cert;
    try {
        cert = await client.auto({
            csr,
            email: config.acmeEmail || undefined,
            termsOfServiceAgreed: true,
            challengePriority: plan.priority,
            // The library would first ask for the token itself, which fails behind a router that
            // does not lead the public address back inside. The authority is the one that has to see it.
            skipChallengeVerification: true,
            challengeCreateFn: async (authz, challenge, keyAuthorization) => {
                if (challenge.type === 'dns-01' && dnsHandlers) return dnsHandlers.create(authz, challenge, keyAuthorization);
                if (challenge.type !== 'http-01' || !challengeServer) throw new Error(`The ${challenge.type} challenge is not enabled`);
                tokens.set(challenge.token, keyAuthorization);
                onStep('token served over HTTP', authz.identifier.value);
            },
            challengeRemoveFn: async (authz, challenge, keyAuthorization) => {
                if (challenge.type === 'dns-01' && dnsHandlers) return dnsHandlers.remove(authz, challenge, keyAuthorization);
                tokens.delete(challenge.token);
            },
        });
    } catch (err) {
        // A failure that is about timing says so, and what to do
        err.message += dnsChallenge.explainFailure(err.message);
        throw err;
    } finally {
        if (challengeServer) {
            challengeServer.close();
            challengeServer.closeAllConnections();
        }
        // A failed order must not leave a challenge record behind.
        const left = dnsHandlers ? await dnsHandlers.cleanup() : [];
        if (left.length) logService.addErrorLogErrorEntry('Challenge records could not be removed: ', left.join('; '));
        onStep(left.length ? 'challenge records left behind' : 'challenge records cleaned up', left.join('; '));
    }
    onStep('authority validated the names', domains.join(', '));
    return { key, cert };
}

async function obtain() {
    const domains = acmeDomains();
    const files = acmeFiles();
    const { key, cert } = await placeOrder({ directoryUrl: acmeDirectoryUrl(), accountFile: files.account });

    await writePair(files.key, files.cert, key, cert);
    logService.addInfoLogBasicInfoEntry('Certificate issued for ', domains.join(', '), ' by ', acmeDirectoryUrl());
    return readPair(files.key, files.cert);
}

// ---- the test --------------------------------------------------------------------------------------------

// The authority for the test: the staging directory of Let's Encrypt, whatever is configured for the real
// certificate. Another directory that was configured on purpose (not production) is used as it is.
function testDirectoryUrl() {
    const directories = require('acme-client').directory.letsencrypt;
    return config.acmeDirectory === 'production' ? directories.staging : acmeDirectoryUrl();
}

let testing = null;

// Runs the whole order, with the settings of the real certificate, against the staging authority: the names are
// proven in the way that is configured, a certificate is issued by the staging authority and thrown away.
// Nothing is installed, no file of the real certificate is touched, and the real account is not used. The answer
// lists every step that was reached; a failure ends the list with the reason. One test at a time.
function test(user) {
    requireHttps();
    if (source !== 'letsencrypt') throw new HttpError(409, "The certificate does not come from Let's Encrypt: there is nothing to test");
    testing ??= (async () => {
        const started = Date.now();
        const steps = [];
        const step = (name, detail = '', ok = true) => steps.push({ step: name, ok, detail, ms: Date.now() - started });
        const directory = testDirectoryUrl();
        const result = { ok: false, directory, challenge: { type: config.acmeChallenge, provider: config.acmeChallenge === 'http-01' ? null : config.acmeDnsProvider || null } };
        try {
            // A new account for every test, kept nowhere: names that an account has proven are not asked again
            step('test started', `${acmeDomains().join(', ')} at ${new URL(directory).host}, with a new account`);
            await placeOrder({ directoryUrl: directory, accountFile: null, onStep: (name, detail) => step(name, detail) });
            step('certificate issued by the test authority', 'thrown away, not installed');
            result.ok = true;
        } catch (err) {
            step('failed', err.message, false);
            result.error = err.message;
        }
        result.steps = steps;
        result.at = new Date();
        state.lastTest = { at: result.at, ok: result.ok, error: result.error ?? null, directory };
        logService.addInfoLogBasicInfoEntry('Certificate test ', result.ok ? 'passed' : `failed: ${result.error}`, ' (', directory, ') by ', user?.username);
        return result;
    })().finally(() => {
        testing = null;
    });
    return testing;
}

async function loadLetsEncrypt() {
    const domains = acmeDomains();
    const files = acmeFiles();
    // Nothing stored yet, or something that cannot be read: both mean that a certificate has to be requested.
    const stored = await readPair(files.key, files.cert).catch(() => null);
    if (stored && !expired(stored.x509) && covers(stored.x509, domains)) return stored;

    console.log(`Requesting a certificate for ${domains.join(', ')} ...`);
    try {
        return await obtain();
    } catch (err) {
        // A certificate that is still valid, but lacks a name that was added, is better than not starting.
        if (!stored || expired(stored.x509)) throw new Error(`Getting a certificate for ${domains.join(', ')} failed: ${err.message}`);
        failed(err);
        console.error(`Getting a certificate failed, the stored one is used: ${err.message}`);
        return stored;
    }
}

// ---- serving ---------------------------------------------------------------------------------------------

const tlsOptions = ({ key, cert }) => ({ key, cert, passphrase: passphrase() });

function failed(err) {
    state.lastError = err.message;
    state.lastFailureAt = Date.now();
    logService.addErrorLogErrorEntry('Certificate renewal failed: ', err.stack || err);
}

function apply(next) {
    active = next;
    state.lastError = null;
    state.lastFailureAt = 0;
    if (tlsServer) tlsServer.setSecureContext(tlsOptions(next));
}

// Called once, before the HTTPS listener starts: resolves to the options of https.createServer.
async function load() {
    if (!SOURCES.includes(source)) {
        throw new Error(`FREYA_HTTPS_CERT_SOURCE must be one of ${SOURCES.join(', ')}: ${source}`);
    }
    if (source === 'letsencrypt') {
        // A challenge record that a crash left behind; the database is connected before the certificate is loaded.
        await dnsProviders.removeLeftovers().catch((err) => console.error(`Old challenge records could not be removed: ${err.message}`));
    }
    active = source === 'custom' ? await readCustom() : await loadLetsEncrypt();
    if (expired(active.x509)) {
        const message = `The certificate expired on ${validTo(active.x509).toISOString()}. It is served as it is: replace it.`;
        console.error(message);
        logService.addErrorLogErrorEntry(message);
    }
    return tlsOptions(active);
}

// The listener whose certificate is replaced when a new one arrives.
function attach(server) {
    tlsServer = server;
}

// Gets a new certificate now: requested again from Let's Encrypt, or read again from the custom files.
// One at a time; a call that comes meanwhile waits for the one that runs.
function renew() {
    renewing ??= (async () => {
        state.lastCheckAt = new Date();
        try {
            apply(source === 'custom' ? await readCustom() : await obtain());
        } catch (err) {
            failed(err);
            throw err;
        }
    })().finally(() => {
        renewing = null;
    });
    return renewing;
}

// Runs on a schedule: renews the certificate of Let's Encrypt when it is due, and picks up
// the custom files when something else replaced them.
async function check() {
    if (!active || Date.now() - state.lastFailureAt < RETRY_AFTER) return;
    if (source === 'custom') {
        const files = customFiles();
        const stats = await Promise.all([fs.promises.stat(files.key), fs.promises.stat(files.cert)]).catch(() => null);
        if (!stats || `${stats[0].mtimeMs}:${stats[1].mtimeMs}` === active.stamp) return;
    } else if (daysLeft(active.x509) >= RENEW_DAYS_BEFORE && covers(active.x509, config.httpsDomains)) {
        state.lastCheckAt = new Date();
        return;
    }
    await renew();
}

function startSchedule() {
    if (!config.httpsEnabled) return null;
    // Every hour, away from the full hour, when the certificate authorities are the busiest.
    return cron.schedule('23 * * * *', () => {
        // The failure is logged where it happens.
        check().catch(() => {});
    });
}

// ---- for the API -----------------------------------------------------------------------------------------

const oneLine = (name) => name.split('\n').filter(Boolean).join(', ');

function challengeStatus() {
    const type = config.acmeChallenge;
    const provider = type === 'http-01' ? null : config.acmeDnsProvider || null;
    let recordsToAdd = [];
    if (provider === 'delegation' && config.acmeDelegationZone) {
        const wanted = config.httpsDomains.map((domain) => delegationProvider.recordToAdd(domain, config.acmeDelegationZone));
        recordsToAdd = [...new Map(wanted.map((record) => [record.name, record])).values()];
    }
    return { type, provider, recordsToAdd };
}

function status() {
    const x509 = active?.x509;
    return {
        enabled: config.httpsEnabled,
        source,
        domains: source === 'letsencrypt' ? config.httpsDomains : [],
        automaticRenewal: config.httpsEnabled && source === 'letsencrypt',
        certificate: x509
            ? {
                  subject: oneLine(x509.subject),
                  issuer: oneLine(x509.issuer),
                  altNames: (x509.subjectAltName || '')
                      .split(', ')
                      .filter(Boolean)
                      .map((name) => name.replace(/^(DNS|IP Address):/, '')),
                  validFrom: validFrom(x509).toISOString(),
                  validTo: validTo(x509).toISOString(),
                  daysLeft: daysLeft(x509),
                  serialNumber: x509.serialNumber,
                  fingerprint256: x509.fingerprint256,
              }
            : null,
        // What the owner of the names has to know: how they are proven, and the records to add at the real DNS.
        challenge: source === 'letsencrypt' ? challengeStatus() : null,
        lastCheckAt: state.lastCheckAt,
        lastError: state.lastError,
        lastTest: state.lastTest,
    };
}

function requireHttps() {
    if (!config.httpsEnabled || !active) throw new HttpError(409, 'HTTPS is not enabled: set FREYA_HTTPS_ENABLED=true');
}

// input: { certificate, privateKey }, both in PEM. The certificate may be followed by its chain.
async function upload(input, user) {
    requireHttps();
    if (source !== 'custom') {
        throw new HttpError(409, "The certificate comes from Let's Encrypt. Set FREYA_HTTPS_CERT_SOURCE=custom to use one of your own");
    }
    const { certificate, privateKey } = input ?? {};
    if (typeof certificate !== 'string' || typeof privateKey !== 'string' || !certificate || !privateKey) {
        throw new HttpError(400, 'certificate and privateKey are required, both in PEM format');
    }

    const x509 = inspect(certificate, privateKey);
    if (expired(x509)) throw new HttpError(400, `The certificate expired on ${validTo(x509).toISOString()}`);
    if (validFrom(x509) > Date.now()) throw new HttpError(400, `The certificate is not valid before ${validFrom(x509).toISOString()}`);

    const files = customFiles();
    await writePair(files.key, files.cert, `${privateKey.trim()}\n`, `${certificate.trim()}\n`);
    apply(await readPair(files.key, files.cert));
    logService.addInfoLogBasicInfoEntry('Certificate replaced by ', user?.username, ': ', oneLine(x509.subject));
    return status();
}

async function renewNow(user) {
    requireHttps();
    try {
        await renew();
    } catch (err) {
        // Not a failure of this server, but of what it asked: the authority, or the files.
        throw new HttpError(source === 'custom' ? 409 : 502, err.message);
    }
    logService.addInfoLogBasicInfoEntry('Certificate renewed on the request of ', user?.username);
    return status();
}

module.exports = {
    load,
    attach,
    renew,
    check,
    startSchedule,
    status,
    upload,
    renewNow,
    test,
};
