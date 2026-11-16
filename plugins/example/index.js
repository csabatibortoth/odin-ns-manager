// An example plugin. A plugin exports activate(api), and optionally deactivate().
// See docs/plugins.md for everything the api offers.

let changes = 0;
let startedAt = null;

exports.activate = (api) => {
    startedAt = new Date();

    // A route at /api/plugins/example/hello; only the roles of plugin.json get in
    api.router.get('/hello', (req, res) => {
        res.json({ message: `Hello ${req.user.username}`, server: api.server, startedAt, dnsChanges: changes });
    });

    // Called after a zone, a record or the blocking was changed
    api.on('dnsChange', () => {
        changes += 1;
        api.log.info(`The DNS data changed (${changes} time(s) since the start)`);
    });

    // A job: every 10 minutes
    api.every(600, () => api.log.info('Still running'));

    api.log.info('Started');
};

exports.deactivate = () => {
    changes = 0;
};
