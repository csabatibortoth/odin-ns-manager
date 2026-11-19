export function normalizePath(path: any): string;
export function parseQuery(search: any): {
    [k: string]: string;
};
/**
 * Matches a path against a pattern. `:name` segments capture a value, a trailing `*` matches the rest.
 *
 * @returns {Object<string, string>|null} the captured params, or null when the path does not match
 */
export function matchRoute(pattern: any, path: any): {
    [x: string]: string;
} | null;
