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

// Connects to the database and starts the HTTP(S) server of the API.
// Express and Mongoose are only loaded when the API is actually started.
async function startApi() {
    if (config.type !== 'DEV' && config.secret === 'Test') {
        throw new Error('Set ODIN_SECRET to a private value before running outside of DEV.');
    }

    modelService = require('freya-ns-api/model/mongoDB/manager');
    const userService = require('freya-ns-api/services/userService/userService');
    const serverService = require('freya-ns-api/services/serverService/serverService');
    const { createApp } = require('freya-ns-api/app');

    await modelService.connectToDB();
    await userService.ensureDefaultAdmin();
    httpServer = await serverService.startServer(createApp());
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

module.exports = { logService, startApi, stopApi };
