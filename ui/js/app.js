// The user interface of Odin NS Manager. Athena UI generates the page (header
// with the menu, content, footer) and the login form; the pages are in
// pages.js, blocking.js, monitoring.js and service.js.
//
// The menu of Athena UI is shown as a sidebar next to the content. Where the
// screen is too narrow for that it is a drawer, opened with the menu button of
// the header: see "Menu" in theme.css.

/* global $ */

import { init, clearWrapper, clearHeaderMenu, generateHeaderMenu, generateLoginForm } from '../vendor/athena-ui/athena-ui.js';
import { api, session, events, setToken, hasToken, onSessionEnd, isAdmin, canMonitor } from './api.js';
import { el, notice, closeDialog, errorText } from './ui.js';
import * as pages from './pages.js';
import { blocking } from './blocking.js';
import { queries, clients } from './monitoring.js';
import { backup, certificate } from './service.js';

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
    { group: 'Service', label: 'Settings', route: 'settings', render: pages.settings, admin: true },
    { group: 'Service', label: 'API docs', action: () => window.open('/api/docs/', '_blank', 'noopener'), when: () => session.info?.docsEnabled !== false },
    { group: 'You', label: 'Account', route: 'account', render: pages.account, own: true },
    { group: 'You', label: 'Sign out', action: signOut, own: true },
];

// Athena UI reads the menu from this object whenever the menu is generated
const menuItems = { headerMenu: [], footerMenu: [] };

const itemId = (item) => `menu-${item.route || item.label.toLowerCase().replace(/\W+/g, '-')}`;
const allowed = (item) =>
    Boolean(session.user) && (!item.admin || isAdmin()) && (!item.monitor || canMonitor()) && (!item.own || Boolean(session.user.id)) && (!item.when || item.when());
const currentRoute = () => location.hash.match(/^#\/([^/]*)\/?(.*)$/) || [null, '', ''];

function markActive() {
    const [, page] = currentRoute();
    $('#header_menu li').removeClass('active').removeAttr('aria-current');
    if (session.user) $(`#menu-${page}`).addClass('active').attr('aria-current', 'page');
}

///--- Menu

// Opens or closes the drawer the menu is on a narrow screen
function setMenuOpen(open, { focus = false } = {}) {
    $('body').toggleClass('menu-open', open);
    $('#menu_toggle').attr({ 'aria-expanded': String(open), 'aria-label': open ? 'Close the menu' : 'Open the menu' });
    if (!focus) return;
    if (open) $('#header_menu .menu-item.active span, #header_menu .menu-item span').first().trigger('focus');
    else $('#menu_toggle').trigger('focus');
}

// The button of the header that opens the menu, and what closes it again
function addMenuToggle() {
    const bar = () => el('span', { class: 'menu-toggle-bar' });
    $('#header').prepend(
        el('button', { id: 'menu_toggle', type: 'button', 'aria-controls': 'header_menu_container', 'aria-expanded': 'false', 'aria-label': 'Open the menu' }, bar(), bar(), bar())
            .on('click', () => setMenuOpen(!$('body').hasClass('menu-open'), { focus: true }))
    );
    $('#container').append(el('div', { id: 'menu_backdrop' }).on('click', () => setMenuOpen(false)));
    $(document).on('keydown', (event) => {
        if (event.key === 'Escape' && $('body').hasClass('menu-open') && !$('#myModal').is(':visible')) setMenuOpen(false, { focus: true });
    });
    // Wide enough for the sidebar again: nothing is left open behind it
    window.matchMedia('(max-width: 999px)').addEventListener('change', () => setMenuOpen(false));
}

function buildMenu() {
    const items = MENU.filter(allowed);
    menuItems.headerMenu.length = 0;
    for (const item of items) {
        menuItems.headerMenu.push({ id: itemId(item), class: 'menu-item', text: '', inner_text: item.label });
    }
    clearHeaderMenu();
    generateHeaderMenu();
    $('body').toggleClass('signed-in', Boolean(session.user));
    $('#header_menu_container').attr({ role: 'navigation', 'aria-label': 'Menu' });

    // The name of a group stands before its first item; the last group is the signed-in user
    const who = session.user ? session.user.displayName || session.user.username : '';
    items.forEach((item, index) => {
        if (!item.group || item.group === items[index - 1]?.group) return;
        const $title = item.group === 'You'
            ? el('li', { class: 'menu-group menu-user', role: 'presentation' }, el('strong', { text: who }), el('small', { text: session.user.role }))
            : el('li', { class: 'menu-group', role: 'presentation', text: item.group });
        $(`#${itemId(item)}`).before($title);
    });
    // Without accounts there is nothing below the name: it stands at the end by itself
    if (session.user && !session.user.id) {
        $('#header_menu').append(el('li', { class: 'menu-group menu-user', role: 'presentation' }, el('strong', { text: who }), el('small', { text: session.user.role })));
    }

    // The items of Athena UI are clicked; make them reachable with the keyboard as well
    $('#header_menu .menu-item span')
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

// Called by Athena UI with the label of the menu item that was clicked
function nav(label) {
    const item = MENU.find((candidate) => candidate.label === label);
    if (!item) return; // Athena UI also calls it, without a label, while it builds the page
    setMenuOpen(false);
    if (item.action) return item.action();
    go(`#/${item.route}`);
}

function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
}

let renders = 0;

// The addresses of the pages before 2.3.0
const MOVED = { blocklists: 'blocking' };

async function route() {
    closeDialog();
    setMenuOpen(false);
    // Errors stay until they are dismissed; the other notices belong to the page that is left
    $('#notices .notice:not(.error)').remove();
    if (!session.user) return showLogin();

    const [, page, id] = currentRoute();
    if (MOVED[page]) {
        location.replace(`#/${MOVED[page]}`);
        return;
    }
    const item = MENU.find((candidate) => candidate.route === page && allowed(candidate));
    if (!item) {
        location.replace('#/dashboard');
        return;
    }

    markActive();
    clearWrapper();
    window.scrollTo(0, 0);
    const render = ++renders;
    const $page = el('div', { class: 'page' });
    $('#wrapper').append($page);
    try {
        await item.render($page, decodeURIComponent(id || ''));
    } catch (err) {
        // A page that was left in the meantime does not report its failure
        if (render === renders && err?.status !== 401) $page.append(el('p', { class: 'empty', text: errorText(err) }));
    }
}

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
        $('#notices').empty();
        buildMenu();
        route(); // the page that was asked for before signing in
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
    route();
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
    addMenuToggle();
    events.userChanged = buildMenu;
    events.signedOut = signedOut;
    onSessionEnd(() => {
        if (session.user) signedOut('Your session has ended. Sign in again.', 'info');
    });
    $(window).on('hashchange', route);

    buildMenu();
    await route();
    if (!session.info) notice('error', 'The server can not be reached');
}

start();
