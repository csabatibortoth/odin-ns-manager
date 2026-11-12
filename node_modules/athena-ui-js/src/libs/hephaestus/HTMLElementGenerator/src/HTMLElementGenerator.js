//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/HTMLElementGenerator
//Version: 0.3.0

import {
    noBodyOrParentError,
    reportError,
    undefinedError,
    wrongInputTypeError,
} from './errors.js';

// Supported element types, each mapped to the extra options copied onto it as attributes.
const ELEMENT_ATTRIBUTES = new Map([
    ['div', []],
    ['span', []],
    ['p', []],
    ['h1', []],
    ['h2', []],
    ['h3', []],
    ['h4', []],
    ['h5', []],
    ['h6', []],
    ['img', ['src', 'alt']],
]);

export const supportedElements = Object.freeze([...ELEMENT_ATTRIBUTES.keys()]);

function createElement(options, attributes) {
    const { id, class: className, text, data, onclick, onchange } = options;
    const element = document.createElement(options.elementType);

    if (id != null) element.id = id;
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    for (const name of attributes) {
        if (options[name] != null) element.setAttribute(name, options[name]);
    }

    // Listeners are only attached when a handler was actually provided.
    if (typeof onclick === 'function') {
        element.addEventListener('click', () => onclick(data));
    }
    if (typeof onchange === 'function') {
        element.addEventListener('change', () => onchange(data));
    }
    return element;
}

/**
 * Generates an HTML element and appends it to its parent.
 *
 * @param {object} options
 * @param {string} options.elementType one of `supportedElements`
 * @param {string} [options.parent] id of the parent element; omitted or '' appends to body
 * @param {string} [options.id]
 * @param {string} [options.class]
 * @param {string} [options.text]
 * @param {string} [options.src] img only
 * @param {string} [options.alt] img only
 * @param {*} [options.data] passed to the onclick / onchange handlers
 * @param {(data: *) => void} [options.onclick]
 * @param {(data: *) => void} [options.onchange]
 * @returns {HTMLElement|null} the generated element, or null when generation failed
 */
export function HTMLElementGenerator(options) {
    if (options == null) {
        return reportError(undefinedError('options', 'HTMLElementGenerator'));
    }

    const attributes = ELEMENT_ATTRIBUTES.get(options.elementType);
    if (!attributes) {
        return reportError(wrongInputTypeError('options', 'HTMLElementGenerator', options));
    }

    const { body } = document;
    const parent = options.parent ? document.getElementById(options.parent) : body;
    if (!parent && !body) {
        return reportError(noBodyOrParentError('parent', 'HTMLElementGenerator'));
    }

    const element = createElement(options, attributes);
    if (parent) {
        parent.append(element);
    } else {
        // Unknown parent id: fall back to a wrapper div on the body.
        const wrapper = document.createElement('div');
        wrapper.append(element);
        body.append(wrapper);
    }
    return element;
}

export default HTMLElementGenerator;
