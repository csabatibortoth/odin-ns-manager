const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const cron = require('node-cron');

const config = require('../../config/config');
const HttpError = require('../httpError');
const logService = require('../logService/logService');

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
const HOST_NAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

const source = config.httpsCertSource;
const resolve = (file) => path.resolve(ROOT, file);
const passphrase = () => (source === 'custom' && config.httpsKeyPassphrase) || undefined;

// What is being served: { key, cert, x509, stamp }.
let active = null;
let tlsServer = null;
let renewing = null;
const state = { lastCheckAt: null, lastError: null, lastFailureAt: 0 };

// ---- reading and checking ------------------------------------------------------------------------------

const validFrom = (x509) => new Date(x509.validFrom);
const validTo = (x509) => new Date(x509.validTo);
const expired = (x509) => validTo(x509) <= Date.now();
const daysLeft = (x509) => Math.floor((validTo(x509) - Date.now()) / DAY);
const covers = (x509, domains) => domains.every((domain) => x509.checkHost(domain) !== undefined);

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
            `FREYA_HTTPS_DOMAINS holds a name Let's Encrypt cannot check over HTTP: ${invalid.join(', ')}. ` +
                'Only full public host names are possible: no wildcards, no IP addresses.'
        );
    }
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

async function obtain() {
    const acme = require('acme-client');
    const domains = acmeDomains();
    const files = acmeFiles();

    let accountKey = await fs.promises.readFile(files.account).catch(() => null);
    if (!accountKey) {
        accountKey = await acme.crypto.createPrivateEcdsaKey();
        await writeFile(files.account, accountKey, 0o600);
    }

    const client = new acme.Client({ directoryUrl: acmeDirectoryUrl(), accountKey });
    // A new key with every certificate.
    const [key, csr] = await acme.crypto.createCsr(
        { commonName: domains[0], altNames: domains },
        await acme.crypto.createPrivateEcdsaKey()
    );

    const tokens = new Map();
    const challengeServer = await startChallengeServer(tokens);
    let cert;
    try {
        cert = await client.auto({
            csr,
            email: config.acmeEmail || undefined,
            termsOfServiceAgreed: true,
            challengePriority: ['http-01'],
            // The library would first ask for the token itself, which fails behind a router that
            // does not lead the public address back inside. The authority is the one that has to see it.
            skipChallengeVerification: true,
            challengeCreateFn: async (authz, challenge, keyAuthorization) => {
                if (challenge.type !== 'http-01') throw new Error(`Only the http-01 challenge is supported, not ${challenge.type}`);
                tokens.set(challenge.token, keyAuthorization);
            },
            challengeRemoveFn: async (authz, challenge) => {
                tokens.delete(challenge.token);
            },
        });
    } finally {
        challengeServer.close();
        challengeServer.closeAllConnections();
    }

    await writePair(files.key, files.cert, key, cert);
    logService.addInfoLogBasicInfoEntry('Certificate issued for ', domains.join(', '), ' by ', acmeDirectoryUrl());
    return readPair(files.key, files.cert);
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
        lastCheckAt: state.lastCheckAt,
        lastError: state.lastError,
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
};
