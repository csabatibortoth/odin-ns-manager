// For the admins: the export and import of the configuration, and the
// certificate of HTTPS.

import { api, authHeader, session } from './api.js';
import { el, control, button, select, table, badge, notice, showError, errorText, formatDate, head, options, card, link } from './ui.js';

///--- Export and import

const SECTIONS = [
    ['zones', 'Zones, with their records', true],
    ['records', 'Standalone records', true],
    ['blocking', 'Blocking: the settings, the block lists and the rules', true],
    ['users', 'Users, with their password hashes', false],
];
const COUNTED = [['zones', 'Zones'], ['records', 'Records'], ['blockLists', 'Block lists'], ['blockRules', 'Block rules'], ['users', 'Users']];

const check = (id, label, checked) => {
    const $input = control({ inputType: 'checkbox', id, checked });
    return { $input, $row: el('div', { class: 'field check' }, el('label', { for: id }, $input, el('span', { text: label }))) };
};

const readFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`${file.name} can not be read`));
    reader.readAsText(file);
});

function exportCard() {
    const boxes = SECTIONS.map(([key, label, checked]) => ({ key, ...check(`export_${key}`, label, checked) }));

    return el(
        'section',
        { class: 'card' },
        el('h3', { text: 'Export' }),
        el('p', { class: 'muted', text: 'Everything as one JSON file, to move it to another system or to keep it. The names of the block lists and the monitoring data are not part of it.' }),
        el('div', { class: 'form inline' }, boxes.map((box) => box.$row)),
        el('p', { class: 'muted small', text: 'An export with the users holds their password hashes: keep the file as safe as the database.' }),
        el('div', { class: 'actions' }, button('Download export', async () => {
            const include = boxes.filter((box) => box.$input.prop('checked')).map((box) => box.key);
            if (!include.length) throw new Error('Choose at least one section');

            const url = new URL('/api/backup/export', location.origin);
            url.searchParams.set('include', include.join(','));
            const response = await fetch(url, { headers: authHeader(), cache: 'no-store' });
            if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `The export failed (${response.status})`);

            const name = `${session.info?.name || 'odin-ns-manager'}-export-${new Date().toISOString().slice(0, 10)}.json`;
            const href = URL.createObjectURL(await response.blob());
            const anchor = el('a', { href, download: name })[0];
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(href), 10000);
            notice('ok', `The export is saved as ${name}`);
        }, 'primary'))
    );
}

function importResult(result) {
    const counted = COUNTED.filter(([key]) => result[key]).map(([key, label]) => {
        const { created, updated, skipped, failed } = result[key];
        return [label, `${created} created, ${updated} updated, ${skipped} kept as they are${failed ? `, ${failed} failed` : ''}`];
    });
    if (result.blockSettings) counted.push(['Settings of the blocking', result.blockSettings]);

    const $card = card('Result of the import', counted.length ? counted : [['Sections', 'The file holds nothing to import']]);
    if (result.errors?.length) {
        $card.append(
            el('p', { class: 'field-error', text: `${result.errors.length} item(s) were refused:` }),
            el('ul', { class: 'small' }, result.errors.map((error) => el('li', { text: `${error.section}: ${error.item} - ${errorText({ message: error.error, details: error.details })}` })))
        );
    }
    return $card;
}

function importCard($result) {
    const $file = el('input', { type: 'file', id: 'import_file', class: 'input', accept: '.json,application/json' });
    const $existing = select(options([['skip', 'Keep it as it is: only what is missing is created'], ['overwrite', 'Update it from the file']]), 'skip', { id: 'import_existing' });

    return el(
        'section',
        { class: 'card' },
        el('h3', { text: 'Import' }),
        el('p', { class: 'muted', text: 'Reads an export into this system. Nothing is ever deleted by it; what the file does not hold stays as it is.' }),
        el(
            'div',
            { class: 'form inline' },
            el('div', { class: 'field' }, el('label', { for: 'import_file', text: 'Export file' }), $file),
            el('div', { class: 'field' }, el('label', { for: 'import_existing', text: 'What is here already' }), $existing)
        ),
        el('div', { class: 'actions' }, button('Import', async () => {
            const file = $file[0].files[0];
            if (!file) throw new Error('Choose the export file first');
            let document;
            try {
                document = JSON.parse(await readFile(file));
            } catch {
                throw new Error(`${file.name} is not a JSON file`);
            }
            const result = await api('POST', '/backup/import', { query: { existing: $existing.val() }, body: document });
            $result.empty().append(importResult(result));
            notice(result.errors?.length ? 'info' : 'ok', result.errors?.length ? 'The import is done, but some items were refused' : 'The import is done');
            $file.val('');
        }, 'primary'))
    );
}

export function backup($page) {
    const $result = el('div', { class: 'result', 'aria-live': 'polite' });
    $page.append(
        head('Backup'),
        el('p', { class: 'muted', text: 'Moves the configuration of this server to another one, or brings it back: the zones and records, the blocking and the users.' }),
        el('div', { class: 'cards wide' }, exportCard(), importCard($result)),
        $result
    );
}

///--- Certificate

function daysBadge(days) {
    if (days < 0) return badge('Expired', 'danger');
    return badge(`${days} day(s) left`, days < 15 ? 'danger' : days < 30 ? 'warn' : 'ok');
}

const PROVIDERS = { zones: 'a zone of this server', delegation: 'a CNAME to a zone of this server', cloudflare: 'Cloudflare' };

function challengeText({ type, provider }) {
    if (type === 'http-01') return 'HTTP (port 80)';
    const through = `DNS, through ${PROVIDERS[provider] || provider || 'no provider set'}`;
    return type === 'auto' ? `${through}, for wildcard names; HTTP for the rest` : through;
}

function delegationCard(records) {
    return card(
        'Records to add at the DNS of your domains',
        records.map(({ type, name, target }) => [name, el('span', { class: 'mono break', text: `${type}  ${target}` })]),
        el('p', { class: 'muted', text: 'Once per name, at the provider that hosts the domain. Let\'s Encrypt follows the CNAME to the zone of this server, which answers the challenge.' })
    );
}

function lastTestText(last) {
    if (!last) return 'none since the start';
    return [last.ok ? badge('Passed', 'ok') : badge('Failed', 'danger'), ' ', formatDate(last.at)];
}

// What a test did, step by step
function testCard(result) {
    const rows = result.steps.map(({ step, ok, detail, ms }) => [
        step,
        el('span', {}, ok ? badge('ok', 'ok') : badge('failed', 'danger'), ' ', el('span', { class: 'mono small break', text: detail || '' }), ' ', el('span', { class: 'muted small', text: `${ms} ms` })),
    ]);
    return card(
        result.ok ? 'Test passed' : 'Test failed',
        rows,
        el('p', { class: 'muted', text: `Against ${result.directory}. Nothing was installed: the certificate that the test authority issued is thrown away.` })
    );
}

// Runs the whole order against the staging authority of Let's Encrypt and shows the steps in $result
function testButton($result, refresh) {
    return button("Test with Let's Encrypt staging", async () => {
        $result.empty().append(el('p', { class: 'muted', text: 'Running the test against the staging authority. It can take a minute.' }));
        try {
            const result = await api('POST', '/certificate/test');
            $result.empty().append(testCard(result));
            notice(result.ok ? 'ok' : 'error', result.ok ? 'The test passed' : `The test failed: ${result.error}`);
            await refresh();
        } catch (err) {
            $result.empty();
            showError(err);
        }
    }, 'small');
}

export async function certificate($page) {
    const $body = el('div');
    const $test = el('div');

    const show = (status) => {
        $body.empty();
        if (!status.enabled) {
            $body.append(
                el('p', { class: 'banner warn', text: 'HTTPS is not enabled: the API and this interface are served over plain HTTP, and there is no certificate to show.' }),
                el('p', {}, 'Enable the HTTPS listener and choose where its certificate comes from in the ', link('#/settings', 'settings'), ', then restart the service.')
            );
            return;
        }

        const custom = status.source === 'custom';
        const cert = status.certificate;
        $body.append(
            el(
                'div',
                { class: 'cards wide' },
                card(
                    'Certificate',
                    cert
                        ? [
                            ['Subject', el('span', { class: 'break', text: cert.subject })],
                            ['Issued by', el('span', { class: 'break', text: cert.issuer })],
                            ['Names', el('span', { class: 'mono break', text: cert.altNames.join(', ') || '–' })],
                            ['Valid from', formatDate(cert.validFrom)],
                            ['Valid to', [formatDate(cert.validTo), ' ', daysBadge(cert.daysLeft)]],
                            ['Fingerprint (SHA-256)', el('span', { class: 'mono small break', text: cert.fingerprint256 })],
                        ]
                        : [['State', badge('None is served', 'danger')]]
                ),
                card(
                    'Source',
                    [
                        ['From', custom ? 'Files of your own' : "Let's Encrypt"],
                        ...(custom ? [] : [['Names asked for', el('span', { class: 'mono break', text: status.domains.join(', ') || '–' })]]),
                        ...(status.challenge ? [['Names proven by', challengeText(status.challenge)]] : []),
                        ['Renewed by itself', status.automaticRenewal ? badge('Yes', 'ok') : badge('No')],
                        ['Last check', formatDate(status.lastCheckAt)],
                        ['Last failure', status.lastError ? el('span', { class: 'field-error break', text: status.lastError }) : '–'],
                        // 'lastTest' is there from freya-ns-api 2.5.0 on
                        ...(!custom && 'lastTest' in status ? [['Last test', lastTestText(status.lastTest)]] : []),
                    ],
                    button(custom ? 'Read the files again' : 'Renew now', async () => {
                        show(await api('POST', '/certificate/renew'));
                        notice('ok', custom ? 'The certificate files are read again' : 'A new certificate is issued');
                    }, 'small'),
                    !custom && 'lastTest' in status ? testButton($test, async () => show(await api('GET', '/certificate'))) : null
                )
            )
        );
        // Delegation: what the owner of each domain has to add at the real DNS, once
        if (status.challenge?.recordsToAdd?.length) $body.append(delegationCard(status.challenge.recordsToAdd));
        $body.append($test);
        if (custom) $body.append(uploadCard(show));
    };

    $page.append(
        head('Certificate', button('Refresh', async () => show(await api('GET', '/certificate')))),
        el('p', { class: 'muted', text: 'The certificate of the HTTPS listener of the API and of this interface. It is replaced while the server runs: no restart is needed.' }),
        $body
    );
    show(await api('GET', '/certificate'));
}

function uploadCard(done) {
    const $cert = el('input', { type: 'file', id: 'cert_file', class: 'input', accept: '.crt,.cer,.pem,.txt' });
    const $key = el('input', { type: 'file', id: 'cert_key', class: 'input', accept: '.key,.pem,.txt' });

    return el(
        'section',
        { class: 'card' },
        el('h3', { text: 'Replace the certificate' }),
        el('p', { class: 'muted', text: 'Both files in PEM format. The certificate may be followed by its chain. They are checked, written to the files of the server, and served at once.' }),
        el(
            'div',
            { class: 'form inline' },
            el('div', { class: 'field' }, el('label', { for: 'cert_file', text: 'Certificate' }), $cert),
            el('div', { class: 'field' }, el('label', { for: 'cert_key', text: 'Private key' }), $key)
        ),
        el('div', { class: 'actions' }, button('Replace', async () => {
            const [cert, key] = [$cert[0].files[0], $key[0].files[0]];
            if (!cert || !key) throw new Error('Choose the certificate and its private key');
            try {
                done(await api('PUT', '/certificate', { body: { certificate: await readFile(cert), privateKey: await readFile(key) } }));
            } catch (err) {
                showError(err);
                return;
            }
            notice('ok', 'The certificate is replaced');
        }, 'primary'))
    );
}

///--- Synchronization

const SECTION_NAMES = { zones: 'zones', records: 'standalone records', blocking: 'blocking', users: 'users' };

function syncResult(result) {
    const counted = COUNTED.filter(([key]) => result[key]).map(([key, label]) => {
        const { created, updated, skipped, failed } = result[key];
        return [label, `${created} created, ${updated} updated, ${skipped} kept as they are${failed ? `, ${failed} failed` : ''}`];
    });
    const $card = card('What the last run did', counted.length ? counted : [['Sections', 'Nothing was copied']]);
    if (result.errors?.length) {
        $card.append(
            el('p', { class: 'field-error', text: `${result.errors.length} item(s) were refused:` }),
            el('ul', { class: 'small' }, result.errors.map((error) => el('li', { text: `${error.section}: ${error.item} - ${error.error}` })))
        );
    }
    return $card;
}

export async function sync($page) {
    const $body = el('div');

    const show = (state) => {
        $body.empty();
        if (!state.enabled) {
            $body.append(
                el('p', { class: 'banner warn', text: 'This server does not copy from a primary: the synchronization is switched off.' }),
                el('p', {}, 'Switch it on, and set the primary and the account to sign in with, in the ', link('#/settings', 'settings'), ' (group Synchronization).')
            );
        }
        const result = state.lastError
            ? el('span', { class: 'field-error break', text: state.lastError })
            : state.lastSuccessAt ? badge('Worked', 'ok') : '–';
        $body.append(
            el(
                'div',
                { class: 'cards wide' },
                card(
                    'Primary',
                    [
                        ['Address', state.url ? el('span', { class: 'mono break', text: state.url }) : '–'],
                        ['Copies', state.sections.map((name) => SECTION_NAMES[name] || name).join(', ') || '–'],
                        ['Every', `${state.interval} min`],
                        ['Version of the primary', state.primary?.version || '–'],
                    ],
                    button('Synchronize now', async () => {
                        try {
                            show(await api('POST', '/service/sync/run'));
                            notice('ok', 'The synchronization is done');
                        } catch (err) {
                            show(await api('GET', '/service/sync'));
                            throw err;
                        }
                    }, 'primary')
                ),
                card('Last run', [
                    ['Started', formatDate(state.lastRunAt)],
                    ['Last success', formatDate(state.lastSuccessAt)],
                    ['Next', state.enabled ? formatDate(state.nextRunAt) : '–'],
                    ['Result', result],
                ])
            )
        );
        if (state.lastResult) $body.append(syncResult(state.lastResult));
    };

    $page.append(
        head('Synchronization', button('Refresh', async () => show(await api('GET', '/service/sync')))),
        el('p', { class: 'muted', text: 'Copies the zones, records, blocking and users of a primary server to this one, on a schedule. It goes one way, and nothing is deleted here: what was deleted on the primary has to be deleted here as well.' }),
        $body
    );
    show(await api('GET', '/service/sync'));
}

///--- Plugins

export async function plugins($page) {
    const $body = el('div');
    const stateBadge = (plugin) => {
        if (plugin.state === 'running') return badge('Running', 'ok');
        if (plugin.state === 'failed') return badge('Failed', 'danger');
        return plugin.enabled ? badge('Starts after a restart', 'warn') : badge('Off');
    };

    const show = (result) => {
        $body.empty().append(
            table(
                [
                    { title: 'Plugin', cell: (plugin) => el('strong', { text: plugin.name }) },
                    { title: 'Version', cell: (plugin) => plugin.version || '–' },
                    { title: 'What it does', cell: (plugin) => plugin.description || '–' },
                    { title: 'Page', cell: (plugin) => plugin.ui?.label || '–' },
                    { title: 'State', cell: (plugin) => [stateBadge(plugin), plugin.error ? el('div', { class: 'field-error break', text: plugin.error }) : null] },
                ],
                result.plugins,
                `There are no plugins in the folder ${result.folder}.`
            )
        );
    };

    $page.append(
        head('Plugins', button('Refresh', async () => show(await api('GET', '/service/plugins')))),
        el('p', {}, 'A plugin is a folder in the plugins folder of the server. It runs with the rights of the server, so enable only what you trust: add its name to the setting "Plugins that run" in the ', link('#/settings', 'settings'), ', and restart the service.'),
        $body
    );
    show(await api('GET', '/service/plugins'));
}
