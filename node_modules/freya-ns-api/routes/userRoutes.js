const express = require('express');

const { requireRole, requireSelfOrAdmin } = require('../services/authService/authService');
const userService = require('../services/userService/userService');

// Signing in is enforced for the whole API in app.js.
const router = express.Router();
const adminOnly = requireRole('admin');

router.get('/', adminOnly, async (req, res) => {
    res.json(await userService.listUsers(req.query));
});

router.post('/', adminOnly, async (req, res) => {
    const user = await userService.createUser(req.body);
    res.status(201).location(`${req.baseUrl}/${user.id}`).json(user);
});

router.get('/:id', requireSelfOrAdmin, async (req, res) => {
    res.json(await userService.getUser(req.params.id));
});

router.patch('/:id', requireSelfOrAdmin, async (req, res) => {
    res.json(await userService.updateUser(req.params.id, req.body, req.user));
});

router.put('/:id/password', requireSelfOrAdmin, async (req, res) => {
    await userService.changePassword(req.params.id, req.body, req.user);
    res.status(204).end();
});

router.delete('/:id', adminOnly, async (req, res) => {
    await userService.deleteUser(req.params.id, req.user);
    res.status(204).end();
});

module.exports = router;
