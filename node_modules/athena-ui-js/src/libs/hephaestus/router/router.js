//router for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { resolveElement } from "../../core/dom.js";
import { viewTransition } from "../../core/motion.js";
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
 * @param {(context) => void} [options.afterEach] same as onShown
 * @param {(context, route) => void} [options.onRender] called after the outlet was emptied, before the page function runs
 * @param {(context, route) => void} [options.onShown] called after the page function finished (and it was not replaced by a newer
 *        navigation): the place to set the title, move the focus to the content, scroll to the top
 * @param {boolean} [options.focusContent=false] after a page is shown the outlet gets the focus (it is made focusable for that), so a
 *        screen reader starts reading the new page and the keyboard continues there
 * @param {boolean} [options.scrollTop=false] scroll to the top after a page is shown
 * @param {boolean} [options.transition=false] a page change is a view transition (document.startViewTransition): the old page cross-fades into the new one,
 *        and elements with a `view-transition-name` move from one page to the next. Without the API, or under reduced motion, nothing changes. The old page
 *        stays on the screen until the page function of the new one is done, so pages that need long to build should draw something quickly.
 * @param {object} [options.auth] sign-in rules for routes, see the route options below
 * @param {() => boolean} [options.auth.isSignedIn]
 * @param {(role: string) => boolean} [options.auth.hasRole]
 * @param {string} [options.auth.loginPath="/login"] where `auth: true` routes send a visitor who is not signed in (with `?next=<path>`)
 * @param {string} [options.auth.homePath="/"] where `guestOnly` routes send a signed-in person
 * @param {string} [options.auth.forbiddenPath] where a person without the role goes (default: homePath)
 * @param {string} [options.titlePrefix] document title is `${titlePrefix}${route.title}`
 *
 * A route is a page function, or an object: `{ handler, title, auth: true, guestOnly: true, roles: ["admin"], guard(context) }`.
 * `auth`, `guestOnly` and `roles` are checked with options.auth; `guard` is a function that gets the same context and returns
 * false (stay where you are), a path (redirect) or anything else (go on); it runs after the rules.
 * @returns {{start: Function, stop: Function, navigate: Function, current: Function, href: Function,
 *            onChange: (listener: (context) => void) => Function}}
 *          `onChange(listener)` is called with the context after every page that is shown (menus and breadcrumbs follow the router
 *          with it) and returns a function that stops it.
 */
export function createRouter(options = {}) {
    const { routes = {}, outlet = "wrapper", mode = "hash", notFound, beforeEach, afterEach, titlePrefix = "" } = options;
    const rules = { loginPath: "/login", homePath: "/", ...options.auth };
    const listeners = new Set();
    const entries = Object.entries(routes).map(([pattern, route]) => [pattern, typeof route === "function" ? { handler: route } : route]);
    let currentContext = null;
    let renderToken = 0;
    let started = false;

    const readLocation = () => mode === "hash"
        ? location.hash.replace(/^#/, "") || "/"
        : location.pathname + location.search;

    // The rules of a route and its own guard. Returns false, a path to redirect to, or undefined.
    async function checkRoute(route, context) {
        const signedIn = Boolean(rules.isSignedIn?.());
        if (route.guestOnly && signedIn) return rules.homePath;
        if (route.auth && !signedIn) return `${rules.loginPath}?next=${encodeURIComponent(context.path)}`;
        if (route.roles?.length && !route.roles.some(role => rules.hasRole?.(role))) return rules.forbiddenPath ?? rules.homePath;
        const result = await route.guard?.(context);
        return result === false || typeof result === "string" ? result : undefined;
    }

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

        let guard = await beforeEach?.(context);
        if (token !== renderToken) return;
        if (guard !== false && typeof guard !== "string" && matched) {
            guard = await checkRoute(matched.route, context);
            if (token !== renderToken) return;
        }
        if (guard === false) return;
        if (typeof guard === "string" && depth < 5) {
            navigate(guard, { replace: true });
            return;
        }

        const host = resolveElement(outlet);
        const show = async () => {
            if (token !== renderToken) return;       // a newer navigation took over while the transition was starting
            host?.replaceChildren();
            currentContext = context;
            options.onRender?.(context, matched?.route);
            if (!matched) {
                notFound?.(context);
            } else {
                if (matched.route.title) document.title = titlePrefix + matched.route.title;
                await matched.route.handler(context);
            }
        };
        if (options.transition) await viewTransition(show);
        else await show();
        if (token !== renderToken) return;
        if (options.focusContent && host) {
            if (!host.hasAttribute("tabindex")) host.setAttribute("tabindex", "-1");
            host.focus({ preventScroll: true });
        }
        if (options.scrollTop) window.scrollTo(0, 0);
        options.onShown?.(context, matched?.route);
        afterEach?.(context);
        listeners.forEach(listener => listener(context));
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
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        // Value for an anchor's href.
        href: path => mode === "hash" ? `#${path}` : path
    };
}
