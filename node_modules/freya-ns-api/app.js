const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config/config');
const HttpError = require('./services/httpError');
const logService = require('./services/logService/logService');

function createApp() {
    const app = express();
    app.disable('x-powered-by');

    app.use(helmet());
    app.use(morgan(config.type === 'DEV' ? 'dev' : 'combined'));
    app.use(express.json({ limit: '100kb' }));
    app.use(express.urlencoded({ extended: false, limit: '100kb' }));

    const router = express.Router();
    router.get('/', (req, res) => {
        res.json({
            message: `Welcome to ${config.serverName} server by ${config.companyName}!`,
            version: config.version,
        });
    });
    router.use('/auth', require('./routes/authRoutes'));
    router.use('/users', require('./routes/userRoutes'));
    router.use('/zones', require('./routes/zoneRoutes'));
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
