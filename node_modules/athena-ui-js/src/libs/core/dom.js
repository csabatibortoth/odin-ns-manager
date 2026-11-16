//dom helpers for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

let counter = 0;

// Unique element id, for label / aria wiring.
export const uid = (prefix = "athena") => `${prefix}-${++counter}`;

/**
 * Creates an element.
 *
 * @param {string} tag
 * @param {object} [props]
 * @param {string} [props.class]
 * @param {string} [props.id]
 * @param {string} [props.text] set as textContent (never parsed as HTML)
 * @param {Object<string, string|boolean|number>} [props.attrs] attributes, false / null / undefined are skipped
 * @param {Object<string, Function>} [props.on] event listeners
 * @param {Object<string, *>} [props.prop] DOM properties (value, checked, disabled, ...)
 * @param {...(Node|string)} children
 */
export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    if (props.class) node.className = props.class;
    if (props.id) node.id = props.id;
    if (props.text != null) node.textContent = props.text;
    for (const [name, value] of Object.entries(props.attrs ?? {})) {
        if (value !== false && value != null) node.setAttribute(name, value === true ? "" : value);
    }
    for (const [name, handler] of Object.entries(props.on ?? {})) node.addEventListener(name, handler);
    Object.assign(node, props.prop);
    node.append(...children);
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

// Appends a node to a parent given as element or id. Falls back to the body.
export function mount(parent, node) {
    const host = typeof parent === "string" ? document.getElementById(parent) : parent;
    (host ?? document.body).append(node);
    return node;
}

export const cx = (...classes) => classes.filter(Boolean).join(" ");
