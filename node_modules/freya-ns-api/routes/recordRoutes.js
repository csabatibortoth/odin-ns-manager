const express = require('express');

const config = require('../config/config');
const { requireRole } = require('../services/authService/authService');
const recordService = require('../services/dnsService/recordService');

// The standalone records: those that belong to no zone. The records of a zone are in zoneRoutes.js.
// Signing in is enforced for the whole API in app.js.
const router = express.Router();
const canWrite = requireRole(...config.dnsWriteRoles);

router.get('/', async (req, res) => {
    res.json(await recordService.listRecords(null, req.query));
});

router.post('/', canWrite, async (req, res) => {
    const record = await recordService.createRecord(null, req.body, req.user);
    res.status(201).location(`${req.baseUrl}/${record.id}`).json(record);
});

router.get('/:recordId', async (req, res) => {
    res.json(await recordService.getRecord(null, req.params.recordId));
});

router.patch('/:recordId', canWrite, async (req, res) => {
    res.json(await recordService.updateRecord(null, req.params.recordId, req.body, req.user));
});

router.delete('/:recordId', canWrite, async (req, res) => {
    await recordService.deleteRecord(null, req.params.recordId, req.user);
    res.status(204).end();
});

module.exports = router;
