const express = require('express');

const config = require('../config/config');
const { requireRole } = require('../services/authService/authService');
const monitoringService = require('../services/monitoringService/monitoringService');

// Signing in is enforced for the whole API in app.js. The queries show what every client looks up,
// so the whole of the monitoring is for these roles only.
const router = express.Router();
router.use(requireRole(...config.monitoringRoles));

router.get('/metrics', async (req, res) => {
    res.json(await monitoringService.getMetrics(req.query));
});

router.get('/top', async (req, res) => {
    res.json(await monitoringService.getTop(req.query));
});

router.get('/queries', async (req, res) => {
    res.json(await monitoringService.listQueries(req.query));
});

// The name server reports the queries it answered here, many at a time. A batch is larger than the
// other requests, so app.js leaves its body to be read here: after the role is checked.
router.post('/queries', express.json({ limit: '2mb' }), async (req, res) => {
    res.status(201).json(await monitoringService.recordQueries(req.body));
});

router.delete('/queries', async (req, res) => {
    res.json(await monitoringService.deleteQueries(req.query, req.user));
});

router.get('/clients', async (req, res) => {
    res.json(await monitoringService.listClients(req.query));
});

router.get('/clients/:clientId', async (req, res) => {
    res.json(await monitoringService.getClient(req.params.clientId));
});

router.patch('/clients/:clientId', async (req, res) => {
    res.json(await monitoringService.updateClient(req.params.clientId, req.body, req.user));
});

router.delete('/clients/:clientId', async (req, res) => {
    await monitoringService.deleteClient(req.params.clientId, req.user);
    res.status(204).end();
});

module.exports = router;
