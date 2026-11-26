/**
 * jsdom has no layout, so scrollIntoView is missing. A no-op stand-in is enough for a test:
 * the call happens, and nothing throws in components that scroll an active option into view.
 */
export function installScrollIntoView(window: any): void;
/** After a focused element is removed, focus goes back to the body (some jsdom versions keep the dead element). */
export function fixActiveElement(document: any): void;
/** Wraps the removal methods so focus is fixed as soon as an element goes away, not on the next tick. */
export function installFocusFixup(window: any): () => void;
/**
 * Makes a jsdom window the global one, so Athena components can run in Node.
 * The components create their events from the element's own window, so no global Event is needed for them,
 * but code written without that care (and tests) can still use `new Event(...)`.
 *
 * @param {new (html?: string, options?: object) => {window: object}} JSDOM the JSDOM class of jsdom
 * @param {string} [html] page to start with
 * @param {object} [options] passed to JSDOM (default: url "http://localhost/", pretendToBeVisual so animation frames work)
 * @returns {{window: object, document: Document, uninstall: () => void}}
 */
export function installDom(JSDOM: new (html?: string, options?: object) => {
    window: object;
}, html?: string, options?: object): {
    window: object;
    document: Document;
    uninstall: () => void;
};
/**
 * Waits until `condition()` returns something truthy, and returns that value.
 * Throws after `timeout` ms, naming `message`, so a test fails with a reason instead of hanging.
 */
export function until(condition: any, { timeout, interval, message }?: {
    timeout?: number;
    interval?: number;
    message?: string;
}): Promise<any>;
export function tick(ms?: number): Promise<any>;
