// The user interface of Odin NS Manager. Athena UI generates the page (header
// with the menu, content, footer), the login form, the notices and the
// dialogs, and routes the pages; the pages are in pages.js, blocking.js,
// monitoring.js and service.js.
//
// The menu is the menu of Athena UI with its submenus: a bar in the header with
// a dropdown for every group, and on a tablet or a phone a bar of tabs at the
// bottom of the screen, where a group opens as a sheet. See "Menu" in theme.css.

/* global $ */

import {
    init, clearWrapper, clearHeaderMenu, generateHeaderMenu, generateLoginForm, generateDropdown, generateAvatar, createRouter,
} from '../vendor/athena-ui/athena-ui.js';
import { api, session, events, setToken, hasToken, onSessionEnd, isAdmin, canMonitor } from './api.js';
import { el, notice, clearNotices, closeDialog, errorText } from './ui.js';
import * as pages from './pages.js';
import { blocking } from './blocking.js';
import { queries, clients } from './monitoring.js';
import { backup, certificate, sync, plugins } from './service.js';
import * as ui from './ui.js';
import { icon } from './icons.js';
import { THEMES, MODES, setTheme, setMode, onAppearanceChange, refresh as refreshTheme } from './theme.js';

// The pages of the menu, in its groups. admin: only for admins; monitor: only
// for the roles of the monitoring; own: only when users sign in; when: any other condition
const MENU = [
    { label: 'Dashboard', route: 'dashboard', render: pages.dashboard },
    { group: 'DNS', label: 'Zones', route: 'zones', render: pages.zones },
    { group: 'DNS', label: 'Records', route: 'records', render: pages.records },
    { group: 'DNS', label: 'Blocking', route: 'blocking', render: blocking },
    { group: 'DNS', label: 'Lookup', route: 'lookup', render: pages.lookup },
    { group: 'Monitoring', label: 'Queries', route: 'queries', render: queries, monitor: true },
    { group: 'Monitoring', label: 'Clients', route: 'clients', render: clients, monitor: true },
    { group: 'Service', label: 'Users', route: 'users', render: pages.users, admin: true },
    { group: 'Service', label: 'Logs', route: 'logs', render: pages.logs, admin: true },
    { group: 'Service', label: 'Backup', route: 'backup', render: backup, admin: true },
    { group: 'Service', label: 'Certificate', route: 'certificate', render: certificate, admin: true },
    { group: 'Service', label: 'Synchronization', route: 'sync', render: sync, admin: true },
    { group: 'Service', label: 'Plugins', route: 'plugins', render: plugins, admin: true },
    { group: 'Service', label: 'Settings', route: 'settings', render: pages.settings, admin: true },
    { group: 'Service', label: 'API docs', action: () => window.open('/api/docs/', '_blank', 'noopener'), when: () => session.info?.docsEnabled !== false },
    { group: 'You', label: 'Account', route: 'account', render: pages.account, own: true },
    { group: 'You', label: 'Sign out', action: signOut, own: true },
];

// The pages of the plugins that are running, for the user that is signed in; they stand before the account
let pluginItems = [];
const menuList = () => {
    const at = MENU.findIndex((item) => item.group === 'You');
    return [...MENU.slice(0, at), ...pluginItems, ...MENU.slice(at)];
};

async function loadPlugins() {
    try {
        const entries = session.user ? await api('GET', '/service/plugins/menu', { quiet: true }) : [];
        pluginItems = entries.map((entry) => ({ group: entry.group, label: entry.label, route: 'plugin', arg: entry.plugin, script: entry.script, render: pluginPage }));
    } catch {
        pluginItems = [];
    }
}

// The page of a plugin is a module of its own: export async function render($page, ui)
async function pluginPage($page, name) {
    const item = pluginItems.find((candidate) => candidate.arg === name);
    const module = await import(`/plugins/${encodeURIComponent(name)}/${item.script}`);
    await module.render($page, { api, session, ui });
}

// Athena UI reads the menu from this object whenever the menu is generated
const menuItems = { headerMenu: [], footerMenu: [] };

const GROUP_ICONS = { DNS: 'dns', Monitoring: 'monitoring', Service: 'service', You: 'user' };
const slug = (text) => text.toLowerCase().replace(/\W+/g, '-');
const itemId = (item) => `menu-${item.arg ? `${item.route}-${item.arg}` : item.route || slug(item.label)}`;
const groupId = (group) => `menu-group-${slug(group)}`;
const allowed = (item) =>
    Boolean(session.user) && (!item.admin || isAdmin()) && (!item.monitor || canMonitor()) && (!item.own || Boolean(session.user.id)) && (!item.when || item.when());
const who = () => (session.user ? session.user.displayName || session.user.username : '');

// The page and its argument from the address: #/zones/abc -> ['zones', 'abc']
function currentPath() {
    const [, page = '', argument = ''] = location.hash.match(/^#\/([^/]*)\/?(.*)$/) || [];
    let decoded = argument;
    try {
        decoded = decodeURIComponent(argument);
    } catch {
        // Not valid: the page will not be found
    }
    return [page, decoded];
}

function markActive() {
    $('#header_menu li').removeClass('active');
    $('#header_menu .submenu-item').removeAttr('aria-current');
    if (!session.user) return;

    const [page, argument] = currentPath();
    const item = menuList().find((candidate) => candidate.route === page && (!candidate.arg || candidate.arg === argument));
    if (!item) return;
    if (!item.group) {
        $(`#${itemId(item)}`).addClass('active');
        return;
    }
    const $group = $(`#${groupId(item.group)}`).addClass('active');
    $group.find('.submenu-item').filter((_, entry) => entry.textContent === item.label).attr('aria-current', 'page');
}

///--- Menu

// The items of the menu: the pages without a group stand by themselves, every
// group is an item with its pages as the entries of its submenu
function buildMenu() {
    const items = menuList().filter(allowed);
    const extras = new Map(); // the id of an item -> what is drawn on it
    menuItems.headerMenu.length = 0;

    for (const item of items) {
        if (!item.group) {
            const id = itemId(item);
            extras.set(id, { icon: 'dashboard' });
            menuItems.headerMenu.push({ id, class: 'menu-item', text: '', inner_text: item.label });
            continue;
        }
        const id = groupId(item.group);
        let entry = menuItems.headerMenu.find((candidate) => candidate.id === id);
        if (!entry) {
            // The last group is the signed-in user, who is named by the name
            const you = item.group === 'You';
            entry = { id, class: 'menu-item', text: '', inner_text: you ? who() : item.group, children: [] };
            menuItems.headerMenu.push(entry);
            extras.set(id, { icon: GROUP_ICONS[item.group] || 'more', you, title: you ? 'Account' : item.group });
        }
        entry.children.push({ inner_text: item.label });
    }

    clearHeaderMenu();
    generateHeaderMenu();
    $('body').toggleClass('signed-in', Boolean(session.user));
    $('#header_menu_container').attr({ role: 'navigation', 'aria-label': 'Menu' });

    // An icon before every label; the user has the avatar of Athena UI instead
    for (const [id, extra] of extras) {
        const $item = $(`#${CSS.escape(id)}`);
        const $label = $item.children('span').first();
        const text = $label.text();
        $label.empty().append(extra.you ? generateAvatar({ name: text, size: 'small' }) : icon(extra.icon), el('span', { class: 'menu-label', text }));
        if (extra.you) $item.addClass('menu-end');
        if (extra.title) $item.find('.submenu').attr('aria-label', extra.title);
    }

    // The items of Athena UI are clicked; make them reachable with the keyboard as well
    $('#header_menu > li:not(.has-submenu) > span')
        .attr({ role: 'link', tabindex: 0 })
        .on('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                $(event.currentTarget).trigger('click');
            }
        });

    showFooter();
    markActive();
}

///--- Look: the theme and the mode, chosen in the menu at the right of the header

function addAppearanceMenu() {
    const $tools = el('div', { id: 'header_tools' });
    $('#header').append($tools);

    const choose = (items, set) => items.map((item) => ({ label: item.name, onclick: () => set(item.id) }));
    const dropdown = generateDropdown({
        parent: $tools[0],
        align: 'right',
        label: '',
        items: [...choose(THEMES, setTheme), { divider: true }, ...choose(MODES, setMode)],
    });

    // An icon button, and the names of the two parts of the menu
    const toggle = dropdown.element.querySelector('.dropdown-toggle');
    toggle.replaceChildren(icon('appearance'));
    toggle.setAttribute('aria-label', 'Look of the interface');
    toggle.title = 'Look of the interface';

    const menu = dropdown.element.querySelector('.dropdown-menu');
    const entries = [...menu.querySelectorAll('.dropdown-item')];
    const heading = (text) => el('div', { class: 'dropdown-heading', role: 'presentation', text })[0];
    entries[0].before(heading('Theme'));
    menu.querySelector('.dropdown-divider').replaceWith(heading('Mode'));
    entries.forEach((entry, index) => {
        entry.dataset.choice = index < THEMES.length ? THEMES[index].id : MODES[index - THEMES.length].id;
        if (index < THEMES.length) entry.title = THEMES[index].description;
    });

    // What is chosen is ticked. The ids of the themes and of the modes differ.
    onAppearanceChange(({ theme, mode }) => {
        for (const entry of entries) {
            if (entry.dataset.choice === theme || entry.dataset.choice === mode) entry.setAttribute('aria-current', 'true');
            else entry.removeAttribute('aria-current');
        }
    });
}

// The footer of Athena UI: the name of the server, its version and its build.
// Written again with the menu, as the name can be changed in the settings.
function footerText() {
    const info = session.info;
    const names = [info?.name, info?.company].filter(Boolean).join(' · ') || 'Odin NS Manager';
    return [names, info?.version ? `v${info.version}` : null, pages.buildText(info?.build)].filter(Boolean).join(' · ');
}

function showFooter() {
    const build = session.info?.build;
    $('#copyright_text')
        .text(footerText())
        .attr('title', build?.date ? `Built from the commit of ${new Date(build.date).toLocaleString()}` : null);
}

///--- Pages

// Called by Athena UI with the label of the menu item that was clicked
function nav(label) {
    const item = menuList().find((candidate) => candidate.label === label);
    if (!item) return; // Athena UI also calls it, without a label, while it builds the page
    if (item.action) return item.action();
    router.navigate(item.arg ? `/${item.route}/${encodeURIComponent(item.arg)}` : `/${item.route}`);
}

// Shows the page of the address again
const reroute = () => router.navigate(location.hash.replace(/^#/, '') || '/');

// The addresses of the pages before 2.3.0
const MOVED = { blocklists: 'blocking' };

let renders = 0;

// Before every page: who is allowed to see it. Returns false when something
// else is shown instead, or the address to go to.
function guard({ params }) {
    closeDialog();
    // Errors stay until they are dismissed; the other notices belong to the page that is left
    $('.toast:not(.alert-error)').remove();
    const { page, id } = params;

    if (!session.user) {
        if (page === 'forgot' && session.info?.passwordReset) showForgot();
        else if (page === 'reset' && id) showReset(id);
        else showLogin();
        return false;
    }
    if (MOVED[page]) return `/${MOVED[page]}`;
    if (!menuList().some((candidate) => candidate.route === page && (!candidate.arg || candidate.arg === id) && allowed(candidate))) return '/dashboard';
    return undefined;
}

async function showPage({ params }) {
    const item = menuList().find((candidate) => candidate.route === params.page && (!candidate.arg || candidate.arg === params.id));
    markActive();
    window.scrollTo(0, 0);
    document.title = `${item.label} · ${session.info?.name || 'Odin NS Manager'}`;

    const render = ++renders;
    const $page = el('div', { class: 'page' });
    $('#wrapper').append($page);
    try {
        await item.render($page, params.id || '');
    } catch (err) {
        // A page that was left in the meantime does not report its failure
        if (render === renders && err?.status !== 401) $page.append(el('p', { class: 'empty', text: errorText(err) }));
    }
}

const router = createRouter({
    routes: { '/:page': showPage, '/:page/:id': showPage },
    notFound: () => router.navigate('/dashboard', { replace: true }),
    beforeEach: guard,
});

///--- Signing in and out

function showLogin() {
    markActive();
    clearWrapper();
    generateLoginForm();

    const $form = $('#loginForm');
    $form.wrap(el('div', { class: 'login-page' }));
    $form.before(
        el('h2', { text: 'Sign in' }),
        el('p', { class: 'muted', text: `to ${session.info?.name || 'Odin NS Manager'}` })
    );
    $('#loginForm-password-control').attr({ autocomplete: 'current-password', 'aria-label': 'Password' });
    $('#loginForm-username-control')
        .attr({ autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Username or e-mail' })
        .trigger('focus');
    $form.on('keydown', 'input', (event) => {
        if (event.key === 'Enter') $('#loginForm-submit-login').trigger('click');
    });
    if (session.info?.passwordReset) $form.after(el('p', { class: 'muted' }, ui.link('#/forgot', 'Forgot your password?')));
}

// A page of the lost password mails: it stands where the login form does
function showAccountPage(title, text, ...body) {
    markActive();
    clearWrapper();
    $('#wrapper').append(
        el('div', { class: 'login-page' }, el('h2', { text: title }), text ? el('p', { class: 'muted', text }) : null, body, el('p', { class: 'muted' }, ui.link('#/login', 'Back to sign in')))
    );
}

function showForgot() {
    const $done = el('p', { class: 'banner', role: 'status' }).hide();
    const $form = ui.inlineForm({
        fields: [{ name: 'email', label: 'E-mail address of your account', type: 'email', required: true, autocomplete: 'email' }],
        submitLabel: 'Send the link',
        onSubmit: async (values) => {
            await api('POST', '/service/password-reset/request', { body: values, quiet: true });
            $done.text('If there is an account with this address, a mail with a link is on its way. The link works for an hour.').show();
        },
    });
    showAccountPage('Lost password', 'A link to choose a new one is mailed to the address of your account.', $form, $done);
    $form.find('input').first().trigger('focus');
}

async function showReset(token) {
    let valid = false;
    try {
        valid = (await api('GET', `/service/password-reset/${encodeURIComponent(token)}`, { quiet: true })).valid;
    } catch (err) {
        ui.notice('error', errorText(err));
    }
    if (!valid) {
        showAccountPage('Choose a new password', 'This link is not valid any more. Ask for a new one.', el('p', {}, ui.link('#/forgot', 'Lost password')));
        return;
    }
    const $form = ui.inlineForm({
        fields: [
            { name: 'password', label: 'New password', type: 'password', required: true, autocomplete: 'new-password', hint: '8 to 128 characters.' },
            { name: 'repeat', label: 'New password again', type: 'password', required: true, autocomplete: 'new-password', send: false },
        ],
        submitLabel: 'Change the password',
        onSubmit: async (values, raw) => {
            if (raw.password !== raw.repeat) throw ui.fieldError('repeat', 'The two passwords are not the same');
            await api('POST', `/service/password-reset/${encodeURIComponent(token)}`, { body: values, quiet: true });
            history.replaceState(null, '', '#/login');
            reroute();
            ui.notice('ok', 'Your password is changed. Sign in with it.');
        },
    });
    showAccountPage('Choose a new password', null, $form);
    $form.find('input').first().trigger('focus');
}

// Called by Athena UI with what is typed in its login form
async function login({ username, password }) {
    const $submit = $('#loginForm-submit-login');
    if (!username?.trim() || !password) {
        notice('error', 'Enter your username and password');
        return;
    }
    $submit.prop('disabled', true);
    try {
        const result = await api('POST', '/auth/login', { body: { username: username.trim(), password }, quiet: true });
        setToken(result.token);
        session.user = result.user;
        clearNotices();
        await loadPlugins();
        buildMenu();
        reroute(); // the page that was asked for before signing in
    } catch (err) {
        notice('error', err.status === 401 ? 'Wrong username or password' : errorText(err));
        $('#loginForm-password-control').val('').trigger('focus');
    } finally {
        $submit.prop('disabled', false);
    }
}

// The user is signed out, by themselves or by the server
function signedOut(message, kind = 'ok') {
    setToken(null);
    session.user = null;
    buildMenu();
    if (location.hash !== '#/login') history.replaceState(null, '', '#/login');
    reroute();
    if (message) notice(kind, message);
}

async function signOut() {
    try {
        await api('POST', '/auth/logout', { quiet: true });
    } catch {
        // Signed out here in any case
    }
    signedOut('You are signed out');
}

///--- Start

async function start() {
    try {
        session.info = await api('GET', '/service/info', { quiet: true });
    } catch {
        session.info = null;
    }
    if (session.info?.authEnabled === false || hasToken()) {
        try {
            session.user = await api('GET', '/auth/me', { quiet: true });
        } catch {
            setToken(null);
        }
    }

    await init({
        theme: { href: 'css/theme.css' },
        config: {
            header_title_text: 'Odin NS Manager',
            header_img_url: 'img/logo.svg',
            // The footer is written by showFooter, with the build next to the version
            copyright: 'Odin NS Manager',
            version: session.info?.version || '–',
            bordered: false,
            login_enabled: true,
        },
        menuItems,
        nav,
        login,
    });

    $('#wrapper').before(el('div', { id: 'notices', 'aria-live': 'polite' }));
    addAppearanceMenu();
    refreshTheme(); // the stylesheet is loaded now: the bar of the browser takes its color
    events.userChanged = buildMenu;
    events.signedOut = signedOut;
    onSessionEnd(() => {
        if (session.user) signedOut('Your session has ended. Sign in again.', 'info');
    });

    await loadPlugins();
    buildMenu();
    router.start();
    if (!session.info) notice('error', 'The server can not be reached');
}

start();
