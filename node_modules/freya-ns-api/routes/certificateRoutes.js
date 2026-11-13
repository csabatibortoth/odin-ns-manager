const express = require('express');

const { requireRole } = require('../services/authService/authService');
const certificateService = require('../services/certificateService/certificateService');

// Signing in is enforced for the whole API in app.js. The certificate decides whether the clients
// can trust the server, and replacing it takes a private key, so all of this is for admins only.
const router = express.Router();
router.use(requireRole('admin'));

router.get('/', (req, res) => {
    res.json(certificateService.status());
});

router.put('/', async (req, res) => {
    res.json(await certificateService.upload(req.body, req.user));
});

router.post('/renew', async (req, res) => {
    res.json(await certificateService.renewNow(req.user));
});

module.exports = router;
