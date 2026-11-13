// The monitoring: the queries the DNS server answered, its clients, and the
// most asked names. For the roles that may read it.

import { api, canWriteDns } from './api.js';
import {
    el, control, button, table, badge, notice, showError, debounce, formDialog, confirmDialog, formatDate,
    PAGE_SIZE, link, head, options, searchBox, filter, listLoader,
} from './ui.js';
import { formatNumber } from './charts.js';
import { ruleDialog } from './blocking.js';

const QUERY_TYPES = ['A', 'AAAA', 'CNAME', 'HTTPS', 'MX', 'NS', 'PTR', 'SOA', 'SRV', 'TXT'];
const STATUSES = [['NOERROR', 'Answered'], ['NXDOMAIN', 'No such name'], ['SERVFAIL', 'Server failure'], ['REFUSED', 'Refused'], ['NOTIMP', 'Not implemented']];
const STATUS_KINDS = { NOERROR: 'ok', NXDOMAIN: 'warn' };

const queriesOf = (address) => `#/queries/${encodeURIComponent(address)}`;
const time = (value) => {
    const date = new Date(value);
    return el('span', { title: date.toLocaleString(), text: date.toLocaleTimeString() });
};

///--- Query log

// client: the address of a client, to show its queries only
export async function queries($page, client) {
    const state = { page: 1, q: '', client: client || '', type: '', status: '', blocked: '' };
    const write = canWriteDns();
    const $list = el('div');

    const load = listLoader(
        $list,
        state,
        () => api('GET', '/monitoring/queries', {
            query: { page: state.page, limit: PAGE_SIZE, q: state.q, client: state.client, type: state.type, status: state.status, blocked: state.blocked },
        }),
        [
            { title: 'Time', cell: (query) => time(query.time) },
            { title: 'Client', cell: (query) => el('a', { class: 'mono', href: queriesOf(query.client), text: query.client }) },
            { title: 'Name', class: 'value', cell: (query) => query.name },
            { title: 'Type', cell: (query) => badge(query.type) },
            {
                title: 'Answer',
                cell: (query) => (query.blocked ? badge('Blocked', 'danger') : badge(STATUSES.find(([code]) => code === query.status)?.[1] || query.status, STATUS_KINDS[query.status] || 'danger')),
            },
            { title: 'Time (ms)', class: 'num', cell: (query) => formatNumber(query.durationMs) },
            ...(write
                ? [{
                    title: '',
                    class: 'actions',
                    cell: (query) =>
                        (query.blocked
                            ? button('Allow', () => ruleDialog(null, null, { domain: query.name, action: 'allow' }), 'small')
                            : button('Block', () => ruleDialog(null, null, { domain: query.name, action: 'block' }), 'small')),
                }]
                : []),
        ],
        () => (state.q || state.client || state.type || state.status || state.blocked ? 'No query matches the filter.' : 'No query is recorded yet.')
    );
    const reload = () => {
        state.page = 1;
        load().catch(showError);
    };

    const $client = control({ inputType: 'text', class: 'input', value: state.client || undefined }).attr({ placeholder: 'Any', size: 16, spellcheck: 'false' });
    $client.on('input', debounce(() => {
        state.client = $client.val().trim();
        reload();
    }));

    $page.append(
        head(
            'Queries',
            button('Refresh', load),
            button('Clear the log', () => confirmDialog({
                title: 'Clear the query log?',
                message: 'Every recorded query is deleted. The metrics and the clients stay. This cannot be undone.',
                confirmLabel: 'Clear',
                onConfirm: async () => {
                    const { deleted } = await api('DELETE', '/monitoring/queries');
                    notice('ok', `${formatNumber(deleted, 0)} query(ies) are deleted`);
                    await load();
                },
            }), 'danger')
        ),
        el('p', { class: 'muted', text: 'The queries the DNS server answered, the newest first. They are written every few seconds.' }),
        el(
            'div',
            { class: 'toolbar' },
            searchBox('Search names', (q) => {
                state.q = q;
                reload();
            }),
            el('label', {}, 'Client', $client),
            filter('Type', options([['', 'All'], ...QUERY_TYPES.map((type) => [type, type])]), (type) => {
                state.type = type;
                reload();
            }),
            filter('Answer', options([['', 'All'], ...STATUSES]), (status) => {
                state.status = status;
                reload();
            }),
            filter('Blocked', options([['', 'All'], ['true', 'Blocked'], ['false', 'Not blocked']]), (blocked) => {
                state.blocked = blocked;
                reload();
            })
        ),
        $list
    );
    await load();
}

///--- Clients

export async function clients($page) {
    const state = { page: 1, q: '', sort: '-lastSeenAt' };
    const $list = el('div');

    const load = listLoader(
        $list,
        state,
        () => api('GET', '/monitoring/clients', { query: { page: state.page, limit: PAGE_SIZE, q: state.q, sort: state.sort } }),
        [
            { title: 'Address', cell: (client) => el('a', { class: 'mono', href: queriesOf(client.address), title: 'The queries of this client', text: client.address }) },
            { title: 'Name', cell: (client) => client.name || el('span', { class: 'muted', text: '–' }) },
            { title: 'Queries', class: 'num', cell: (client) => formatNumber(client.queries, 0) },
            { title: 'Blocked', class: 'num', cell: (client) => formatNumber(client.blocked, 0) },
            { title: 'Last seen', cell: (client) => formatDate(client.lastSeenAt) },
            { title: 'First seen', cell: (client) => formatDate(client.firstSeenAt) },
            {
                title: '',
                class: 'actions',
                cell: (client) => [
                    button('Name', () => formDialog({
                        title: `Name of ${client.address}`,
                        fields: [{ name: 'name', label: 'Name', value: client.name, blank: 'empty', maxlength: 100, placeholder: 'Living room TV' }],
                        onSubmit: async (values) => {
                            await api('PATCH', `/monitoring/clients/${client.id}`, { body: values });
                            notice('ok', `${client.address} is named`);
                            await load();
                        },
                    }), 'small'),
                    button('Forget', () => confirmDialog({
                        title: `Forget ${client.name || client.address}?`,
                        message: 'The client and its counters are deleted. Its recorded queries stay, and it is listed again when it sends another one.',
                        confirmLabel: 'Forget',
                        onConfirm: async () => {
                            await api('DELETE', `/monitoring/clients/${client.id}`);
                            notice('ok', `${client.address} is forgotten`);
                            await load();
                        },
                    }), 'small danger'),
                ],
            },
        ],
        () => (state.q ? 'No client matches the search.' : 'No client has sent a query yet.')
    );
    const reload = () => {
        state.page = 1;
        load().catch(showError);
    };

    $page.append(
        head('Clients', button('Refresh', load)),
        el('p', { class: 'muted', text: 'The addresses that sent a query to the DNS server. A name makes them easier to tell apart.' }),
        el(
            'div',
            { class: 'toolbar' },
            searchBox('Search addresses and names', (q) => {
                state.q = q;
                reload();
            }),
            filter('Order', options([['-lastSeenAt', 'Last seen'], ['-queries', 'Most queries'], ['-blocked', 'Most blocked'], ['address', 'Address'], ['name', 'Name']]), (sort) => {
                state.sort = sort;
                reload();
            }, state.sort)
        ),
        $list
    );
    await load();
}

///--- The most asked names, for the dashboard

function topTable(title, columns, rows, empty) {
    return el('section', { class: 'card top' }, el('h3', {}, title, el('span', { class: 'muted', text: ' last 24 hours' })), table(columns, rows, empty));
}

export async function topLists($el) {
    const [top, metrics] = await Promise.all([api('GET', '/monitoring/top', { query: { limit: 8 } }), api('GET', '/monitoring/metrics')]);
    const count = { title: 'Queries', class: 'num', cell: (row) => formatNumber(row.count, 0) };
    const name = { title: 'Name', class: 'value', cell: (row) => row.name };
    const totals = metrics.totals;

    $el.empty().append(
        el(
            'div',
            { class: 'summary' },
            el('strong', { text: 'Last 24 hours' }),
            el('span', {}, el('span', { text: 'Queries: ' }), formatNumber(totals.queries, 0)),
            el('span', {}, el('span', { text: 'Blocked: ' }), `${formatNumber(totals.blocked, 0)} (${formatNumber(totals.blockedPercent, 1)} %)`),
            el('span', {}, el('span', { text: 'Clients: ' }), totals.clients),
            link('#/queries', 'Query log')
        ),
        el(
            'div',
            { class: 'cards wide' },
            topTable('Most asked names', [name, count], top.domains, 'Nothing was asked.'),
            topTable('Most blocked names', [name, count], top.blockedDomains, 'Nothing was blocked.'),
            topTable(
                'Busiest clients',
                [{ title: 'Client', cell: (row) => el('a', { href: queriesOf(row.address), text: row.name || row.address, title: row.address }) }, count],
                top.clients,
                'No client was seen.'
            )
        )
    );
}
