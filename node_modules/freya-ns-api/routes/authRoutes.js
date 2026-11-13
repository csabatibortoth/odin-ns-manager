const express = require('express');

const authService = require('../services/authService/authService');
const userService = require('../services/userService/userService');

const router = express.Router();

// The only endpoint of the API that can be used without signing in.
router.post('/login', async (req, res) => {
    res.json(await authService.authentication(req.body));
});

router.get('/me', authService.authenticate, async (req, res) => {
    res.json(req.user.id ? await userService.getUser(req.user.id) : req.user);
});

// Tokens are stateless, so logging out revokes every token of the user.
router.post('/logout', authService.authenticate, async (req, res) => {
    if (req.user.id) await authService.revokeTokens(req.user.id);
    res.status(204).end();
});

module.exports = router;
