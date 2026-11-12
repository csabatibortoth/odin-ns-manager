// The management API, the logging and the database connection of this server
// are the ones of freya-ns-api. That package reads its settings from FREYA_*
// environment variables when it is first loaded, so they are derived from our
// own config here, before anything of it is required. A FREYA_* variable that
// is already set wins.
const config = require('../../config/config');

const FREYA_ENV = {
    FREYA_SERVER_NAME: config.serverName,
    FREYA_COMPANY_NAME: config.companyName,
    FREYA_SECRET: config.secret,
    FREYA_TYPE: config.type,
    FREYA_HTTP_ENABLED: config.httpEnabled,
    FREYA_HTTP_PORT: config.httpServerPort,
    FREYA_HTTPS_ENABLED: config.httpsEnabled,
    FREYA_HTTPS_PORT: config.httpsServerPort,
    FREYA_AUTH_ENABLED: config.authEnabled,
    FREYA_DNS_WRITE_ROLES: config.dnsWriteRoles,
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

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// A request below these that is not a read may have changed what the DNS server answers
const DNS_PATHS = ['/api/zones', '/api/records'];

// Connects to the database of the API, which also holds the zones and records
// the DNS server answers from. Mongoose is only loaded when it is needed.
async function connectDb() {
    if (modelService) return;
    const manager = require('freya-ns-api/model/mongoDB/manager');
    // Our own model has to be known before the connection is made, for its indexes
    require('../../model/mongoDB/standaloneRecordModel');
    await manager.connectToDB();
    modelService = manager;
}

// Connects to the database and starts the HTTP(S) server of the API, which
// serves the user interface as well.
// Express is only loaded when the API is actually started.
// onDnsChange is called after every request that may have changed a zone or a record.
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
    app.use('/api/records', require('./recordRoutes').createRouter());
    if (config.uiEnabled) app.use(require('../uiService/uiService').createUi());
    app.use(createApp());

    httpServer = await serverService.startServer((req, res) => {
        if (onDnsChange && !READ_METHODS.has(req.method) && DNS_PATHS.some((path) => req.url.startsWith(path))) {
            res.once('finish', onDnsChange);
        }
        app(req, res);
    });
    return httpServer;
}

async function stopApi() {
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
