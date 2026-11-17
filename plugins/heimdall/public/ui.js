// The page of the plugin: whether this server reports to Heimdall, and the connection.
// render is called with the element of the page and { api, session, ui } (see docs/plugins.md).
const STATES = {
    unconfigured: ['Not set up', 'warn'],
    waiting: ['Waiting for the first send', 'warn'],
    reporting: ['Reporting', 'ok'],
    failing: ['Failing', 'danger'],
};

export async function render($page, { api, ui }) {
    const base = '/plugins/heimdall';

    async function draw() {
        const status = await api('GET', `${base}/status`);
        $page.empty().append(...page(status));
    }

    const run = (action) => async () => {
        await action();
        await draw();
    };

    function page(status) {
        const { settings } = status;
        const [label, kind] = STATES[status.state];
        const actions = [
            ui.button('Settings', () => settingsDialog(status), 'primary'),
            status.configured ? ui.button('Send now', run(async () => {
                const sent = await api('POST', `${base}/send`);
                ui.notice(sent.lastError ? 'error' : 'ok', sent.lastError || 'Sent to Heimdall');
            })) : null,
            status.configured ? ui.button('Remove the connection', () => ui.confirmDialog({
                title: 'Remove the connection',
                message: 'This server stops reporting to Heimdall. The agent stays in Heimdall, where it can be revoked.',
                confirmLabel: 'Remove',
                onConfirm: async () => {
                    await api('DELETE', `${base}/settings`);
                    await draw();
                },
            }), 'danger') : null,
        ];

        const rows = [
            ['State', ui.badge(label, kind)],
            ['Heimdall', settings.url || '–'],
            ['Agent', settings.agentUid || '–'],
            ['License key', settings.licenseKeySet ? 'Set (it is never shown again)' : '–'],
            ['Name of this server there', settings.source],
            ['Measured every', `${settings.intervalSeconds} seconds`],
            ['Logs', settings.sendLogs ? 'Sent' : 'Not sent'],
        ];
        const numbers = [
            ['Last sent', ui.formatDate(status.lastSuccess)],
            ['Last measured', ui.formatDate(status.lastMeasured)],
            ['Metrics in a round', String(status.metrics)],
            ['Sent in all', String(status.sent)],
            ['Waiting to be sent', String(status.queued)],
            ['Dropped', String(status.dropped)],
            ...(status.lastError ? [['Last problem', ui.badge(status.lastError, 'danger')]] : []),
        ];

        return [
            ui.head('Heimdall', ...actions),
            ui.card('Connection', rows),
            ui.card('Reports', numbers),
            ui.card('What is reported', [
                ['Metrics', 'The queries by kind (counters), the time of an answer, the memory, the zones and records, the blocking, the cache and the query log, all as aesir.*'],
                ['Logs', 'When the DNS data or a synchronization changed, when a part fails or recovers, and when this server starts and stops'],
                ['Never', 'The names that clients asked for, and their addresses'],
            ]),
        ].filter(Boolean);
    }

    function settingsDialog(status) {
        const { settings } = status;
        const locked = (name) => settings.fromEnvironment.includes(name);
        ui.formDialog({
            title: 'Heimdall',
            intro: 'Create the agent in Heimdall (Agents) and enter its address, UID and license key here. The key is shown only once there.',
            fields: [
                { name: 'url', label: 'Address of Heimdall', type: 'url', value: settings.url, required: true, placeholder: 'https://heimdall.example.com', disabled: locked('url'), hint: locked('url') ? 'Set in the environment of the server' : 'Without a path. Only https, or http for this machine.' },
                { name: 'agentUid', label: 'Agent UID', value: settings.agentUid, required: true, disabled: locked('agentUid') },
                {
                    name: 'licenseKey', label: 'License key', type: 'password', required: !settings.licenseKeySet, disabled: locked('licenseKey'),
                    hint: settings.licenseKeySet ? 'Leave empty to keep the key' : locked('licenseKey') ? 'Set in the environment of the server' : undefined,
                },
                { name: 'source', label: 'Name of this server in Heimdall', value: status.settings.source, hint: 'Shown as the source of the metrics and logs' },
                { name: 'intervalSeconds', label: 'Measure every (seconds)', type: 'number', value: settings.intervalSeconds, min: 10, max: 3600 },
                { name: 'sendLogs', label: 'Send logs about changes and failures', type: 'checkbox', value: settings.sendLogs },
                { name: 'allowInsecure', label: 'Allow an unencrypted http connection to another machine (the key can be read on the way)', type: 'checkbox', value: settings.allowInsecure },
            ],
            onSubmit: async (values) => {
                await api('PUT', `${base}/settings`, { body: values });
                await draw();
            },
        });
    }

    await draw();
}
