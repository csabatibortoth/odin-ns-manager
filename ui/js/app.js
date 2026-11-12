// The user interface of Odin NS Manager. Athena UI generates the page (header
// with the menu, content, footer) and the login form; the pages are in pages.js.

/* global $ */

import { init, clearWrapper, clearHeaderMenu, generateHeaderMenu, generateLoginForm } from '../vendor/athena-ui/athena-ui.js';
import { api, session, events, setToken, hasToken, onSessionEnd, isAdmin } from './api.js';
import { el, notice, closeDialog, errorText } from './ui.js';
import * as pages from './pages.js';

// The pages of the menu. admin: only for admins; own: only when users sign in
const MENU = [
    { label: 'Status', route: 'status', render: pages.status },
    { label: 'Zones', route: 'zones', render: pages.zones },
    { label: 'Lookup', route: 'lookup', render: pages.lookup },
    { label: 'Users', route: 'users', render: pages.users, admin: true },
    { label: 'Logs', route: 'logs', render: pages.logs, admin: true },
    { label: 'Account', route: 'account', render: pages.account, own: true },
    { label: 'Sign out', action: signOut, own: true },
];

// Athena UI reads the menu from this object whenever the menu is generated
const menuItems = { headerMenu: [], footerMenu: [] };

const allowed = (item) => Boolean(session.user) && (!item.admin || isAdmin()) && (!item.own || Boolean(session.user.id));
const currentRoute = () => location.hash.match(/^#\/([^/]*)\/?(.*)$/) || [null, '', ''];

function markActive() {
    const [, page] = currentRoute();
    $('#header_menu li').removeClass('active').removeAttr('aria-current');
    if (session.user) $(`#menu-${page}`).addClass('active').attr('aria-current', 'page');
}

function buildMenu() {
    menuItems.headerMenu.length = 0;
    for (const item of MENU.filter(allowed)) {
        menuItems.headerMenu.push({ id: `menu-${item.route || 'signout'}`, class: 'menu-item', text: '', inner_text: item.label });
    }
    clearHeaderMenu();
    generateHeaderMenu();

    // The items of Athena UI are clicked; make them reachable with the keyboard as well
    $('#header_menu .menu-item span')
        .attr({ role: 'link', tabindex: 0 })
        .on('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                $(event.currentTarget).trigger('click');
            }
        });

    if (session.user) {
        const who = session.user.displayName || session.user.username;
        $('#header_menu_container').append(el('span', { id: 'session_user', text: `${who} · ${session.user.role}` }));
    }
    markActive();
}

// Called by Athena UI with the label of the menu item that was clicked
function nav(label) {
    const item = MENU.find((candidate) => candidate.label === label);
    if (!item) return; // Athena UI also calls it, without a label, while it builds the page
    if (item.action) return item.action();
    go(`#/${item.route}`);
}

function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
}

let renders = 0;

async function route() {
    closeDialog();
    // Errors stay until they are dismissed; the other notices belong to the page that is left
    $('#notices .notice:not(.error)').remove();
    if (!session.user) return showLogin();

    const [, page, id] = currentRoute();
    const item = MENU.find((candidate) => candidate.route === page && allowed(candidate));
    if (!item) {
        location.replace('#/status');
        return;
    }

    markActive();
    clearWrapper();
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

    const company = session.info?.company;
    await init({
        theme: { href: 'css/theme.css' },
        config: {
            header_title_text: 'Odin NS Manager',
            header_img_url: 'img/logo.svg',
            copyright: [session.info?.name, company].filter(Boolean).join(' · ') || 'Odin NS Manager',
            version: session.info?.version || '–',
            bordered: false,
            login_enabled: true,
        },
        menuItems,
        nav,
        login,
    });

    $('#wrapper').before(el('div', { id: 'notices', 'aria-live': 'polite' }));
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
