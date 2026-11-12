//application hooks for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

/* global appConfig, menuItems, nav, login */

// Hooks can be passed to init({ nav, login, menuItems }). When they are not, the
// page-level globals of the same name (appConfig, menuItems, nav, login) are used.
// Globals are looked up on every call, so they may be defined after init().

const hooks = {};

export function setHooks(options = {}) {
    for (const name of ["nav", "login", "menuItems"]) {
        if (options[name] !== undefined) hooks[name] = options[name];
    }
}

export function getAppConfig() {
    return typeof appConfig !== "undefined" ? appConfig : undefined;
}

export function getMenuItems() {
    return hooks.menuItems ?? (typeof menuItems !== "undefined" ? menuItems : undefined);
}

export function getNav() {
    return hooks.nav ?? (typeof nav === "function" ? nav : undefined);
}

export function getLogin() {
    return hooks.login ?? (typeof login === "function" ? login : undefined);
}
