// The pages of the user interface. Each one renders into the element it is given.

import { api, session, events, isAdmin, canWriteDns } from './api.js';
import {
    el, control, button, select, table, pager, badge, activeBadge, notice, showError, debounce,
    formDialog, inlineForm, confirmDialog, fieldError, formatDate, formatDuration, formatBytes,
} from './ui.js';
import { lineChart, formatNumber } from './charts.js';

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR', 'SRV', 'TXT'];
const LOOKUP_TYPES = [...RECORD_TYPES.slice(0, 6), 'SOA', 'SRV', 'TXT'];
const PAGE_SIZE = 20;

const link = (href, text) => el('a', { href, text });
const head = (title, ...actions) => el('div', { class: 'toolbar page-head' }, el('h2', { text: title }), el('span', { class: 'spacer' }), actions);
const options = (pairs) => pairs.map(([value, text]) => ({ value, text }));

function card(title, rows, ...actions) {
    return el(
        'section',
        { class: 'card' },
        el('h3', { text: title }),
        el('dl', {}, rows.map(([term, value]) => [el('dt', { text: term }), el('dd', {}, value)])),
        actions.filter(Boolean).length ? el('div', { class: 'actions' }, actions) : null
    );
}

function searchBox(placeholder, onSearch) {
    const $search = control({ inputType: 'search', class: 'input grow' }).attr({ placeholder, 'aria-label': placeholder });
    $search.on('input', debounce(() => onSearch($search.val().trim())));
    return $search;
}

function filter(label, items, onChange) {
    const $select = select(items, '');
    $select.on('change', () => onChange($select.val()));
    return el('label', {}, label, $select);
}

const activeFilter = (onChange) => filter('State', options([['', 'All'], ['true', 'Active'], ['false', 'Inactive']]), onChange);

///--- Dashboard

const RANGES = [['15m', 'Last 15 minutes'], ['1h', 'Last hour'], ['6h', 'Last 6 hours'], ['24h', 'Last 24 hours']];
const REFRESH_SECONDS = 10;

const sum = (values) => values.reduce((total, value) => total + (value || 0), 0);

function tile(label, value, note) {
    return el('div', { class: 'tile' }, el('div', { class: 'tile-label', text: label }), el('div', { class: 'tile-value', text: value }), el('div', { class: 'tile-note muted', text: note || '' }));
}

export function buildText(build) {
    if (!build?.number && !build?.commit) return null;
    return [build.number ? `build ${build.number}` : 'build', build.commit ? `(${build.commit})` : null].filter(Boolean).join(' ');
}

export async function dashboard($page) {
    const state = { range: '1h' };
    const $tiles = el('div', { class: 'tiles' });
    const $cards = el('div', { class: 'cards' });

    const charts = {
        queries: lineChart({
            title: 'Queries',
            unit: 'per minute',
            series: [{ key: 'own', name: 'Own zones and records' }, { key: 'forwarded', name: 'Forwarded' }, { key: 'failed', name: 'Failed' }],
        }),
        ms: lineChart({ title: 'Answer time', unit: 'milliseconds, average', series: [{ key: 'ms', name: 'Answer time (ms)' }] }),
        memory: lineChart({ title: 'Memory', unit: 'MB', series: [{ key: 'memory', name: 'Memory (MB)' }] }),
        cache: lineChart({ title: 'Cached answers', series: [{ key: 'cache', name: 'Cached answers' }], format: (value) => formatNumber(value, 0) }),
    };

    const showMetrics = (m) => {
        const perMinute = (counts) => counts.map((count) => (count * 60) / m.step);
        const own = m.zones.map((count, index) => count + m.records[index]);
        const frame = { from: m.from, to: m.to, t: m.t };
        charts.queries.update({ ...frame, values: { own: perMinute(own), forwarded: perMinute(m.forwarded), failed: perMinute(m.failed) } });
        charts.ms.update({ ...frame, values: { ms: m.ms } });
        charts.memory.update({ ...frame, values: { memory: m.memory.map((bytes) => (bytes === null ? null : bytes / 1024 / 1024)) } });
        charts.cache.update({ ...frame, values: { cache: m.cache } });

        const totals = { own: sum(own), forwarded: sum(m.forwarded), failed: sum(m.failed) };
        const total = totals.own + totals.forwarded + totals.failed;
        const share = (part) => (total ? `${formatNumber((part / total) * 100, 1)} % of the queries` : 'no queries yet');
        // The average of the answers, not of the samples
        const answered = m.ms.map((ms, index) => (ms === null ? 0 : own[index] + m.forwarded[index]));
        const time = sum(answered) ? sum(m.ms.map((ms, index) => (ms || 0) * answered[index])) / sum(answered) : null;
        const period = RANGES.find(([value]) => value === m.range)[1].toLowerCase();

        $tiles.empty().append(
            tile('Queries', formatNumber(total, 0), period),
            tile('Own zones and records', formatNumber(totals.own, 0), share(totals.own)),
            tile('Forwarded', formatNumber(totals.forwarded, 0), share(totals.forwarded)),
            tile('Failed', formatNumber(totals.failed, 0), share(totals.failed)),
            tile('Average answer time', time === null ? '–' : `${formatNumber(time)} ms`, period)
        );
    };

    const showStatus = (s) => {
        const zones = s.zones;
        let zoneState = badge('Up to date', 'ok');
        if (!zones.enabled) zoneState = badge('Disabled');
        else if (zones.failing) zoneState = badge('Database not readable', 'danger');
        else if (!zones.watching) zoneState = badge('Not loaded', 'warn');

        $cards.empty().append(
            card('Service', [
                ['Name', s.name],
                ['Version', s.version],
                ['Build', buildText(s.build)?.replace(/^build /, '') || '–'],
                ['Environment', s.type],
                ['Running for', formatDuration(s.uptime)],
                ['Started', formatDate(s.startedAt)],
                ['Node.js', s.node],
                ['Memory', formatBytes(s.memory)],
            ]),
            card('DNS server', [
                ['Listens on', el('span', { class: 'mono', text: `${s.dns.address}:${s.dns.port}` })],
                ['Transport', s.dns.tcp ? 'UDP and TCP' : 'UDP'],
                ['Queries since the start', s.dns.queries.total],
                ['From own zones', s.dns.queries.zones],
                ['From standalone records', s.dns.queries.records],
                ['Forwarded', s.dns.queries.forwarded],
                ['Failed', s.dns.queries.failed],
            ]),
            card(
                'Own zones and records',
                [
                    ['State', zoneState],
                    ['Zones served', zones.zones],
                    ['Records of the zones', zones.records],
                    ['Standalone records', zones.standalone],
                    ['Checked every', `${zones.refresh} s`],
                    ['Last check', formatDate(zones.checkedAt)],
                    ['Last change', formatDate(zones.changedAt)],
                ],
                isAdmin() && zones.enabled
                    ? button('Reload zones', async () => {
                        await api('POST', '/service/zones/reload');
                        notice('ok', 'The zones and records are reloaded from the database');
                        await load();
                    }, 'small')
                    : null
            ),
            card(
                'Forwarding',
                [
                    ['Upstream servers', el('span', { class: 'mono', text: s.upstream.join(', ') || 'of the system' })],
                    ['Cache', s.cache.enabled ? badge('On', 'ok') : badge('Off')],
                    ['Cached answers', `${s.cache.entries} of ${s.cache.max}`],
                ],
                isAdmin()
                    ? button('Clear cache', async () => {
                        const result = await api('POST', '/service/cache/clear');
                        notice('ok', `${result.cleared} cached answer(s) cleared`);
                        await load();
                    }, 'small')
                    : null
            )
        );
    };

    async function load() {
        const [s, m] = await Promise.all([api('GET', '/service/status'), api('GET', '/service/metrics', { query: { range: state.range } })]);
        showMetrics(m);
        showStatus(s);
    }

    const $range = select(options(RANGES), state.range);
    $range.attr('aria-label', 'Period of the graphs').on('change', () => {
        state.range = $range.val();
        load().catch(showError);
    });

    $page.append(
        head('Dashboard', button('Refresh', load)),
        el('div', { class: 'toolbar' }, el('label', {}, 'Period', $range)),
        $tiles,
        el('div', { class: 'charts' }, Object.values(charts).map((chart) => chart.$el)),
        $cards
    );
    await load();

    // Kept up to date for as long as the page is shown
    const timer = setInterval(() => {
        if (!$page[0].isConnected) clearInterval(timer);
        else if (!document.hidden) load().catch(() => {});
    }, REFRESH_SECONDS * 1000);
}

///--- Zones

export async function zones($page, zoneId) {
    if (zoneId) return zoneRecords($page, zoneId);

    const state = { page: 1, q: '', active: '' };
    const $list = el('div');
    const write = canWriteDns();

    const load = async () => {
        const result = await api('GET', '/zones', {
            query: { page: state.page, limit: PAGE_SIZE, q: state.q, active: state.active, sort: 'name' },
        });
        if (result.page > result.pages && result.pages > 0) {
            state.page = result.pages;
            return load();
        }
        $list.empty().append(
            table(
                [
                    { title: 'Zone', cell: (zone) => link(`#/zones/${zone.id}`, zone.name) },
                    { title: 'Primary name server', cell: (zone) => zone.soa.host },
                    { title: 'Serial', class: 'num', cell: (zone) => zone.soa.serial },
                    { title: 'TTL', class: 'num', cell: (zone) => zone.ttl },
                    { title: 'State', cell: (zone) => activeBadge(zone.active) },
                    { title: 'Changed', cell: (zone) => formatDate(zone.updatedAt) },
                    ...(write
                        ? [{
                            title: '',
                            class: 'actions',
                            cell: (zone) => [
                                button('Edit', () => zoneDialog(zone, load), 'small'),
                                button('Delete', () => deleteZone(zone, load), 'small danger'),
                            ],
                        }]
                        : []),
                ],
                result.items,
                state.q || state.active ? 'No zone matches the filter.' : 'There are no zones yet.'
            ),
            pager(result, (page) => {
                state.page = page;
                return load();
            })
        );
    };

    const reload = () => {
        state.page = 1;
        load().catch(showError);
    };

    $page.append(
        head('Zones', write ? button('Add zone', () => zoneDialog(null, load), 'primary') : null),
        el(
            'div',
            { class: 'toolbar' },
            searchBox('Search zones', (q) => {
                state.q = q;
                reload();
            }),
            activeFilter((active) => {
                state.active = active;
                reload();
            })
        ),
        $list
    );
    await load();
}

function zoneDialog(zone, done) {
    const soa = zone?.soa || {};
    formDialog({
        title: zone ? `Edit zone ${zone.name}` : 'Add zone',
        intro: zone ? null : 'The SOA record of the zone is made with it, and its serial is raised on every change.',
        fields: [
            {
                name: 'name', label: 'Zone name', value: zone?.name, required: !zone, disabled: Boolean(zone),
                placeholder: 'example.com', hint: zone ? 'A zone cannot be renamed.' : null,
            },
            { name: 'soa.host', label: 'Primary name server', value: soa.host, required: true, placeholder: 'ns1.example.com' },
            {
                name: 'soa.admin', label: 'Administrator mailbox', value: soa.admin, placeholder: 'hostmaster.<zone name>',
                hint: 'Written as a domain name; an e-mail address is converted.',
            },
            { name: 'ttl', label: 'Default TTL of the records (seconds)', type: 'number', value: zone?.ttl ?? 3600, min: 0 },
            { name: 'soa.refresh', label: 'SOA refresh (seconds)', type: 'number', value: soa.refresh ?? 3600, min: 0 },
            { name: 'soa.retry', label: 'SOA retry (seconds)', type: 'number', value: soa.retry ?? 600, min: 0 },
            { name: 'soa.expire', label: 'SOA expire (seconds)', type: 'number', value: soa.expire ?? 604800, min: 0 },
            { name: 'soa.ttl', label: 'SOA TTL, for negative answers (seconds)', type: 'number', value: soa.ttl ?? 3600, min: 0 },
            ...(zone
                ? [{
                    name: 'soa.serial', label: 'Serial', type: 'number', min: 0, placeholder: String(soa.serial),
                    hint: `Now ${soa.serial}. Leave it empty to have it raised automatically.`,
                }]
                : []),
            { name: 'active', label: 'Active: answered by the DNS server', type: 'checkbox', value: zone ? zone.active : true },
        ],
        onSubmit: async (values) => {
            if (zone) {
                await api('PATCH', `/zones/${zone.id}`, { body: values });
                notice('ok', `Zone ${zone.name} is saved`);
            } else {
                const created = await api('POST', '/zones', { body: values });
                notice('ok', `Zone ${created.name} is created`);
            }
            await done();
        },
    });
}

function deleteZone(zone, done) {
    confirmDialog({
        title: `Delete zone ${zone.name}?`,
        message: 'The zone and all of its records are deleted, and its names are no longer answered by this server. This cannot be undone.',
        onConfirm: async () => {
            await api('DELETE', `/zones/${zone.id}`);
            notice('ok', `Zone ${zone.name} is deleted`);
            await done();
        },
    });
}

///--- Records of a zone

// "@" for the zone itself, the name relative to the zone otherwise
function relativeName(name, zoneName) {
    if (name === zoneName) return '@';
    return name.endsWith(`.${zoneName}`) ? name.slice(0, -(zoneName.length + 1)) : name;
}

function recordValue(record) {
    const data = record.data;
    if (record.type === 'MX') return `${data.priority} ${data.exchange}`;
    if (record.type === 'SRV') return `${data.priority} ${data.weight} ${data.port} ${data.target}`;
    if (record.type === 'TXT') return `"${data.target}"`;
    return data.target;
}

async function zoneRecords($page, zoneId) {
    let zone = await api('GET', `/zones/${encodeURIComponent(zoneId)}`);
    const state = { page: 1, q: '', type: '', active: '' };
    const write = canWriteDns();
    const $summary = el('div', { class: 'summary' });
    const $list = el('div');
    const fact = (term, value) => el('span', {}, el('span', { text: `${term}: ` }), String(value));

    const load = async () => {
        const [current, result] = await Promise.all([
            api('GET', `/zones/${zone.id}`),
            api('GET', `/zones/${zone.id}/records`, {
                query: { page: state.page, limit: PAGE_SIZE, q: state.q, type: state.type, active: state.active, sort: 'name' },
            }),
        ]);
        zone = current;
        if (result.page > result.pages && result.pages > 0) {
            state.page = result.pages;
            return load();
        }

        $summary.empty().append(
            fact('Primary name server', zone.soa.host),
            fact('Mailbox', zone.soa.admin),
            fact('Serial', zone.soa.serial),
            fact('Default TTL', `${zone.ttl} s`),
            activeBadge(zone.active)
        );
        $list.empty().append(
            table(
                [
                    { title: 'Name', cell: (record) => el('span', { class: 'mono', title: record.name, text: relativeName(record.name, zone.name) }) },
                    { title: 'Type', cell: (record) => badge(record.type) },
                    { title: 'Value', class: 'value', cell: (record) => recordValue(record) },
                    {
                        title: 'TTL',
                        class: 'num',
                        cell: (record) => (record.ttl ?? el('span', { class: 'muted', title: 'The TTL of the zone', text: `${zone.ttl}*` })),
                    },
                    { title: 'State', cell: (record) => activeBadge(record.active) },
                    ...(write
                        ? [{
                            title: '',
                            class: 'actions',
                            cell: (record) => [
                                button('Edit', () => recordDialog(zone, record, load), 'small'),
                                button('Delete', () => deleteRecord(zone, record, load), 'small danger'),
                            ],
                        }]
                        : []),
                ],
                result.items,
                state.q || state.type || state.active ? 'No record matches the filter.' : 'This zone has no records yet.'
            ),
            pager(result, (page) => {
                state.page = page;
                return load();
            })
        );
    };

    const reload = () => {
        state.page = 1;
        load().catch(showError);
    };

    $page.append(
        el('p', { class: 'breadcrumb' }, link('#/zones', 'Zones'), ' / ', zone.name),
        head(
            zone.name,
            write ? button('Edit zone', () => zoneDialog(zone, load)) : null,
            write ? button('Add record', () => recordDialog(zone, null, load), 'primary') : null
        ),
        $summary,
        el(
            'div',
            { class: 'toolbar' },
            searchBox('Search names and values', (q) => {
                state.q = q;
                reload();
            }),
            filter('Type', options([['', 'All'], ...RECORD_TYPES.map((type) => [type, type])]), (type) => {
                state.type = type;
                reload();
            }),
            activeFilter((active) => {
                state.active = active;
                reload();
            })
        ),
        $list,
        el('p', { class: 'muted', text: '* The TTL of the zone, for the records that do not have their own.' })
    );
    await load();
}

const TARGET_LABELS = {
    A: 'IPv4 address',
    AAAA: 'IPv6 address',
    CNAME: 'Canonical name (fully qualified)',
    NS: 'Name server (fully qualified)',
    PTR: 'Host name (fully qualified)',
    SRV: 'Target host (fully qualified)',
    TXT: 'Text',
};
const TARGET_PLACEHOLDERS = {
    A: '192.0.2.1',
    AAAA: '2001:db8::1',
    CNAME: 'www.example.com',
    NS: 'ns2.example.com',
    PTR: 'host.example.com',
    SRV: 'sip.example.com',
    TXT: 'v=spf1 -all',
};

// zone: the zone of the record; null for a standalone record
function recordDialog(zone, record, done) {
    const data = record?.data || {};
    const of = (...types) => (raw) => types.includes(raw.type);
    const path = zone ? `/zones/${zone.id}/records` : '/records';

    formDialog({
        title: record ? `Edit ${record.type} record` : `Add record${zone ? ` to ${zone.name}` : ''}`,
        intro: zone || record ? null : 'A record of its own, for a name that is in none of the zones. The server answers this name itself, and no longer forwards it.',
        fields: [
            zone
                ? {
                    name: 'name', label: 'Name', value: record ? relativeName(record.name, zone.name) : '', required: true, placeholder: 'www',
                    hint: `"@" for ${zone.name} itself, a name relative to the zone, or a fully qualified name. "*" may be the first label.`,
                }
                : {
                    name: 'name', label: 'Name (fully qualified)', value: record?.name, required: true, placeholder: 'nas.home.example',
                    hint: 'The whole name, e.g. nas.home.example. "*" may be the first label: *.dev.example stands for every name below dev.example.',
                },
            {
                name: 'type', label: 'Type', type: 'select', options: options(RECORD_TYPES.map((type) => [type, type])),
                value: record?.type || 'A', disabled: Boolean(record), hint: record ? 'The type of a record cannot be changed.' : null,
            },
            {
                name: 'data.target', label: (raw) => TARGET_LABELS[raw.type], value: data.target, required: true,
                show: of('A', 'AAAA', 'CNAME', 'NS', 'PTR', 'SRV', 'TXT'),
                placeholder: TARGET_PLACEHOLDERS[record?.type || 'A'],
            },
            { name: 'data.exchange', label: 'Mail server (fully qualified)', value: data.exchange, required: true, show: of('MX'), placeholder: 'mail.example.com' },
            { name: 'data.priority', label: 'Priority', type: 'number', value: data.priority ?? 0, min: 0, max: 65535, show: of('MX', 'SRV') },
            { name: 'data.weight', label: 'Weight', type: 'number', value: data.weight ?? 10, min: 0, max: 65535, show: of('SRV') },
            { name: 'data.port', label: 'Port', type: 'number', value: data.port, required: true, min: 1, max: 65535, show: of('SRV') },
            zone
                ? {
                    name: 'ttl', label: 'TTL (seconds)', type: 'number', value: record?.ttl ?? '', min: 0, blank: 'null',
                    placeholder: `${zone.ttl}`, hint: 'Leave it empty for the TTL of the zone.',
                }
                : { name: 'ttl', label: 'TTL (seconds)', type: 'number', value: record?.ttl ?? 3600, min: 0, required: true },
            { name: 'active', label: 'Active: answered by the DNS server', type: 'checkbox', value: record ? record.active : true },
        ],
        onSubmit: async (values) => {
            if (record) {
                await api('PATCH', `${path}/${record.id}`, { body: values });
                notice('ok', 'The record is saved');
            } else {
                await api('POST', path, { body: values });
                notice('ok', 'The record is added');
            }
            await done();
        },
    });
}

function deleteRecord(zone, record, done) {
    confirmDialog({
        title: `Delete ${record.type} record?`,
        message: `${record.name} ${record.type} ${recordValue(record)} is deleted${zone ? ` from ${zone.name}` : ''}. This cannot be undone.`,
        onConfirm: async () => {
            await api('DELETE', zone ? `/zones/${zone.id}/records/${record.id}` : `/records/${record.id}`);
            notice('ok', 'The record is deleted');
            await done();
        },
    });
}

///--- Standalone records

export async function records($page) {
    const state = { page: 1, q: '', type: '', active: '' };
    const write = canWriteDns();
    const $list = el('div');

    const load = async () => {
        const result = await api('GET', '/records', {
            query: { page: state.page, limit: PAGE_SIZE, q: state.q, type: state.type, active: state.active, sort: 'name' },
        });
        if (result.page > result.pages && result.pages > 0) {
            state.page = result.pages;
            return load();
        }
        $list.empty().append(
            table(
                [
                    { title: 'Name', cell: (record) => el('span', { class: 'mono', text: record.name }) },
                    { title: 'Type', cell: (record) => badge(record.type) },
                    { title: 'Value', class: 'value', cell: (record) => recordValue(record) },
                    { title: 'TTL', class: 'num', cell: (record) => record.ttl },
                    { title: 'State', cell: (record) => activeBadge(record.active) },
                    { title: 'Changed', cell: (record) => formatDate(record.updatedAt) },
                    ...(write
                        ? [{
                            title: '',
                            class: 'actions',
                            cell: (record) => [
                                button('Edit', () => recordDialog(null, record, load), 'small'),
                                button('Delete', () => deleteRecord(null, record, load), 'small danger'),
                            ],
                        }]
                        : []),
                ],
                result.items,
                state.q || state.type || state.active ? 'No record matches the filter.' : 'There are no standalone records yet.'
            ),
            pager(result, (page) => {
                state.page = page;
                return load();
            })
        );
    };

    const reload = () => {
        state.page = 1;
        load().catch(showError);
    };

    $page.append(
        head('Records', write ? button('Add record', () => recordDialog(null, null, load), 'primary') : null),
        el('p', {
            class: 'muted',
            text: 'Standalone records: single names the server answers itself, without a zone around them. The other record types of such a name are not forwarded. The names inside a zone are managed in their zone.',
        }),
        el(
            'div',
            { class: 'toolbar' },
            searchBox('Search names and values', (q) => {
                state.q = q;
                reload();
            }),
            filter('Type', options([['', 'All'], ...RECORD_TYPES.map((type) => [type, type])]), (type) => {
                state.type = type;
                reload();
            }),
            activeFilter((active) => {
                state.active = active;
                reload();
            })
        ),
        $list
    );
    await load();
}

///--- Lookup

const LOOKUP_ERRORS = {
    ENOTFOUND: 'No such name',
    ENODATA: 'The name has no records of this type',
    ESERVFAIL: 'Server failure',
    EREFUSED: 'Refused',
    ETIMEOUT: 'No answer in time',
    ENOTIMP: 'Not implemented',
};

export function lookup($page) {
    const $name = control({ inputType: 'text', id: 'lookup_name', class: 'input' }).attr({
        placeholder: 'www.example.com', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none', required: true,
    });
    const $type = select(LOOKUP_TYPES.map((type) => ({ value: type, text: type })), 'A', { id: 'lookup_type' });
    const $submit = control({ inputType: 'submit', value: 'Look up', class: 'button primary' });
    const $result = el('div', { class: 'result', 'aria-live': 'polite' });

    const $form = el(
        'form',
        { class: 'toolbar' },
        el('label', { for: 'lookup_name', class: 'grow' }, 'Name', $name),
        el('label', { for: 'lookup_type' }, 'Type', $type),
        $submit
    ).on('submit', async (event) => {
        event.preventDefault();
        $submit.prop('disabled', true);
        try {
            const r = await api('GET', '/service/lookup', { query: { name: $name.val().trim(), type: $type.val() } });
            const outcome = r.error
                ? badge(LOOKUP_ERRORS[r.error] || r.error, r.error === 'ENOTFOUND' || r.error === 'ENODATA' ? 'warn' : 'danger')
                : badge(`${r.answers.length} record(s)`, 'ok');
            $result.empty().append(
                card(`${r.type} ${r.name}`, [
                    ['Answered from', { zone: `the zone ${r.zone}`, records: 'the standalone records' }[r.source] || 'the upstream DNS servers'],
                    ['Result', outcome],
                    ['Time', `${r.ms} ms`],
                ]).append(r.answers.length ? el('ul', { class: 'mono' }, r.answers.map((answer) => el('li', { text: answer }))) : null)
            );
        } catch (err) {
            showError(err);
        } finally {
            $submit.prop('disabled', false);
        }
    });

    $page.append(
        head('Lookup'),
        el('p', {
            class: 'muted',
            text: 'Asks the DNS server of this manager, the way any of its clients does. The names of the own zones and the standalone records are answered from them; all others by the upstream DNS servers.',
        }),
        $form,
        $result
    );
    $name.trigger('focus');
}

///--- Users

export async function users($page) {
    const state = { page: 1, q: '', role: '', active: '' };
    const $list = el('div');

    const load = async () => {
        const result = await api('GET', '/users', {
            query: { page: state.page, limit: PAGE_SIZE, q: state.q, role: state.role, active: state.active, sort: 'username' },
        });
        if (result.page > result.pages && result.pages > 0) {
            state.page = result.pages;
            return load();
        }
        $list.empty().append(
            table(
                [
                    {
                        title: 'Username',
                        cell: (user) => [user.username, user.id === session.user.id ? el('span', { class: 'muted', text: ' (you)' }) : null],
                    },
                    { title: 'Name', cell: (user) => user.displayName || '–' },
                    { title: 'E-mail', cell: (user) => user.email },
                    { title: 'Role', cell: (user) => badge(user.role, user.role === 'admin' ? 'ok' : '') },
                    { title: 'State', cell: (user) => activeBadge(user.active) },
                    { title: 'Last sign-in', cell: (user) => formatDate(user.lastLoginAt) },
                    {
                        title: '',
                        class: 'actions',
                        cell: (user) =>
                            user.id === session.user.id
                                ? [button('Edit', () => userDialog(user, load), 'small'), link('#/account', 'Account')]
                                : [
                                    button('Edit', () => userDialog(user, load), 'small'),
                                    button('Password', () => passwordDialog(user), 'small'),
                                    button('Delete', () => deleteUser(user, load), 'small danger'),
                                ],
                    },
                ],
                result.items,
                'No user matches the filter.'
            ),
            pager(result, (page) => {
                state.page = page;
                return load();
            })
        );
    };

    const reload = () => {
        state.page = 1;
        load().catch(showError);
    };

    $page.append(
        head('Users', button('Add user', () => userDialog(null, load), 'primary')),
        el(
            'div',
            { class: 'toolbar' },
            searchBox('Search users', (q) => {
                state.q = q;
                reload();
            }),
            filter('Role', options([['', 'All'], ['admin', 'Admin'], ['user', 'User']]), (role) => {
                state.role = role;
                reload();
            }),
            activeFilter((active) => {
                state.active = active;
                reload();
            })
        ),
        $list,
        el('p', {
            class: 'muted',
            text: `Admins manage the users and the service. Zones and records may be changed by: ${(session.info?.dnsWriteRoles || ['admin']).join(', ')}.`,
        })
    );
    await load();
}

const PASSWORD_HINT = '8 to 128 characters.';

function userDialog(user, done) {
    formDialog({
        title: user ? `Edit user ${user.username}` : 'Add user',
        fields: [
            {
                name: 'username', label: 'Username', value: user?.username, required: true, maxlength: 32,
                hint: '3 to 32 characters: letters, digits, ".", "_" and "-".',
            },
            { name: 'email', label: 'E-mail', type: 'email', value: user?.email, required: true },
            { name: 'displayName', label: 'Display name', value: user?.displayName, blank: 'empty', maxlength: 100 },
            ...(user ? [] : [{ name: 'password', label: 'Password', type: 'password', required: true, hint: PASSWORD_HINT, autocomplete: 'new-password' }]),
            { name: 'role', label: 'Role', type: 'select', options: options([['user', 'User'], ['admin', 'Admin']]), value: user?.role || 'user' },
            { name: 'active', label: 'Active: may sign in', type: 'checkbox', value: user ? user.active : true },
        ],
        onSubmit: async (values) => {
            if (user) {
                const saved = await api('PATCH', `/users/${user.id}`, { body: values });
                notice('ok', `User ${saved.username} is saved`);
                if (saved.id === session.user.id) {
                    session.user = saved;
                    events.userChanged();
                    if (saved.role !== 'admin') {
                        location.hash = '#/dashboard';
                        return;
                    }
                }
            } else {
                const created = await api('POST', '/users', { body: values });
                notice('ok', `User ${created.username} is created`);
            }
            await done();
        },
    });
}

function passwordDialog(user) {
    formDialog({
        title: `New password for ${user.username}`,
        intro: 'The user is signed out everywhere, and signs in with the new password.',
        fields: [
            { name: 'newPassword', label: 'New password', type: 'password', required: true, hint: PASSWORD_HINT, autocomplete: 'new-password' },
            { name: 'confirm', label: 'New password again', type: 'password', required: true, send: false, autocomplete: 'new-password' },
        ],
        submitLabel: 'Set password',
        onSubmit: async (values, raw) => {
            if (raw.newPassword !== raw.confirm) throw fieldError('confirm', 'The two passwords differ');
            await api('PUT', `/users/${user.id}/password`, { body: values });
            notice('ok', `The password of ${user.username} is changed`);
        },
    });
}

function deleteUser(user, done) {
    confirmDialog({
        title: `Delete user ${user.username}?`,
        message: 'The user can no longer sign in. This cannot be undone.',
        onConfirm: async () => {
            await api('DELETE', `/users/${user.id}`);
            notice('ok', `User ${user.username} is deleted`);
            await done();
        },
    });
}

///--- Logs

const today = () => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

export async function logs($page) {
    const $target = select(options([['log', 'General'], ['error', 'Errors'], ['security', 'Security']]), 'log', { id: 'log_target' });
    const $date = control({ inputType: 'date', id: 'log_date', class: 'input', value: today(), max: today() });
    const $lines = select(options([['100', '100'], ['200', '200'], ['500', '500'], ['1000', '1000']]), '200', { id: 'log_lines' });
    const $output = el('div');

    const load = async () => {
        const result = await api('GET', '/service/logs', { query: { target: $target.val(), date: $date.val(), lines: $lines.val() } });
        $output.empty();
        if (!result.lines.length) {
            $output.append(el('p', { class: 'empty', text: 'There are no entries for this day.' }));
            return;
        }
        const $log = el('pre', { class: 'log', tabindex: 0, text: result.lines.join('\n') });
        $output.append(
            result.truncated ? el('p', { class: 'muted', text: `The last ${result.lines.length} entries; the newest is at the bottom.` }) : null,
            $log
        );
        $log.scrollTop($log.prop('scrollHeight'));
    };

    const reload = () => load().catch(showError);
    $target.on('change', reload);
    $date.on('change', reload);
    $lines.on('change', reload);

    $page.append(
        head('Logs', button('Refresh', load)),
        el(
            'div',
            { class: 'toolbar' },
            el('label', { for: 'log_target' }, 'Log', $target),
            el('label', { for: 'log_date' }, 'Day', $date),
            el('label', { for: 'log_lines' }, 'Entries', $lines)
        ),
        $output
    );
    await load();
}

///--- Account

// The signed-in user changes their own account here
export async function account($page) {
    const $profile = el('section', { class: 'card' });
    const $facts = el('div');

    const load = async () => {
        const me = await api('GET', `/users/${session.user.id}`);
        session.user = me;
        events.userChanged();

        $facts.empty().append(
            card('Your account', [
                ['Role', badge(me.role, me.role === 'admin' ? 'ok' : '')],
                ['Last sign-in', formatDate(me.lastLoginAt)],
                ['Member since', formatDate(me.createdAt)],
                ['Last change', formatDate(me.updatedAt)],
            ])
        );
        $profile.empty().append(
            el('h3', { text: 'Profile' }),
            inlineForm({
                fields: [
                    // The API lets only admins change a username, also their own
                    {
                        name: 'username', label: 'Username', value: me.username, required: true, maxlength: 32, disabled: !isAdmin(),
                        hint: isAdmin() ? '3 to 32 characters: letters, digits, ".", "_" and "-". You sign in with it.' : 'Your username can be changed by an admin.',
                    },
                    { name: 'displayName', label: 'Display name', value: me.displayName, blank: 'empty', maxlength: 100, hint: 'Shown at the top of the page.' },
                    { name: 'email', label: 'E-mail', type: 'email', value: me.email, required: true, hint: 'You can sign in with it as well.' },
                ],
                submitLabel: 'Save profile',
                onSubmit: async (values) => {
                    await api('PATCH', `/users/${me.id}`, { body: values });
                    notice('ok', 'Your profile is saved');
                    await load();
                },
            })
        );
    };

    const $password = el(
        'section',
        { class: 'card' },
        el('h3', { text: 'Password' }),
        inlineForm({
            intro: 'You are signed out everywhere, also here, and sign in again with the new password.',
            fields: [
                { name: 'currentPassword', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' },
                { name: 'newPassword', label: 'New password', type: 'password', required: true, hint: PASSWORD_HINT, autocomplete: 'new-password' },
                { name: 'confirm', label: 'New password again', type: 'password', required: true, send: false, autocomplete: 'new-password' },
            ],
            submitLabel: 'Change password',
            clear: true,
            onSubmit: async (values, raw) => {
                if (raw.newPassword !== raw.confirm) throw fieldError('confirm', 'The two passwords differ');
                try {
                    await api('PUT', `/users/${session.user.id}/password`, { body: values });
                } catch (err) {
                    // The API names the field in its message, not in the details
                    if (err.status === 400 && /currentPassword/.test(err.message)) throw fieldError('currentPassword', 'The current password is wrong');
                    throw err;
                }
                setTimeout(() => events.signedOut('Your password is changed. Sign in with the new one.'));
            },
        })
    );

    $page.append(head('Account'), el('div', { class: 'cards wide' }, $profile, $password), $facts);
    await load();
}

///--- Settings

const SOURCES = { environment: 'Environment', saved: 'Saved here', default: 'Default' };

function settingText(setting, value) {
    if (value === undefined) return el('span', { class: 'muted', text: 'not shown' });
    if (setting.type === 'bool') return value ? 'Yes' : 'No';
    if (setting.type === 'list') return value.length ? value.join(', ') : el('span', { class: 'muted', text: 'none' });
    return value === '' ? el('span', { class: 'muted', text: 'empty' }) : String(value);
}

// The server configuration, for the admins
export async function settings($page) {
    const $notice = el('div');
    const $groups = el('div');

    const show = (result) => {
        $notice.empty();
        if (result.restartNeeded) {
            $notice.append(
                el('p', { class: 'banner warn', role: 'status', text: 'Some of the saved settings wait for a restart: the server still runs with the values it was started with. Restart the service to apply them.' })
            );
        }

        $groups.empty().append(
            result.groups.map((group) => {
                const editable = group.settings.filter((setting) => setting.editable);
                return el(
                    'section',
                    { class: 'settings-group' },
                    el(
                        'div',
                        { class: 'toolbar page-head' },
                        el('h3', { text: group.title }),
                        el('span', { class: 'spacer' }),
                        editable.length ? button('Edit', () => settingsDialog(group, show), 'small') : null
                    ),
                    table(
                        [
                            { title: 'Setting', cell: (setting) => setting.label },
                            {
                                title: 'Value',
                                class: 'value',
                                cell: (setting) => [
                                    settingText(setting, setting.value),
                                    'pending' in setting
                                        ? el('div', {}, badge('After restart', 'warn'), ' ', settingText(setting, setting.pending))
                                        : null,
                                ],
                            },
                            {
                                title: 'From',
                                cell: (setting) => badge(SOURCES[setting.source], setting.source === 'default' ? '' : 'ok'),
                            },
                            {
                                title: 'Changes',
                                cell: (setting) => {
                                    if (setting.source === 'environment') return el('span', { class: 'muted', text: `fixed by ${setting.env}` });
                                    if (!setting.editable) return el('span', { class: 'muted', text: `only with ${setting.env}` });
                                    return setting.live ? 'at once' : 'after a restart';
                                },
                            },
                        ],
                        group.settings
                    )
                );
            })
        );
    };

    $page.append(
        head('Settings', button('Refresh', async () => show(await api('GET', '/service/config')))),
        el('p', {
            class: 'muted',
            text: 'The configuration of the server. What is saved here is kept in its settings file, and comes after the environment variables: a setting that is fixed by its variable can not be changed here.',
        }),
        $notice,
        $groups
    );
    show(await api('GET', '/service/config'));
}

function settingsDialog(group, done) {
    const editable = group.settings.filter((setting) => setting.editable);
    // What is saved wins over what the server still runs with
    const current = (setting) => ('pending' in setting ? setting.pending : setting.value);
    const shown = (setting) => (setting.type === 'list' ? current(setting).join(', ') : current(setting));

    formDialog({
        title: `${group.title} settings`,
        fields: editable.map((setting) => ({
            name: setting.key,
            label: setting.label,
            type: { bool: 'checkbox', int: 'number' }[setting.type] || 'text',
            value: shown(setting),
            min: setting.min,
            max: setting.type === 'int' ? setting.max : undefined,
            maxlength: setting.type === 'string' ? setting.max : undefined,
            required: setting.type !== 'bool' && setting.type !== 'list',
            blank: 'empty',
            hint: [
                setting.hint,
                setting.type === 'bool' ? null : `Default: ${setting.type === 'list' ? setting.fallback.join(', ') || 'none' : setting.fallback}.`,
                setting.live ? null : 'Takes effect after a restart.',
            ].filter(Boolean).join(' '),
        })),
        onSubmit: async (values) => {
            // Only what was changed is sent, so the rest stays at its default
            const changes = {};
            for (const setting of editable) {
                const value = setting.type === 'list' ? String(values[setting.key] ?? '').split(',').map((item) => item.trim()).filter(Boolean) : values[setting.key];
                if (JSON.stringify(value) !== JSON.stringify(current(setting))) changes[setting.key] = value;
            }
            if (!Object.keys(changes).length) return;

            const result = await api('PATCH', '/service/config', { body: changes });
            const waits = result.changed.some((key) => editable.find((setting) => setting.key === key && !setting.live));
            notice('ok', waits ? 'The settings are saved. Restart the service to apply them.' : 'The settings are saved and applied');
            // The name of the server and the roles are also what the page itself shows
            session.info = await api('GET', '/service/info', { quiet: true }).catch(() => session.info);
            events.userChanged();
            done(result);
        },
    });
}
