export default Cookies;
export namespace Cookies {
    export { get };
    export { set };
    export { remove };
}
/** The value of a cookie, or undefined. Without a name: all cookies as an object. */
declare function get(name: any): any;
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
declare function set(name: string, value: string, attributes?: {
    expires?: number | Date;
    path?: string;
    domain?: string;
    sameSite?: "strict" | "lax" | "none";
    secure?: boolean;
}): void;
/** Removes a cookie. Give the same path, domain and sameSite it was set with. */
declare function remove(name: any, attributes?: {}): void;
