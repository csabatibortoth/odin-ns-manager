const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const config = require('../../config/config');
const logService = require('../logService/logService');

const ROOT = path.resolve(__dirname, '../..');

function listen(server, port, scheme) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
            server.off('error', reject);
            console.log(`Magic happens at ${scheme}://localhost:${server.address().port}`);
            resolve(server);
        });
    });
}

function startHTTPServer(app, port) {
    return listen(http.createServer(app), port, 'http');
}

async function startHTTPSServer(app, port) {
    const [key, cert] = await Promise.all([
        fs.promises.readFile(path.resolve(ROOT, config.httpsKeyFile), 'utf8'),
        fs.promises.readFile(path.resolve(ROOT, config.httpsCertFile), 'utf8'),
    ]);
    return listen(https.createServer({ key, cert }, app), port, 'https');
}

// Neither HTTP nor HTTPS is enabled: there is nothing to serve, so report and stop.
function startHTTPDefaultServer() {
    const message = 'Error! HTTP or HTTPS must be enabled in order to run!';
    console.error(message);
    logService.addErrorLogErrorEntry(message);
    logService.addInfoLogBasicInfoEntry('System Terminated from an Error, for further info check error log!');
    throw new Error(message);
}

function startServer(app) {
    if (config.httpsEnabled) return startHTTPSServer(app, config.httpsServerPort);
    if (config.httpEnabled) return startHTTPServer(app, config.httpServerPort);
    return startHTTPDefaultServer();
}

// Stop accepting connections, let in-flight requests finish, drop idle keep-alive sockets.
function stopServer(server) {
    return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
    });
}

module.exports = {
    startServer,
    stopServer,
    startHTTPDefaultServer,
    startHTTPServer,
    startHTTPSServer,
};
