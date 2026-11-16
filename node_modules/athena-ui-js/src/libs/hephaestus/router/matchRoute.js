//matchRoute for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

export function normalizePath(path) {
    const clean = `/${String(path ?? "").split(/[?#]/)[0]}`.replace(/\/+/g, "/");
    return clean.length > 1 ? clean.replace(/\/$/, "") : clean;
}

export function parseQuery(search) {
    return Object.fromEntries(new URLSearchParams(search));
}

/**
 * Matches a path against a pattern. `:name` segments capture a value, a trailing `*` matches the rest.
 *
 * @returns {Object<string, string>|null} the captured params, or null when the path does not match
 */
export function matchRoute(pattern, path) {
    const patternParts = normalizePath(pattern).split("/").slice(1);
    const pathParts = normalizePath(path).split("/").slice(1);
    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
        const part = patternParts[i];
        if (part === "*") {
            params.rest = pathParts.slice(i).join("/");
            return params;
        }
        if (pathParts[i] === undefined) return null;
        if (part.startsWith(":")) {
            try {
                params[part.slice(1)] = decodeURIComponent(pathParts[i]);
            } catch {
                return null;
            }
        } else if (part !== pathParts[i]) {
            return null;
        }
    }
    return patternParts.length === pathParts.length ? params : null;
}
