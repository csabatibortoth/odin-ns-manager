// The blocking: its switch and its answer, the block lists that are
// downloaded, the rules that are set by hand, and the check of a name.

import { api, canWriteDns, isAdmin } from './api.js';
import {
    el, control, button, select, badge, activeBadge, notice, showError, formDialog, confirmDialog, formatDate,
    PAGE_SIZE, link, head, options, fact, card, searchBox, filter, activeFilter, listLoader,
} from './ui.js';
import { formatNumber } from './charts.js';

const BLOCKLIST_EXAMPLE = 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts';
const MODES = [['NULL_IP', 'The address 0.0.0.0'], ['NXDOMAIN', 'No such name']];
const POLL_SECONDS = 3;

const busy = (list) => list.active && (list.refreshing || list.status === 'pending');

function listState(list) {
    if (!list.active) return badge('Inactive', 'warn');
    if (list.refreshing) return badge('Downloading', 'warn');
    if (list.status === 'pending') return badge('Waiting', 'warn');
    if (list.status === 'error') return el('span', { title: list.lastError }, badge(list.refreshedAt ? 'Download failed' : 'Not downloaded', 'danger'));
    return badge('Active', 'ok');
}

export async function blocking($page, listId) {
    if (listId) return listEntries($page, listId);

    const write = canWriteDns();
    const $state = el('div', { class: 'summary' });
    const $lists = el('div');
    const $rules = el('div');
    const lists = { page: 1, q: '' };
    const rules = { page: 1, q: '', action: '', active: '' };
    let polling = null;

    const loadSettings = async () => {
        const settings = await api('GET', '/blocking/settings');
        const $mode = select(options(MODES), settings.mode).attr('aria-label', 'Answer for a blocked name').prop('disabled', !write);
        $mode.on('change', async () => {
            try {
                await api('PATCH', '/blocking/settings', { body: { mode: $mode.val() } });
                notice('ok', 'The answer for a blocked name is changed');
            } catch (err) {
                showError(err);
            }
            loadSettings().catch(showError);
        });
        $state.empty().append(
            fact('Blocking', settings.enabled ? badge('On', 'ok') : badge('Off', 'warn')),
            el('label', { class: 'inline-field' }, 'Answer for a blocked name', $mode),
            el('span', { class: 'spacer' }),
            write
                ? button(settings.enabled ? 'Switch off' : 'Switch on', async () => {
                    await api('PATCH', '/blocking/settings', { body: { enabled: !settings.enabled } });
                    notice('ok', settings.enabled ? 'Nothing is blocked any more; the lists and the rules are kept' : 'The blocking is switched on');
                    await loadSettings();
                }, settings.enabled ? 'small' : 'small primary')
                : null
        );
    };

    const loadLists = listLoader(
        $lists,
        lists,
        (state) => api('GET', '/blocking/lists', { query: { page: state.page, limit: PAGE_SIZE, q: state.q, sort: 'name' } }),
        [
            {
                title: 'List',
                cell: (list) => [
                    el('div', {}, link(`#/blocking/${list.id}`, list.name)),
                    el('div', { class: 'muted small break', text: list.url }),
                    list.description ? el('div', { class: 'small', text: list.description }) : null,
                    list.status === 'error' && list.lastError ? el('div', { class: 'field-error small', text: list.lastError }) : null,
                ],
            },
            { title: 'Names', class: 'num', cell: (list) => formatNumber(list.entryCount, 0) },
            { title: 'State', cell: listState },
            { title: 'Downloaded', cell: (list) => formatDate(list.refreshedAt) },
            ...(write
                ? [{
                    title: '',
                    class: 'actions',
                    cell: (list) => [
                        button('Update', async () => {
                            const updated = await api('POST', `/blocking/lists/${list.id}/refresh`);
                            if (updated.status === 'error') notice('error', `${updated.name} could not be downloaded: ${updated.lastError}`);
                            else notice('ok', `${updated.name} is downloaded: ${formatNumber(updated.entryCount, 0)} names`);
                            await reloadLists();
                        }, 'small'),
                        button('Edit', () => listDialog(list, reloadLists), 'small'),
                        button('Delete', () => deleteList(list, reloadLists), 'small danger'),
                    ],
                }]
                : []),
        ],
        () => (lists.q ? 'No block list matches the search.' : 'There are no block lists yet.')
    );

    // A list that is being downloaded is looked at again, until it is done
    async function reloadLists() {
        const result = await loadLists();
        clearTimeout(polling);
        if (result?.items.some(busy)) {
            polling = setTimeout(() => {
                if ($page[0].isConnected) reloadLists().catch(() => {});
            }, POLL_SECONDS * 1000);
        }
    }

    const loadRules = listLoader(
        $rules,
        rules,
        (state) => api('GET', '/blocking/rules', { query: { page: state.page, limit: PAGE_SIZE, q: state.q, action: state.action, active: state.active, sort: 'domain' } }),
        [
            { title: 'Domain', cell: (rule) => el('span', { class: 'mono break', text: rule.domain }) },
            { title: 'Rule', cell: (rule) => (rule.action === 'block' ? badge('Blocked', 'danger') : badge('Allowed', 'ok')) },
            { title: 'Names below it', cell: (rule) => (rule.includeSubdomains ? 'Included' : '–') },
            { title: 'Comment', cell: (rule) => rule.comment || '–' },
            { title: 'State', cell: (rule) => activeBadge(rule.active) },
            ...(write
                ? [{
                    title: '',
                    class: 'actions',
                    cell: (rule) => [
                        button('Edit', () => ruleDialog(rule, loadRules), 'small'),
                        button('Delete', () => deleteRule(rule, loadRules), 'small danger'),
                    ],
                }]
                : []),
        ],
        () => (rules.q || rules.action || rules.active ? 'No rule matches the filter.' : 'No domain is blocked or allowed by hand.')
    );
    const refilter = (state, load) => {
        state.page = 1;
        load().catch(showError);
    };

    $page.append(
        head(
            'Blocking',
            write ? button('Update all lists', async () => {
                const { started } = await api('POST', '/blocking/lists/refresh');
                notice('ok', `${started} list(s) are being downloaded`);
                await reloadLists();
            }) : null,
            write ? button('Add block list', () => listDialog(null, reloadLists), 'primary') : null
        ),
        el('p', {
            class: 'muted',
            text: 'Names the server does not look up: advertising, trackers, malware. They come from the block lists, which are downloaded from an address, and from the rules that are set by hand. The own zones and the standalone records come before the blocking.',
        }),
        $state,
        checkForm(),
        el('div', { class: 'toolbar page-head section-head' }, el('h3', { text: 'Block lists' })),
        el('div', { class: 'toolbar' }, searchBox('Search block lists', (q) => {
            lists.q = q;
            lists.page = 1;
            reloadLists().catch(showError);
        })),
        $lists,
        el('p', { class: 'muted small', text: `A list is matched by the exact name, and downloaded again regularly${isAdmin() ? ': see the settings' : ''}.` }),
        el(
            'div',
            { class: 'toolbar page-head section-head' },
            el('h3', { text: 'Rules' }),
            el('span', { class: 'spacer' }),
            write ? button('Add rule', () => ruleDialog(null, loadRules)) : null
        ),
        el('p', { class: 'muted', text: 'A rule blocks or allows one domain by hand, and wins over the block lists. The rule of the name itself decides, or else the nearest one above it that includes the names below.' }),
        el(
            'div',
            { class: 'toolbar' },
            searchBox('Search domains and comments', (q) => {
                rules.q = q;
                refilter(rules, loadRules);
            }),
            filter('Rule', options([['', 'All'], ['block', 'Blocked'], ['allow', 'Allowed']]), (action) => {
                rules.action = action;
                refilter(rules, loadRules);
            }),
            activeFilter((active) => {
                rules.active = active;
                refilter(rules, loadRules);
            })
        ),
        $rules
    );
    await Promise.all([loadSettings(), reloadLists(), loadRules()]);
}

// Tells whether a domain is blocked, and why
function checkForm() {
    const $domain = control({ inputType: 'text', id: 'check_domain', class: 'input' }).attr({
        placeholder: 'ads.example.com', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'none', required: true,
    });
    const $submit = control({ inputType: 'submit', value: 'Check', class: 'button' });
    const $result = el('div', { class: 'result', 'aria-live': 'polite' });

    const $form = el('form', { class: 'toolbar' }, el('label', { for: 'check_domain', class: 'grow' }, 'Is a domain blocked?', $domain), $submit).on('submit', async (event) => {
        event.preventDefault();
        $submit.prop('disabled', true);
        try {
            const r = await api('GET', '/blocking/check', { query: { domain: $domain.val().trim() } });
            let why = 'No rule and no list holds it';
            if (r.rule) why = `The rule of ${r.rule.domain}${r.rule.includeSubdomains && r.rule.domain !== r.domain ? ', which includes the names below it' : ''}: ${r.rule.action === 'block' ? 'blocked' : 'allowed'}`;
            else if (r.lists.length) why = `On the list(s): ${r.lists.map((list) => list.name).join(', ')}`;
            $result.empty().append(
                card(r.domain, [
                    ['Result', r.blocked ? badge('Blocked', 'danger') : badge('Not blocked', 'ok')],
                    ['Because', r.enabled ? why : `The blocking is switched off. ${why}`],
                ])
            );
        } catch (err) {
            if (err.details?.domain) $result.empty().append(el('p', { class: 'form-error', text: err.details.domain }));
            else showError(err);
        } finally {
            $submit.prop('disabled', false);
        }
    });
    return el('div', { class: 'check' }, $form, $result);
}

function listDialog(list, done) {
    formDialog({
        title: list ? `Edit block list ${list.name}` : 'Add block list',
        intro: list ? null : 'The list is downloaded in the background as soon as it is saved.',
        fields: [
            { name: 'name', label: 'Name', value: list?.name, required: true, maxlength: 100, placeholder: 'StevenBlack hosts' },
            {
                name: 'url', label: 'Address of the list', type: 'url', value: list?.url, required: true, placeholder: BLOCKLIST_EXAMPLE,
                hint: 'A hosts file ("0.0.0.0 ads.example.com"), a list of names, or the "||ads.example.com^" rules of an ad blocker, over http or https.',
            },
            { name: 'description', label: 'Description', value: list?.description, blank: 'empty', maxlength: 500 },
            { name: 'active', label: 'Active: used by the DNS server', type: 'checkbox', value: list ? list.active : true },
        ],
        onSubmit: async (values) => {
            const saved = list ? await api('PATCH', `/blocking/lists/${list.id}`, { body: values }) : await api('POST', '/blocking/lists', { body: values });
            notice('ok', saved.status === 'pending' ? `${saved.name} is saved, and is being downloaded` : `${saved.name} is saved`);
            await done();
        },
    });
}

function deleteList(list, done) {
    confirmDialog({
        title: `Delete block list ${list.name}?`,
        message: 'The list and all of its names are deleted. The names are looked up again, unless another list or a rule blocks them.',
        onConfirm: async () => {
            await api('DELETE', `/blocking/lists/${list.id}`);
            notice('ok', `Block list ${list.name} is deleted`);
            await done();
        },
    });
}

// preset: { domain, action } for a new rule, e.g. from the query log
export function ruleDialog(rule, done, preset = {}) {
    formDialog({
        title: rule ? `Edit the rule of ${rule.domain}` : 'Add rule',
        fields: [
            { name: 'domain', label: 'Domain', value: rule?.domain ?? preset.domain, required: true, placeholder: 'ads.example.com', hint: 'A fully qualified name. A domain can have one rule.' },
            {
                name: 'action', label: 'Rule', type: 'select', value: rule?.action ?? preset.action ?? 'block',
                options: options([['block', 'Block'], ['allow', 'Allow: look it up, also when a list blocks it']]),
            },
            { name: 'includeSubdomains', label: 'Also for every name below the domain', type: 'checkbox', value: rule ? rule.includeSubdomains : false },
            { name: 'comment', label: 'Comment', value: rule?.comment, blank: 'empty', maxlength: 500, placeholder: 'Why' },
            { name: 'active', label: 'Active: applied by the DNS server', type: 'checkbox', value: rule ? rule.active : true },
        ],
        onSubmit: async (values) => {
            const saved = rule ? await api('PATCH', `/blocking/rules/${rule.id}`, { body: values }) : await api('POST', '/blocking/rules', { body: values });
            notice('ok', `${saved.domain} is ${saved.action === 'block' ? 'blocked' : 'allowed'}`);
            await done?.();
        },
    });
}

function deleteRule(rule, done) {
    confirmDialog({
        title: `Delete the rule of ${rule.domain}?`,
        message: 'The block lists decide about this domain again.',
        onConfirm: async () => {
            await api('DELETE', `/blocking/rules/${rule.id}`);
            notice('ok', `The rule of ${rule.domain} is deleted`);
            await done();
        },
    });
}

///--- The names of a list

async function listEntries($page, listId) {
    const list = await api('GET', `/blocking/lists/${encodeURIComponent(listId)}`);
    const state = { page: 1, q: '' };
    const $list = el('div');

    const load = listLoader(
        $list,
        state,
        () => api('GET', `/blocking/lists/${list.id}/entries`, { query: { page: state.page, limit: 50, q: state.q } }),
        [{ title: 'Domain', cell: (domain) => el('span', { class: 'mono break', text: domain }) }],
        () => (state.q ? 'No name of the list matches the search.' : 'The list has no names: it is not downloaded yet.')
    );

    $page.append(
        el('p', { class: 'breadcrumb' }, link('#/blocking', 'Blocking'), ' / ', list.name),
        head(list.name),
        el(
            'div',
            { class: 'summary' },
            fact('Names', formatNumber(list.entryCount, 0)),
            fact('Downloaded', formatDate(list.refreshedAt)),
            listState(list),
            el('span', { class: 'muted small break', text: list.url })
        ),
        el('div', { class: 'toolbar' }, searchBox('Search the names of the list', (q) => {
            state.q = q;
            state.page = 1;
            load().catch(showError);
        })),
        $list
    );
    await load();
}
