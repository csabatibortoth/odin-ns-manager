// Serves the user interface: the pages of the ui folder, and the Athena UI
// framework and jQuery it is built on, straight from their packages. Nothing
// is loaded from another server.
const path = require('path');
const express = require('express');

const UI_FOLDER = path.resolve(__dirname, '../../ui');
const ATHENA_FOLDER = path.join(path.dirname(require.resolve('athena-ui-js/package.json')), 'src');
const JQUERY_FOLDER = path.dirname(require.resolve('jquery'));

// The interface needs nothing but its own files, so nothing else is allowed
const CONTENT_SECURITY_POLICY = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
].join('; ');

function createUi() {
    const router = express.Router();

    router.use((req, res, next) => {
        // The API answers everything below /api itself
        if (req.path === '/api' || req.path.startsWith('/api/')) return next('router');
        res.set({
            'Content-Security-Policy': CONTENT_SECURITY_POLICY,
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer',
            'Cross-Origin-Resource-Policy': 'same-origin',
        });
        next();
    });

    router.use('/vendor/athena-ui', express.static(ATHENA_FOLDER, { index: false }));
    router.use('/vendor/jquery', express.static(JQUERY_FOLDER, { index: false }));
    router.use(express.static(UI_FOLDER));

    return router;
}

module.exports = { createUi };
