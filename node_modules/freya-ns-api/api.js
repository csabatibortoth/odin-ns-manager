/* Freya NS API v2.0.0 Server */

const config = require('./config/config');
const logService = require('./services/logService/logService');
const serverService = require('./services/serverService/serverService');
const userService = require('./services/userService/userService');
const { createApp } = require('./app');

function loadModelService() {
    switch (config.modelServerType) {
        case 'MNG':
        default:
            return require('./model/mongoDB/manager');
    }
}

async function main() {
    if (config.type !== 'DEV' && config.secret === 'Test') {
        throw new Error('Set FREYA_SECRET to a private value before running outside of DEV.');
    }

    const modelService = loadModelService();
    await modelService.connectToDB();
    await userService.ensureDefaultAdmin();

    const server = await serverService.startServer(createApp());
    logService.serverStartedLog();

    let stopping = false;
    const shutDown = async (signal) => {
        if (stopping) return;
        stopping = true;
        logService.addInfoLogBasicInfoEntry('Server stopping - ', signal);
        await serverService.stopServer(server);
        await modelService.disconnectFromDB();
        process.exit(0);
    };
    process.on('SIGINT', shutDown);
    process.on('SIGTERM', shutDown);
}

main().catch((err) => {
    console.error('Server failed to start:', err.message);
    logService.addErrorLogErrorEntry('Server failed to start: ', err.stack || err);
    // Give the file logger a moment to flush before exiting.
    setTimeout(() => process.exit(1), 500);
});
