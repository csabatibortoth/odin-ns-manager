/* Odin NS Manager Server */

const named = require('njord-ns-server');
const config = require('./config/config');
const { logService, connectDb, startApi, stopApi } = require('./services/apiService/apiService');
const searchService = require('./services/serverService/searchService');
const statusService = require('./services/serverService/statusService');
const zoneService = require('./services/serverService/zoneService');

const nameServer = named.createServer({ name: config.serverName });

function listen(method, transport) {
    return new Promise((resolve, reject) => {
        nameServer.once('error', reject);
        nameServer[method](config.nsServerPort, config.serverIPAddress, () => {
            nameServer.off('error', reject);
            console.log(`DNS server started on ${config.serverIPAddress} port ${config.nsServerPort} (${transport})`);
            resolve();
        });
    });
}

nameServer.on('query', async (query) => {
    if (config.type === 'DEV') console.log('DNS Query: (%s) %s', query.type(), query.name());

    try {
        // Our own zones first; every other name is looked up at the upstream
        const own = await zoneService.resolve(query);
        if (!own) await searchService.resolve(query);
        nameServer.send(query);
        statusService.countQuery(own ? 'zones' : 'forwarded');
    } catch (err) {
        statusService.countQuery('failed');
        logService.addErrorLogErrorEntry(`DNS Query failed: (${query.type()}) ${query.name()} - `, err.stack || err);
    }
});

nameServer.on('clientError', (err) => {
    logService.addErrorLogErrorEntry('DNS client error: ', err.message || err);
});

nameServer.on('uncaughtException', (err) => {
    logService.addErrorLogErrorEntry('DNS server error: ', err.stack || err);
});

async function main() {
    await listen('listen', 'udp');
    if (config.nsTcpEnabled) await listen('listenTcp', 'tcp');

    // From here on an error of a socket is logged instead of stopping the start
    nameServer.on('error', (err) => {
        console.error('DNS server error:', err.message);
        logService.addErrorLogErrorEntry('DNS server error: ', err.stack || err);
    });

    console.log('Unknown names are looked up at %s', searchService.upstreamServers().join(', '));
    for (let target = 0; target < 3; target++) logService.addLogEntry(target, 0, 'Server Started! - ', config.version);

    // The DNS server keeps running, as a forwarder, when the database can not
    // be reached or the management API can not start
    let dbConnected = false;
    if (config.nsZonesEnabled || config.apiEnabled) {
        try {
            await connectDb();
            dbConnected = true;
        } catch (err) {
            console.error('Database is not reachable, no zones are served and the management API is not started:', err.message);
            logService.addErrorLogErrorEntry('Database connection failed: ', err.stack || err);
        }
    }

    if (dbConnected && config.nsZonesEnabled) {
        console.log('Serving %d zone(s) from the database', await zoneService.start());
    }

    if (dbConnected && config.apiEnabled) {
        try {
            await startApi({ onDnsChange: zoneService.refresh });
            if (config.uiEnabled) console.log('User interface is at the address above');
        } catch (err) {
            console.error('Management API failed to start:', err.message);
            logService.addErrorLogErrorEntry('Management API failed to start: ', err.stack || err);
        }
    }

    let stopping = false;
    const shutDown = async (signal) => {
        if (stopping) return;
        stopping = true;
        logService.addInfoLogBasicInfoEntry('Server stopping - ', signal);
        nameServer.close();
        zoneService.stop();
        await stopApi().catch(() => {});
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
