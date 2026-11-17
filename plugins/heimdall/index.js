// Heimdall: reports this server to a Heimdall Monitoring System, like one of its agents does.
// See README.md in this folder, and docs/plugins.md for the api of a plugin.
const { createReporter } = require('./lib/reporter');
const { serverSources } = require('./lib/collect');

let reporter = null;

exports.activate = (api) => {
    reporter = createReporter({ api, sources: serverSources() });
    exports.reporter = reporter;

    // What the page of the plugin uses. Only administrators get in (plugin.json).
    api.router.get('/status', (req, res) => res.json(reporter.status()));

    api.router.put('/settings', (req, res) => {
        try {
            reporter.settings.update(req.body && typeof req.body === 'object' ? req.body : {});
        } catch (err) {
            return res.status(400).json({ error: err.message });
        }
        reporter.changed();
        api.log.info('The settings were changed by ', req.user.username);
        return res.json(reporter.status());
    });

    // Forget the connection to Heimdall
    api.router.delete('/settings', (req, res) => {
        reporter.settings.clear();
        reporter.changed();
        api.log.info('The connection to Heimdall was removed by ', req.user.username);
        res.json(reporter.status());
    });

    // Measure and send now, and tell what came of it
    api.router.post('/send', async (req, res) => {
        if (!reporter.settings.configured()) return res.status(409).json({ error: 'Set the address, the agent UID and the license key first' });
        await reporter.tick({ force: true });
        return res.json(reporter.status());
    });

    api.on('dnsChange', reporter.onDnsChange);
    api.on('sync', reporter.onSync);
    api.every(reporter.every, () => reporter.tick());

    api.log.info(reporter.settings.configured() ? 'Reporting to Heimdall' : 'Not set up yet: open the Heimdall page in the menu');
};

exports.deactivate = async () => {
    await reporter?.stop();
    reporter = null;
};
