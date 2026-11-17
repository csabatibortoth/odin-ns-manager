// The reporter: measures on a schedule, notes what changed, and hands it to the sender.
const os = require('os');

const { collect, problems } = require('./collect');
const { createSender } = require('./sender');
const { createSettings } = require('./settings');

const TICK_SECONDS = 5;
const APP = 'odin-ns-manager';

function createReporter({ api, sources, fetchImpl, now = Date.now, settingsFolder = api.dataFolder, env }) {
    const settings = createSettings(settingsFolder, env);
    const sender = createSender({ settings, fetchImpl, now, log: api.log });
    let lastCollect = 0;
    let changes = 0;
    let syncs = 0;
    let known = {};
    let started = false;
    let measured = null;

    const entry = (level, message, extra = {}) => ({
        time: new Date(now()).toISOString(),
        level,
        message,
        service: settings.get().source, // the source in Heimdall: the same name as the metrics have
        app: APP,
        hostname: os.hostname(),
        server: api.server.version,
        ...extra,
    });

    // The log lines that wait for the next send
    const lines = [];
    const note = (level, message, extra) => {
        if (settings.get().sendLogs) lines.push(entry(level, message, extra));
        if (lines.length > 1000) lines.shift();
    };

    // One round: measure, note what changed, send what waits. Never throws.
    async function tick({ force = false } = {}) {
        if (!settings.configured()) return;
        const config = settings.get();

        if (!started) {
            started = true;
            note('info', `Odin ${api.server.version} reports to Heimdall`, { event: 'start' });
        }

        if (force || now() - lastCollect >= config.intervalSeconds * 1000) {
            lastCollect = now();
            try {
                measured = collect(sources, { now: now(), source: config.source });
                sender.enqueue('metrics', measured);

                // A problem is told when it starts and when it ends, not at every round
                const current = problems(sources);
                for (const [name, text] of Object.entries(current)) {
                    if (text && !known[name]) note('error', text, { event: 'problem', problem: name });
                    if (!text && known[name]) note('info', `${known[name]} (it works again)`, { event: 'recovered', problem: name });
                    known[name] = text;
                }
            } catch (err) {
                api.log.error('Measuring failed: ', err.stack || err);
                note('error', `Measuring failed: ${err.message}`, { event: 'measure' });
            }
        }

        if (changes) {
            note('info', changes === 1 ? 'The DNS data was changed' : `The DNS data was changed ${changes} times`, { event: 'dnsChange', count: changes });
            changes = 0;
        }
        if (syncs) {
            note('info', 'A synchronization imported data from the primary', { event: 'sync', count: syncs });
            syncs = 0;
        }
        if (lines.length) sender.enqueue('json', lines.splice(0));

        await sender.flush({ force });
    }

    return {
        settings,
        sender,
        tick,
        every: TICK_SECONDS,
        onDnsChange: () => { changes += 1; },
        onSync: () => { syncs += 1; },
        // What the page shows
        status() {
            const state = sender.state();
            return {
                configured: settings.configured(),
                settings: settings.describe(),
                state: !settings.configured() ? 'unconfigured' : state.lastError ? 'failing' : state.lastSuccess ? 'reporting' : 'waiting',
                sent: state.sent,
                dropped: state.dropped,
                queued: state.queued,
                failures: state.failures,
                lastSuccess: state.lastSuccess,
                lastError: state.lastError,
                nextAttempt: state.nextAttempt ? new Date(state.nextAttempt).toISOString() : null,
                lastMeasured: lastCollect ? new Date(lastCollect).toISOString() : null,
                metrics: measured ? measured.length : 0,
            };
        },
        // Settings changed: measure again at once
        changed() {
            lastCollect = 0;
            started = false;
            known = {};
            sender.clear();
        },
        // The last end of the plugin: tell Heimdall, once, if it still can be reached
        async stop() {
            if (!settings.configured() || !started) return;
            note('info', 'Odin stopped', { event: 'stop' });
            sender.enqueue('json', lines.splice(0));
            await Promise.race([sender.flush({ force: true }), new Promise((resolve) => setTimeout(resolve, 3000).unref())]);
        },
    };
}

module.exports = { createReporter };
