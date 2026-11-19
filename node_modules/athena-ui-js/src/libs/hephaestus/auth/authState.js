//authState for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

/**
 * Who is signed in, kept in memory only. Nothing is written to a cookie or to the storage, so a script (an injected one too) cannot read
 * a credential from here: the real session is a cookie that only the server can read (HttpOnly). This object is the UI's copy of the
 * answer to "who am I", for menus, route guards and the page. The server decides what a person may do.
 *
 * After a reload the state is empty until restore() has asked the server.
 *
 * @param {object} [options]
 * @param {() => Promise<(object|null)>} [options.restore] asks the server who is signed in (for example GET /api/me with the cookie):
 *        resolves with the user object, or with null / throws when nobody is
 * @returns {{signIn: (user: object) => void, signOut: () => void, restore: () => Promise<object|null>, isSignedIn: () => boolean,
 *            getUser: () => (object|null), hasRole: (role: string) => boolean, onChange: (listener: Function) => Function,
 *            routerRules: (paths?: object) => object}}
 */
export function createAuthState(options = {}) {
    let user = null;
    const listeners = new Set();
    const notify = () => listeners.forEach(listener => listener(user));
    const set = next => {
        const changed = (next === null) !== (user === null) || JSON.stringify(next) !== JSON.stringify(user);
        user = next;
        if (changed) notify();
    };

    const state = {
        /** The server accepted the sign in: remember who it is (the user object comes from the server's answer). */
        signIn(next) { set(next ?? {}); },
        /** Forget the person. (End the session on the server too: this only clears the UI.) */
        signOut() { set(null); },
        /** Asks the server who is signed in. Resolves with the user, or null. Never throws. */
        async restore() {
            try {
                const found = await options.restore?.();
                set(found ?? null);
            } catch {
                set(null);
            }
            return user;
        },
        isSignedIn: () => user !== null,
        getUser: () => user,
        /** True when the user has the role (user.roles is a list, or user.role a single role). */
        hasRole: role => Boolean(user && (user.roles?.includes?.(role) || user.role === role)),
        /** Called with the user (or null) when somebody signs in or out. Returns a function that stops it. */
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        /** The \`auth\` option of createRouter: createRouter({ auth: auth.routerRules({ loginPath: "/signin" }) }). */
        routerRules: (paths = {}) => ({ isSignedIn: state.isSignedIn, hasRole: state.hasRole, ...paths })
    };
    return state;
}
