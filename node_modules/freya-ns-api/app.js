const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config/config');
const { authenticate } = require('./services/authService/authService');
const HttpError = require('./services/httpError');
const logService = require('./services/logService/logService');

// These take a body that is larger than the limit of the rest, and read it in their own route:
// after the token and the role are checked, so that nobody else can make the server parse it.
const READS_OWN_BODY = new Set(['/api/backup/import', '/api/monitoring/queries']);

function createApp() {
    const app = express();
    app.disable('x-powered-by');

    app.use(helmet());
    app.use(morgan(config.type === 'DEV' ? 'dev' : 'combined'));
    const parseJson = express.json({ limit: '100kb' });
    app.use((req, res, next) => (READS_OWN_BODY.has(req.path.toLowerCase().replace(/\/$/, '')) ? next() : parseJson(req, res, next)));
    app.use(express.urlencoded({ extended: false, limit: '100kb' }));

    const router = express.Router();
    if (config.docsEnabled) router.use('/docs', require('./routes/docsRoutes'));
    // Logging in is the only thing that can be done without a token; the rest of /auth checks it by itself.
    router.use('/auth', require('./routes/authRoutes'));

    // Everything below this line requires signing in, including the paths that do not exist.
    router.use(authenticate);
    router.get('/', (req, res) => {
        res.json({
            message: `Welcome to ${config.serverName} server by ${config.companyName}!`,
            version: config.version,
        });
    });
    router.use('/users', require('./routes/userRoutes'));
    router.use('/zones', require('./routes/zoneRoutes'));
    router.use('/records', require('./routes/recordRoutes'));
    router.use('/blocking', require('./routes/blockingRoutes'));
    router.use('/monitoring', require('./routes/monitoringRoutes'));
    router.use('/backup', require('./routes/backupRoutes'));
    router.use('/certificate', require('./routes/certificateRoutes'));
    app.use('/api', router);

    app.use((req, res, next) => next(new HttpError(404, 'Not found')));
    app.use(errorHandler);

    return app;
}

// Express 5 forwards rejected promises from async handlers here.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    let details = err.details;

    if (err.name === 'ValidationError' && err.errors) {
        status = 400;
        message = 'Validation failed';
        details = Object.fromEntries(Object.entries(err.errors).map(([field, e]) => [field, e.message]));
    } else if (err.code === 11000) {
        status = 409;
        message = `Already in use: ${Object.keys(err.keyPattern || {}).join(', ') || 'value'}`;
    }

    if (status >= 500) {
        logService.addErrorLogErrorEntry(`${req.method} ${req.originalUrl} - `, err.stack || err);
        if (config.type === 'DEV') console.error(err);
        message = 'Internal server error';
        details = undefined;
    }

    res.status(status).json({ error: message, details });
}

module.exports = { createApp };
