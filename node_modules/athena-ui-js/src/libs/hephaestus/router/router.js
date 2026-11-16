//router for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { matchRoute, normalizePath, parseQuery } from "./matchRoute.js";

/**
 * Creates a router that renders a page function into an outlet element.
 *
 * @param {object} options
 * @param {Object<string, Function|{handler: Function, title?: string}>} options.routes path pattern -> page
 *        function. Patterns support `:param` segments and a trailing `*`. A page function is called with
 *        `{ path, params, query }` after the outlet was emptied, and may return a promise.
 * @param {string} [options.outlet="wrapper"] id of the element the pages are rendered into
 * @param {"hash"|"history"} [options.mode="hash"] "history" needs the server to answer every path with the page
 * @param {(context) => void} [options.notFound] called when no route matches
 * @param {(context) => (boolean|string|void|Promise)} [options.beforeEach] guard: return false to cancel,
 *        or a path to redirect to (login redirect)
 * @param {(context) => void} [options.afterEach]
 * @param {string} [options.titlePrefix] document title is `${titlePrefix}${route.title}`
 * @returns {{start: Function, stop: Function, navigate: Function, current: Function, href: Function}}
 */
export function createRouter(options = {}) {
    const { routes = {}, outlet = "wrapper", mode = "hash", notFound, beforeEach, afterEach, titlePrefix = "" } = options;
    const entries = Object.entries(routes).map(([pattern, route]) => [pattern, typeof route === "function" ? { handler: route } : route]);
    let currentContext = null;
    let renderToken = 0;
    let started = false;

    const readLocation = () => mode === "hash"
        ? location.hash.replace(/^#/, "") || "/"
        : location.pathname + location.search;

    async function render(raw, depth = 0) {
        const token = ++renderToken;
        const path = normalizePath(raw);
        const query = parseQuery(String(raw).split("?")[1]?.split("#")[0] ?? "");
        let matched = null;
        for (const [pattern, route] of entries) {
            const params = matchRoute(pattern, path);
            if (params) {
                matched = { route, params };
                break;
            }
        }
        const context = { path, params: matched?.params ?? {}, query };

        const guard = await beforeEach?.(context);
        if (token !== renderToken || guard === false) return;
        if (typeof guard === "string" && depth < 5) {
            navigate(guard, { replace: true });
            return;
        }

        const host = document.getElementById(outlet);
        host?.replaceChildren();
        currentContext = context;
        if (!matched) {
            notFound?.(context);
        } else {
            if (matched.route.title) document.title = titlePrefix + matched.route.title;
            await matched.route.handler(context);
        }
        if (token === renderToken) afterEach?.(context);
    }

    const onChange = () => render(readLocation());

    function navigate(path, { replace = false } = {}) {
        if (mode === "hash") {
            const target = `#${path}`;
            if (location.hash === target) {
                render(path);
            } else if (replace) {
                location.replace(target);
            } else {
                location.hash = path;
            }
        } else {
            history[replace ? "replaceState" : "pushState"]({}, "", path);
            render(path);
        }
    }

    return {
        start() {
            if (started) return;
            started = true;
            window.addEventListener(mode === "hash" ? "hashchange" : "popstate", onChange);
            onChange();
        },
        stop() {
            started = false;
            window.removeEventListener(mode === "hash" ? "hashchange" : "popstate", onChange);
        },
        navigate,
        current: () => currentContext,
        // Value for an anchor's href.
        href: path => mode === "hash" ? `#${path}` : path
    };
}
