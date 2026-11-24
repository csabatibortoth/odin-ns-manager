/* Odin NS Manager Server */

const named = require('njord-ns-server');
const config = require('./config/config');
const { logService, connectDb, startApi, stopApi } = require('./services/apiService/apiService');
const blockService = require('./services/serverService/blockService');
const queryLogService = require('./services/serverService/queryLogService');
const searchService = require('./services/serverService/searchService');
const statusService = require('./services/serverService/statusService');
const zoneService = require('./services/serverService/zoneService');
const syncService = require('./services/serverService/syncService');
const certificateWatch = require('./services/serverService/certificateWatch');
const accessService = require('./services/serverService/accessService');
const rateLimitService = require('./services/serverService/rateLimitService');
const pluginService = require('./services/pluginService/pluginService');

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

// The clients that the rate limit leaves alone: this machine, and (when switched on) the clients that may use the resolver
const exemptFromLimit = (address) => accessService.isOwn(address) || (config.nsRateLimitTrustResolvers && accessService.mayRecurse(address));

// Sends the answer, after the rate limit: nothing at all for a limited one, a short "ask again over TCP" for every n-th,
// and the same short answer for an answer that does not fit in a UDP packet. kind: 'answer', 'nxdomain' or 'refused'.
// kind null: no rate limit for this answer (forwarded and blocked ones: only the clients of the resolver list get them),
// only the size of the packet is checked. Returns 'limited' when the answer was dropped or cut short by the limit.
function sendLimited(query, kind) {
    const questionPacket = query._raw?.buf; // query.encode() below replaces it by the answer
    const verdict = kind === null ? 'send' : rateLimitService.decide({ config, exempt: exemptFromLimit }, {
        address: query._client?.address, transport: query.transport(), kind, name: query.name(), type: query.type(), zone: zoneService.zoneOf(query.name()),
    });
    if (verdict === 'drop') return 'limited';
    if (verdict === 'slip') {
        rateLimitService.truncate(query);
        nameServer.send(query);
        return 'limited';
    }
    if (query.transport() === 'udp') {
        query.encode();
        if (query._raw.len > rateLimitService.udpLimit(questionPacket)) {
            rateLimitService.truncate(query);
            rateLimitService.noteTruncated();
        }
    }
    nameServer.send(query);
    return null;
}

nameServer.on('query', async (query) => {
    if (config.type === 'DEV') console.log('DNS Query: (%s) %s', query.type(), query.name());

    const started = performance.now();
    try {
        // Our own zones and standalone records first, then the blocking;
        // every other name is looked up at the upstream
        let answered = await zoneService.resolve(query);
        // Not one of our names: that is a recursive question, and only the clients of the list may ask it
        // (otherwise this server is an open resolver). REFUSED, and nothing is written to the query log: anybody
        // on the internet can send these.
        if (!answered && !accessService.mayRecurse(query._client?.address)) {
            query.setError('erefuse');
            accessService.noteRefused(query._client?.address);
            statusService.countQuery(sendLimited(query, 'refused') ?? 'refused');
            return;
        }
        if (!answered && blockService.resolve(query)) answered = 'blocked';
        if (!answered) await searchService.resolve(query);
        const own = answered === 'zones' || answered === 'records';
        const limited = sendLimited(query, own ? (query._flags.rcode === 3 ? 'nxdomain' : 'answer') : null);
        const ms = performance.now() - started;
        statusService.countQuery(limited ?? (answered || 'forwarded'), ms);
        // A limited answer is not written to the query log: a flood from the internet must not fill the database
        if (limited) return;
        queryLogService.note(query, { blocked: answered === 'blocked', ms });
    } catch (err) {
        statusService.countQuery('failed');
        queryLogService.note(query, { failed: true });
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

    // The history of the dashboard
    statusService.start(() => ({ memory: process.memoryUsage().rss, cache: searchService.cacheSize() }));

    // The DNS server keeps running, as a forwarder, when the database can not
    // be reached or the management API can not start
    let dbConnected = false;
    try {
        await connectDb();
        dbConnected = true;
    } catch (err) {
        console.error('Database is not reachable, no zones are served and the management API is not started:', err.message);
        logService.addErrorLogErrorEntry('Database connection failed: ', err.stack || err);
    }

    if (dbConnected && config.nsZonesEnabled) {
        console.log('Serving %d zone(s) from the database', await zoneService.start());
    }

    if (dbConnected) {
        console.log('Blocking %d name(s) of the block lists', await blockService.start());
        queryLogService.start();
    }

    if (dbConnected && config.apiEnabled) {
        try {
            await startApi({
                onDnsChange: () => {
                    zoneService.refresh();
                    blockService.sync();
                    pluginService.emit('dnsChange');
                },
            });
            if (config.uiEnabled) console.log('User interface is at the address above');
            const running = await pluginService.start();
            if (config.pluginsEnabled.length) console.log('%d of %d plugin(s) are running', running, config.pluginsEnabled.length);
            // A mail when the certificate of HTTPS can not be renewed, or is about to expire
            certificateWatch.start();
            // A secondary copies what the primary has; the DNS server picks it up like any other change
            syncService.start((result) => {
                zoneService.refresh();
                blockService.sync();
                pluginService.emit('sync', result);
            });
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
        blockService.stop();
        statusService.stop();
        syncService.stop();
        certificateWatch.stop();
        await pluginService.stop().catch(() => {});
        await queryLogService.stop().catch(() => {});
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
