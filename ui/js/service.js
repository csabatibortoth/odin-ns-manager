// For the admins: the export and import of the configuration, and the
// certificate of HTTPS.

import { api, authHeader, session } from './api.js';
import { el, control, button, select, badge, notice, showError, errorText, formatDate, head, options, card, link } from './ui.js';

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

export async function certificate($page) {
    const $body = el('div');

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
                        ['Renewed by itself', status.automaticRenewal ? badge('Yes', 'ok') : badge('No')],
                        ['Last check', formatDate(status.lastCheckAt)],
                        ['Last failure', status.lastError ? el('span', { class: 'field-error break', text: status.lastError }) : '–'],
                    ],
                    button(custom ? 'Read the files again' : 'Renew now', async () => {
                        show(await api('POST', '/certificate/renew'));
                        notice('ok', custom ? 'The certificate files are read again' : 'A new certificate is issued');
                    }, 'small')
                )
            )
        );
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
