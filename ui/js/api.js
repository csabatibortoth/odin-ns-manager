// The client of the API of the manager, and the session of the signed-in user.

const TOKEN_KEY = 'odin.token';

// The token lives as long as the tab does
let token = sessionStorage.getItem(TOKEN_KEY);
let sessionEnded = () => {};

export const session = {
    info: null, // what the service tells about itself to anybody
    user: null, // the signed-in user
};

// Set by the application: the signed-in user changed, or has to sign in again
export const events = {
    userChanged: () => {},
    signedOut: () => {},
};

export const isAdmin = () => session.user?.role === 'admin';
// May the user change zones and records? The server decides; this is for what is offered.
export const canWriteDns = () => Boolean(session.info?.dnsWriteRoles?.includes(session.user?.role));

export class ApiError extends Error {
    constructor(status, message, details) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

export const hasToken = () => Boolean(token);

export function setToken(value) {
    token = value || null;
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
}

// handler is called when the server no longer accepts the token
export function onSessionEnd(handler) {
    sessionEnded = handler;
}

// path is relative to /api. options: { query, body, quiet } - quiet: a 401 answer
// is an ordinary error for the caller, and does not end the session.
export async function api(method, path, { query = {}, body, quiet = false } = {}) {
    const url = new URL(`/api${path}`, location.origin);
    for (const [name, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, value);
    }

    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response;
    try {
        response = await fetch(url, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: 'no-store',
        });
    } catch {
        throw new ApiError(0, 'The server can not be reached');
    }

    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
        const error = new ApiError(response.status, data?.error || `Request failed (${response.status})`, data?.details);
        if (response.status === 401 && !quiet) sessionEnded(error);
        throw error;
    }
    return data;
}
