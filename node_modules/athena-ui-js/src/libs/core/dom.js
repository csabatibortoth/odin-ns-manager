//dom helpers for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { isSafeUrl } from "./sanitize.js";

let counter = 0;

// What el() refuses, so that data can never turn into script: event handler attributes (on*), inline style (a strict
// Content-Security-Policy forbids it anyway), srcdoc, and DOM properties that parse HTML.
const BLOCKED_ATTRIBUTE = /^(on|style$|srcdoc$)/i;
const BLOCKED_PROPERTY = /^(on|innerHTML$|outerHTML$|srcdoc$|insertAdjacentHTML$)/i;
const URL_ATTRIBUTE = new Set(["href", "src", "action", "formaction", "poster", "xlink:href", "cite", "data"]);

// Unique element id, for label / aria wiring.
export const uid = (prefix = "athena") => `${prefix}-${++counter}`;

/**
 * Creates an element. This is the safe way to write pages: text is only ever inserted as text, attributes that run code
 * (on*, style, srcdoc) and unsafe addresses (javascript:, data:, ...) in href / src / action are refused, listeners have to be
 * functions, and children can be given as nested lists.
 *
 * @param {string} tag
 * @param {object} [props]
 * @param {string} [props.class]
 * @param {string} [props.id]
 * @param {string} [props.text] set as textContent (never parsed as HTML)
 * @param {Object<string, string|boolean|number>} [props.attrs] attributes, false / null / undefined are skipped
 * @param {Object<string, Function>} [props.on] event listeners (a value that is not a function throws a TypeError)
 * @param {Object<string, *>} [props.prop] DOM properties (value, checked, disabled, ...), not the ones that parse HTML
 * @param {...(Node|string|number|Array|null|false)} children text, nodes, or lists of them
 */
export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    if (props.class) node.className = props.class;
    if (props.id) node.id = props.id;
    if (props.text != null) node.textContent = props.text;
    for (const [name, value] of Object.entries(props.attrs ?? {})) {
        if (value === false || value == null) continue;
        if (BLOCKED_ATTRIBUTE.test(name)) {
            console.warn(`Athena UI: the attribute "${name}" is not allowed in el()`);
            continue;
        }
        if (URL_ATTRIBUTE.has(name.toLowerCase()) && !isSafeUrl(value)) {
            console.warn(`Athena UI: an unsafe address was refused in "${name}"`);
            continue;
        }
        node.setAttribute(name, value === true ? "" : value);
    }
    for (const [name, handler] of Object.entries(props.on ?? {})) {
        if (typeof handler !== "function") throw new TypeError(`Athena UI: the "${name}" listener has to be a function`);
        node.addEventListener(name, handler);
    }
    for (const [name, value] of Object.entries(props.prop ?? {})) {
        if (BLOCKED_PROPERTY.test(name)) throw new TypeError(`Athena UI: the property "${name}" is not allowed in el()`);
        node[name] = value;
    }
    for (const child of children) setContent(node, child);
    return node;
}

/**
 * Fills a node with content. Strings are inserted as text, never as HTML.
 * Accepts a string / number, a Node, an array of those, or a function returning one.
 */
export function setContent(node, content) {
    if (typeof content === "function") content = content();
    if (content == null || content === false) return node;
    if (Array.isArray(content)) content.forEach(item => setContent(node, item));
    else node.append(content instanceof Node ? content : document.createTextNode(String(content)));
    return node;
}

/**
 * Finds an element from an element, an id or a CSS selector ("#list", ".panel > ul").
 * An id wins over a selector with the same text. Returns null when nothing matches.
 */
export function resolveElement(target) {
    if (target instanceof Element) return target;
    if (typeof target !== "string" || !target) return null;
    const byId = document.getElementById(target);
    if (byId) return byId;
    try {
        return document.querySelector(target);
    } catch {
        return null; // not a valid selector
    }
}

// Appends a node to a parent given as element, id or selector. Falls back to the body.
export function mount(parent, node) {
    (resolveElement(parent) ?? document.body).append(node);
    return node;
}

/**
 * Gives a component the same handle as every other one: { element, update(), destroy() }.
 * What the component already has is kept. `update` does nothing unless the component supports it
 * (it returns the handle), `destroy` removes the element (and `also`, e.g. a wrapper around it).
 */
export function asHandle(handle, { element = handle.element, also } = {}) {
    handle.element ??= element;
    handle.update ??= () => handle;
    handle.destroy ??= () => (also ?? element)?.remove();
    return handle;
}

export const cx = (...classes) => classes.filter(Boolean).join(" ");

/**
 * A stricter el(): only the tags and attributes on your lists are allowed, everything else is refused (a tag throws, an attribute is
 * skipped with a warning). For pages that are built from data you do not control, such as a plugin API. The refusals of el() still apply.
 *
 * @param {object} allow
 * @param {string[]} [allow.tags] allowed tag names (default: any)
 * @param {string[]} allow.attributes allowed attribute names, lower case: ["class", "title", "href"]
 * @param {boolean} [allow.dataAndAria=true] data-* and aria-* attributes are allowed too
 * @returns {typeof el}
 */
export function createSafeBuilder({ tags, attributes = [], dataAndAria = true } = {}) {
    const allowedTags = tags ? new Set(tags.map(tag => tag.toLowerCase())) : null;
    const allowedAttributes = new Set(attributes.map(name => name.toLowerCase()));
    return (tag, props = {}, ...children) => {
        if (allowedTags && !allowedTags.has(String(tag).toLowerCase())) throw new TypeError(`Athena UI: the tag "${tag}" is not allowed here`);
        const attrs = {};
        for (const [name, value] of Object.entries(props.attrs ?? {})) {
            const lower = name.toLowerCase();
            if (allowedAttributes.has(lower) || (dataAndAria && (lower.startsWith("data-") || lower.startsWith("aria-")))) attrs[name] = value;
            else console.warn(`Athena UI: the attribute "${name}" is not on the allow-list`);
        }
        return el(tag, { ...props, attrs }, ...children);
    };
}
