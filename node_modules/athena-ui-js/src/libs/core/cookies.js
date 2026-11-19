//cookies for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

// A small cookie helper (it replaces js-cookie, which Athena UI used to bundle). Same calls for what Athena needs:
// Cookies.get(name), Cookies.set(name, value, attributes), Cookies.remove(name, attributes).

const encode = value => encodeURIComponent(String(value)).replace(/%(2[346BF]|3[AC-F]|40|5[BDE]|60|7[BCD])/g, decodeURIComponent);
const decode = value => value.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);

/**
 * @param {string} name
 * @param {string} value
 * @param {object} [attributes]
 * @param {number|Date} [attributes.expires] days from now, or a Date. Without it the cookie ends with the browser session.
 * @param {string} [attributes.path="/"]
 * @param {string} [attributes.domain]
 * @param {"strict"|"lax"|"none"} [attributes.sameSite]
 * @param {boolean} [attributes.secure]
 */
function set(name, value, attributes = {}) {
    const { expires, path = "/", domain, sameSite, secure } = attributes;
    let text = `${encode(name)}=${encode(value)}`;
    if (expires != null) {
        const date = expires instanceof Date ? expires : new Date(Date.now() + expires * 864e5);
        text += `; expires=${date.toUTCString()}`;
    }
    if (path) text += `; path=${path}`;
    if (domain) text += `; domain=${domain}`;
    if (sameSite) text += `; samesite=${sameSite}`;
    if (secure) text += "; secure";
    document.cookie = text;
}

/** The value of a cookie, or undefined. Without a name: all cookies as an object. */
function get(name) {
    const all = {};
    for (const part of document.cookie ? document.cookie.split("; ") : []) {
        const at = part.indexOf("=");
        const key = decode(part.slice(0, at));
        if (name === undefined || key === name) all[key] = decode(part.slice(at + 1));
        if (key === name) break;
    }
    return name === undefined ? all : all[name];
}

/** Removes a cookie. Give the same path, domain and sameSite it was set with. */
function remove(name, attributes = {}) {
    set(name, "", { ...attributes, expires: -1 });
}

const Cookies = { get, set, remove };
export default Cookies;
export { Cookies };
