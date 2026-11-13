const express = require('express');

const config = require('../config/config');
const { requireRole } = require('../services/authService/authService');
const blockingService = require('../services/blockingService/blockingService');
const blockListService = require('../services/blockingService/blockListService');
const blockRuleService = require('../services/blockingService/blockRuleService');

// Signing in is enforced for the whole API in app.js.
const router = express.Router();
// Every signed-in user may read the blocking; only these roles may change it.
const canWrite = requireRole(...config.dnsWriteRoles);

router.get('/settings', async (req, res) => {
    res.json(await blockingService.getSettings());
});

router.patch('/settings', canWrite, async (req, res) => {
    res.json(await blockingService.updateSettings(req.body, req.user));
});

router.get('/check', async (req, res) => {
    res.json(await blockingService.check(req.query.domain));
});

router.get('/lists', async (req, res) => {
    res.json(await blockListService.listLists(req.query));
});

router.post('/lists', canWrite, async (req, res) => {
    const list = await blockListService.createList(req.body, req.user);
    res.status(201).location(`${req.baseUrl}/lists/${list.id}`).json(list);
});

// Answers at once; the lists are downloaded in the background.
router.post('/lists/refresh', canWrite, async (req, res) => {
    res.status(202).json(await blockListService.refreshAllInBackground());
});

router.get('/lists/:listId', async (req, res) => {
    res.json(await blockListService.getList(req.params.listId));
});

router.patch('/lists/:listId', canWrite, async (req, res) => {
    res.json(await blockListService.updateList(req.params.listId, req.body, req.user));
});

router.delete('/lists/:listId', canWrite, async (req, res) => {
    await blockListService.deleteList(req.params.listId, req.user);
    res.status(204).end();
});

// Answers when the download is done; its outcome is the status of the list.
router.post('/lists/:listId/refresh', canWrite, async (req, res) => {
    res.json(await blockListService.refreshList(req.params.listId));
});

router.get('/lists/:listId/entries', async (req, res) => {
    res.json(await blockListService.listEntries(req.params.listId, req.query));
});

router.get('/rules', async (req, res) => {
    res.json(await blockRuleService.listRules(req.query));
});

router.post('/rules', canWrite, async (req, res) => {
    const rule = await blockRuleService.createRule(req.body, req.user);
    res.status(201).location(`${req.baseUrl}/rules/${rule.id}`).json(rule);
});

router.get('/rules/:ruleId', async (req, res) => {
    res.json(await blockRuleService.getRule(req.params.ruleId));
});

router.patch('/rules/:ruleId', canWrite, async (req, res) => {
    res.json(await blockRuleService.updateRule(req.params.ruleId, req.body, req.user));
});

router.delete('/rules/:ruleId', canWrite, async (req, res) => {
    await blockRuleService.deleteRule(req.params.ruleId, req.user);
    res.status(204).end();
});

module.exports = router;
