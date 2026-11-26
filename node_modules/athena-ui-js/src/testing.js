//testing helpers for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

// Helpers for the tests of an application that uses Athena UI (Node's test runner and jsdom, or a browser).
// They have no dependency of their own: you give installDom the JSDOM class of your own jsdom.
//
//   import { JSDOM } from "jsdom";
//   import { installDom, until, tick } from "athena-ui-js/testing";
//   const dom = installDom(JSDOM);
//   ...
//   dom.uninstall();

const GLOBALS = ["window", "document", "navigator", "Node", "Element", "HTMLElement", "Event", "CustomEvent", "KeyboardEvent",
    "MouseEvent", "PointerEvent", "DocumentFragment", "HTMLDialogElement", "MutationObserver", "getComputedStyle", "requestAnimationFrame",
    "cancelAnimationFrame", "localStorage", "location"];

const BOUND = new Set(["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]);

/**
 * jsdom has no layout, so scrollIntoView is missing. A no-op stand-in is enough for a test:
 * the call happens, and nothing throws in components that scroll an active option into view.
 */
export function installScrollIntoView(window) {
    const proto = window?.Element?.prototype;
    if (proto && !proto.scrollIntoView) proto.scrollIntoView = function () {};
}

/** After a focused element is removed, focus goes back to the body (some jsdom versions keep the dead element). */
export function fixActiveElement(document) {
    const active = document?.activeElement;
    if (active && active !== document.body && active.isConnected === false) {
        active.blur?.();                              // a body without tabindex is not focusable
        if (document.activeElement === active) document.body?.focus?.();   // older jsdom fallback
    }
}

/** Wraps the removal methods so focus is fixed as soon as an element goes away, not on the next tick. */
export function installFocusFixup(window) {
    const restores = [];
    const wrap = (object, name) => {
        if (typeof object?.[name] !== "function") return;
        const original = object[name];
        object[name] = function (...args) {
            const result = original.apply(this, args);
            fixActiveElement(window.document);
            return result;
        };
        restores.push(() => { object[name] = original; });
    };
    wrap(window.Element?.prototype, "remove");
    wrap(window.Node?.prototype, "removeChild");
    wrap(window.Element?.prototype, "replaceChildren");
    return () => restores.forEach(restore => restore());
}

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
export function installDom(JSDOM, html = '<!doctype html><html><body><div id="wrapper"></div></body></html>', options = {}) {
    const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, ...options });
    const { window } = dom;
    installScrollIntoView(window);
    const restoreFocus = installFocusFixup(window);
    // jsdom has the <dialog> element but not showModal() and close(): a small stand-in (no top layer, no focus trap, which a test does not need)
    const dialogs = window.HTMLDialogElement?.prototype;
    if (dialogs && !dialogs.showModal) {
        dialogs.show = dialogs.showModal = function () { this.setAttribute("open", ""); };
        dialogs.close = function () {
            if (!this.hasAttribute("open")) return;
            this.removeAttribute("open");
            this.dispatchEvent(new window.Event("close"));
        };
    }
    const saved = new Map();
    for (const name of GLOBALS) {
        saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        const value = name === "window" ? window : window[name];
        if (value === undefined) continue;
        // Functions of the window (getComputedStyle, requestAnimationFrame, ...) need the window as `this`.
        const bound = BOUND.has(name) ? value.bind(window) : value;
        Object.defineProperty(globalThis, name, { value: bound, configurable: true, writable: true });
    }
    return {
        window,
        document: window.document,
        uninstall() {
            restoreFocus();
            for (const [name, descriptor] of saved) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else delete globalThis[name];
            }
            window.close();
        }
    };
}

/** Waits for `ms` milliseconds (0 = the next turn of the event loop). */
export const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Waits until `condition()` returns something truthy, and returns that value.
 * Throws after `timeout` ms, naming `message`, so a test fails with a reason instead of hanging.
 */
export async function until(condition, { timeout = 2000, interval = 10, message = "condition" } = {}) {
    const start = Date.now();
    for (;;) {
        const value = await condition();
        if (value) return value;
        if (Date.now() - start > timeout) throw new Error(`Timed out after ${timeout} ms waiting for ${message}`);
        await tick(interval);
    }
}
