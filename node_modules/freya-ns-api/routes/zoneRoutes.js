const express = require('express');

const config = require('../config/config');
const { authenticate, requireRole } = require('../services/authService/authService');
const recordService = require('../services/dnsService/recordService');
const zoneService = require('../services/dnsService/zoneService');

const router = express.Router();
// Every signed-in user may read the zones and records; only these roles may change them.
const canWrite = requireRole(...config.dnsWriteRoles);

router.use(authenticate);

router.get('/', async (req, res) => {
    res.json(await zoneService.listZones(req.query));
});

router.post('/', canWrite, async (req, res) => {
    const zone = await zoneService.createZone(req.body, req.user);
    res.status(201).location(`${req.baseUrl}/${zone.id}`).json(zone);
});

router.get('/:zoneId', async (req, res) => {
    res.json(await zoneService.getZone(req.params.zoneId));
});

router.patch('/:zoneId', canWrite, async (req, res) => {
    res.json(await zoneService.updateZone(req.params.zoneId, req.body, req.user));
});

router.delete('/:zoneId', canWrite, async (req, res) => {
    await zoneService.deleteZone(req.params.zoneId, req.user);
    res.status(204).end();
});

router.get('/:zoneId/records', async (req, res) => {
    res.json(await recordService.listRecords(req.params.zoneId, req.query));
});

router.post('/:zoneId/records', canWrite, async (req, res) => {
    const record = await recordService.createRecord(req.params.zoneId, req.body, req.user);
    res.status(201).location(`${req.baseUrl}/${record.zone}/records/${record.id}`).json(record);
});

router.get('/:zoneId/records/:recordId', async (req, res) => {
    res.json(await recordService.getRecord(req.params.zoneId, req.params.recordId));
});

router.patch('/:zoneId/records/:recordId', canWrite, async (req, res) => {
    res.json(await recordService.updateRecord(req.params.zoneId, req.params.recordId, req.body, req.user));
});

router.delete('/:zoneId/records/:recordId', canWrite, async (req, res) => {
    await recordService.deleteRecord(req.params.zoneId, req.params.recordId, req.user);
    res.status(204).end();
});

module.exports = router;
