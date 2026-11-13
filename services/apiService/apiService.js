// The management API, the logging and the database connection of this server
// are the ones of freya-ns-api. That package reads its settings from FREYA_*
// environment variables when it is first loaded, so they are derived from our
// own config here, before anything of it is required. A FREYA_* variable that
// is already set wins.
const fs = require('fs');
const path = require('path');
const config = require('../../config/config');

const ROOT = path.resolve(__dirname, '../..');

// The files of the certificate are kept in this project, not in the package of
// freya-ns-api, which is replaced when it is updated.
const ownFile = (file) => path.resolve(ROOT, file);

// Before 2.3.0 the key and the certificate were the ones in the folder of
// freya-ns-api. They are still used when nothing was put in our own folder.
function certificateFile(file, legacy) {
    const own = ownFile(file);
    if (fs.existsSync(own)) return own;
    try {
        const old = path.resolve(path.dirname(require.resolve('freya-ns-api/package.json')), legacy);
        if (fs.existsSync(old)) return old;
    } catch {
        // The package is always there; our own file is the answer otherwise
    }
    return own;
}

const FREYA_ENV = {
    FREYA_SERVER_NAME: config.serverName,
    FREYA_COMPANY_NAME: config.companyName,
    FREYA_SECRET: config.secret,
    FREYA_TYPE: config.type,
    FREYA_HTTP_ENABLED: config.httpEnabled,
    FREYA_HTTP_PORT: config.httpServerPort,
    FREYA_HTTPS_ENABLED: config.httpsEnabled,
    FREYA_HTTPS_PORT: config.httpsServerPort,
    FREYA_HTTPS_CERT_SOURCE: config.httpsCertSource,
    FREYA_HTTPS_DOMAINS: config.httpsDomains,
    FREYA_HTTPS_KEY: certificateFile(config.httpsKeyFile, 'sslcert/server.key'),
    FREYA_HTTPS_CERT: certificateFile(config.httpsCertFile, 'sslcert/server.crt'),
    FREYA_HTTPS_KEY_PASSPHRASE: config.httpsKeyPassphrase,
    FREYA_ACME_EMAIL: config.acmeEmail,
    FREYA_ACME_DIRECTORY: config.acmeDirectory,
    FREYA_ACME_HTTP_PORT: config.acmeHttpPort,
    FREYA_ACME_FOLDER: ownFile(config.acmeFolder),
    FREYA_AUTH_ENABLED: config.authEnabled,
    FREYA_DNS_WRITE_ROLES: config.dnsWriteRoles,
    FREYA_MONITORING_ROLES: config.monitoringRoles,
    FREYA_QUERY_LOG_RETENTION_DAYS: config.queryLogRetentionDays,
    FREYA_METRICS_RETENTION_DAYS: config.metricsRetentionDays,
    FREYA_DOCS_ENABLED: config.docsEnabled,
    // The lists are downloaded by our own block service, every nsBlocklistRefresh hours
    FREYA_BLOCKLIST_REFRESH_CRON: '',
    FREYA_DB_ADDRESS: config.modelServerAddress,
    FREYA_DB_PORT: config.modelServerPort,
    FREYA_DB_USER: config.modelServerUser,
    FREYA_DB_PWD: config.modelServerPwd,
    FREYA_DB_NAME: config.modelServerDataBase,
    FREYA_LOGGING_ENABLED: config.logingEnabled,
    FREYA_LOG_FOLDER: config.basicLogFolder,
};

for (const [name, value] of Object.entries(FREYA_ENV)) {
    if (process.env[name] === undefined) process.env[name] = String(value);
}

const logService = require('freya-ns-api/services/logService/logService');

let httpServer = null;
let modelService = null;
let schedules = [];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// A request below these that is not a read may have changed what the DNS server answers
const DNS_PATHS = ['/api/zones', '/api/records', '/api/blocking', '/api/backup/import'];

// Connects to the database of the API, which also holds the zones, the records
// and the blocking the DNS server answers from. Mongoose is only loaded when it is needed.
async function connectDb() {
    if (modelService) return;
    const manager = require('freya-ns-api/model/mongoDB/manager');
    const connection = await manager.connectToDB();
    modelService = manager;

    // What an earlier release kept in its own form
    for (const moved of await require('./migration').migrate(connection)) {
        console.log('Carried over from the release before: %s', moved);
        logService.addInfoLogBasicInfoEntry('Carried over from the release before: ', moved);
    }
}

// Connects to the database and starts the HTTP(S) server of the API, which
// serves the user interface as well.
// Express is only loaded when the API is actually started.
// onDnsChange is called after every request that may have changed a zone, a record or the blocking.
async function startApi({ onDnsChange } = {}) {
    if (config.type !== 'DEV' && config.secret === 'Test') {
        throw new Error('Set ODIN_SECRET to a private value before running outside of DEV.');
    }

    await connectDb();
    const userService = require('freya-ns-api/services/userService/userService');
    const serverService = require('freya-ns-api/services/serverService/serverService');
    const { createApp } = require('freya-ns-api/app');

    await userService.ensureDefaultAdmin();
    // Our own routes and the user interface come first; everything else,
    // also what is not found, is answered by the application of freya-ns-api.
    const express = require('express');
    const app = express();
    app.disable('x-powered-by');
    app.use('/api/service', require('./serviceRoutes').createRouter());
    if (config.uiEnabled) app.use(require('../uiService/uiService').createUi());
    app.use(createApp());

    httpServer = await serverService.startServer((req, res) => {
        if (onDnsChange && !READ_METHODS.has(req.method) && DNS_PATHS.some((prefix) => req.url.startsWith(prefix))) {
            res.once('finish', onDnsChange);
        }
        app(req, res);
    });

    // What freya-ns-api does by the clock: the monitoring data that is too old
    // is deleted, and the certificate of HTTPS is renewed
    schedules = [
        require('freya-ns-api/services/blockingService/blockListService').startSchedule(),
        require('freya-ns-api/services/monitoringService/monitoringService').startSchedule(),
        require('freya-ns-api/services/certificateService/certificateService').startSchedule(),
    ].filter(Boolean);
    return httpServer;
}

async function stopApi() {
    await Promise.all(schedules.map((schedule) => schedule.stop()));
    schedules = [];
    if (httpServer) {
        await require('freya-ns-api/services/serverService/serverService').stopServer(httpServer);
        httpServer = null;
    }
    if (modelService) {
        await modelService.disconnectFromDB();
        modelService = null;
    }
}

module.exports = { logService, connectDb, startApi, stopApi };
