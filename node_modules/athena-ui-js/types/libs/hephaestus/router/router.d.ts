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
export function createRouter(options?: {
    routes: {
        [x: string]: Function | {
            handler: Function;
            title?: string;
        };
    };
    outlet?: string;
    mode?: "hash" | "history";
    notFound?: (context: any) => void;
    beforeEach?: (context: any) => (boolean | string | void | Promise<any>);
    afterEach?: (context: any) => void;
    onRender?: (context: any, route: any) => void;
    onShown?: (context: any, route: any) => void;
    focusContent?: boolean;
    scrollTop?: boolean;
    transition?: boolean;
    auth?: {
        isSignedIn?: () => boolean;
        hasRole?: (role: string) => boolean;
        loginPath?: string;
        homePath?: string;
        forbiddenPath?: string;
    };
    titlePrefix?: string;
}): {
    start: Function;
    stop: Function;
    navigate: Function;
    current: Function;
    href: Function;
    onChange: (listener: (context: any) => void) => Function;
};
