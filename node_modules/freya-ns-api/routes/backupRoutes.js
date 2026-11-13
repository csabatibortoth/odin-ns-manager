const express = require('express');

const config = require('../config/config');
const { requireRole } = require('../services/authService/authService');
const backupService = require('../services/backupService/backupService');

// Signing in is enforced for the whole API in app.js. An export can hold the password hashes of
// the users, and an import can create admins, so both are for admins only.
const router = express.Router();
router.use(requireRole('admin'));

router.get('/export', async (req, res) => {
    const document = await backupService.exportData(req.query, req.user);
    const day = document.exportedAt.toISOString().slice(0, 10);
    // Saved as a file by a browser, and still plain JSON for every other client.
    res.attachment(`freya-ns-api-export-${day}.json`).json(document);
});

// An export is larger than the other requests, so app.js leaves its body to be read here: after the role is checked.
router.post('/import', express.json({ limit: `${config.importMaxSizeMb}mb` }), async (req, res) => {
    res.json(await backupService.importData(req.body, req.query, req.user));
});

module.exports = router;
