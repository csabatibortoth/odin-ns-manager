/**
 * Stores the session after a successful login.
 *
 * @param {object} session
 * @param {*} [session.user] anything JSON serializable: name, roles, ...
 * @param {string} [session.token]
 * @param {boolean} [session.remember=false] keep the session after the browser closes
 * @param {number} [session.days] lifetime of a remembered session (default: the `session_days` setting)
 */
export function setSession({ user, token, remember, days }?: {
    user?: any;
    token?: string;
    remember?: boolean;
    days?: number;
}): void;
/** The stored session ({ user, token, at }), or null when nobody is logged in. */
export function getSession(): any;
export function isLoggedIn(): boolean;
/** Ends the session. */
export function logout(): void;
/**
 * Calls the listener with the session (or null) whenever somebody logs in or out.
 *
 * @returns {() => void} unsubscribe function
 */
export function onSessionChange(listener: any): () => void;
