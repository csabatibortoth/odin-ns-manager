//session for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import config from "../../config/config.js";
import Cookies from "../../core/cookies.js";

// The session is kept in a cookie, so the page knows after a reload who is logged in.
// A cookie written from script can be read by any script of the page: keep only what the UI needs
// (a name, roles, a short lived token) and let the server enforce the real authorization. A server
// set `HttpOnly` session cookie is the safer place for the actual credentials.

const listeners = new Set();

function notify() {
    const session = getSession();
    listeners.forEach(listener => listener(session));
}

/**
 * Stores the session after a successful login.
 *
 * @param {object} session
 * @param {*} [session.user] anything JSON serializable: name, roles, ...
 * @param {string} [session.token]
 * @param {boolean} [session.remember=false] keep the session after the browser closes
 * @param {number} [session.days] lifetime of a remembered session (default: the `session_days` setting)
 */
export function setSession({ user, token, remember = false, days = config.session_days } = {}) {
    Cookies.set(config.session_cookie, JSON.stringify({ user, token, at: Date.now() }), {
        expires: remember ? days : undefined,
        sameSite: "strict",
        secure: location.protocol === "https:"
    });
    notify();
}

/** The stored session ({ user, token, at }), or null when nobody is logged in. */
export function getSession() {
    const raw = Cookies.get(config.session_cookie);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function isLoggedIn() {
    return getSession() !== null;
}

/** Ends the session. */
export function logout() {
    Cookies.remove(config.session_cookie, { sameSite: "strict", secure: location.protocol === "https:" });
    notify();
}

/**
 * Calls the listener with the session (or null) whenever somebody logs in or out.
 *
 * @returns {() => void} unsubscribe function
 */
export function onSessionChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
