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
export function createAuthState(options?: {
    restore?: () => Promise<(object | null)>;
}): {
    signIn: (user: object) => void;
    signOut: () => void;
    restore: () => Promise<object | null>;
    isSignedIn: () => boolean;
    getUser: () => (object | null);
    hasRole: (role: string) => boolean;
    onChange: (listener: Function) => Function;
    routerRules: (paths?: object) => object;
};
