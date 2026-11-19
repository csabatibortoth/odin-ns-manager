//controls for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui
//Moved here from HTMLControlGenerator 0.4.1 (https://github.com/csabatibortoth/HTMLControlGenerator), which is no longer developed.
//The calls are the same; there is no jQuery in it any more (since 2.0 `create` returns the element, not a jQuery object).

import { el, resolveElement } from "./dom.js";
import { noBodyOrParentError, reportError, undefinedError, wrongInputTypeError } from "./errors.js";

// Inputs, select and lists (ul / ol with items) from a plain options object, without jQuery.

const INPUT_TYPES = [
    "text", "password", "submit", "reset", "radio", "checkbox", "button",
    "color", "date", "datetime-local", "email", "file", "month", "number",
    "range", "search", "tel", "time", "url", "week"
];
const WITHOUT_VALUE = new Set(["reset", "file"]);   // a file input's value cannot be set, and reset keeps the browser's label
const WITH_MIN_MAX = new Set(["date", "number", "range"]);
const CHECKABLE = new Set(["radio", "checkbox"]);
const EVENTS = ["change", "click"];

// `onchange` is the option name, `change` is accepted as an alias of it.
const handlerFor = (source, event) => {
    const handler = source[`on${event}`] ?? (event === "change" ? source.change : undefined);
    return typeof handler === "function" ? handler : undefined;
};

function base(tag, options) {
    return el(tag, { id: options.id, class: options.class });
}

function formControl(tag, options) {
    const control = base(tag, options);
    if (options.name != null) control.name = options.name;
    if (options.readOnly != null) control.readOnly = Boolean(options.readOnly);
    if (options.disabled != null) control.disabled = Boolean(options.disabled);
    for (const event of EVENTS) {
        const handler = handlerFor(options, event);
        if (handler) control.addEventListener(event, () => handler.call(options, options.data));
    }
    return control;
}

function input(options) {
    const type = options.inputType;
    const control = formControl("input", options);
    control.type = type;
    if (options.value !== undefined && !WITHOUT_VALUE.has(type)) control.value = options.value;
    if (WITH_MIN_MAX.has(type)) {
        if (options.min != null) control.min = options.min;
        if (options.max != null) control.max = options.max;
    }
    if (CHECKABLE.has(type)) control.checked = Boolean(options.checked);
    return control;
}

function select(options) {
    const control = formControl("select", options);
    for (const item of options.items ?? []) {
        control.append(el("option", { text: item.text, prop: { value: item.value, selected: Boolean(item.selected) } }));
    }
    return control;
}

function list(options) {
    const items = [...(options.items ?? [])];
    const control = base(options.inputType, options);
    for (const item of items) control.append(el("li", { id: item.id, class: item.class, text: item.text }));
    // One listener per event on the list: an item's own handler wins, otherwise the handler of the list is called.
    for (const event of EVENTS) {
        if (![options, ...items].some(source => handlerFor(source, event))) continue;
        control.addEventListener(event, e => {
            const li = e.target.closest?.("li");
            if (!li || li.parentElement !== control) return;
            const item = items[[...control.children].indexOf(li)];
            const source = item && handlerFor(item, event) ? item : options;
            handlerFor(source, event)?.call(source, source.data);
        });
    }
    return control;
}

const factories = new Map([...INPUT_TYPES.map(type => [type, input]), ["select", select], ["ul", list], ["ol", list]]);

/** Builds the control described by `options` without appending it. Returns the element, or null (an error is reported). */
export function buildControl(options) {
    if (options === undefined) return reportError(undefinedError("options", "HTMLControlGenerator"));
    const factory = factories.get(options.inputType);
    if (!factory) return reportError(wrongInputTypeError("options", "HTMLControlGenerator", options));
    return factory(options);
}

/**
 * Registers a new input type. `factory(options)` returns the element to append.
 * Addons use this to plug in their controls, see registerHungarianInputControls.
 */
export function registerControl(inputType, factory) {
    factories.set(inputType, factory);
}

/**
 * Builds a control from `{ inputType, id, class, name, value, items, onclick, onchange, ... }` and appends it to the element given as
 * `parent` (an id or an element; without one, to the body).
 *
 * @returns {HTMLElement|undefined} the control, or undefined when the input type is not known
 */
export function generateControl(options = {}) {
    const control = buildControl(options);
    if (!control) return undefined;
    (resolveElement(options.parent) ?? document.body).append(control);
    return control;
}

/**
 * The HTMLControlGenerator of the standalone project (0.4.1), so code written for it keeps working.
 * `HTMLControlGenerator(options)` builds the control and appends it to the element with the id `options.parent`
 * (an unknown id appends it, in a div, to the body). It is also a global once Athena UI is loaded.
 */
export function HTMLControlGenerator(options) {
    const control = buildControl(options);
    if (!control) return;
    if (options.parent === undefined) {
        reportError(undefinedError("options.parent", "HTMLControlGenerator"));
        return;
    }
    const parent = document.getElementById(options.parent);
    if (parent) {
        parent.append(control);
    } else if (document.body) {
        const wrapper = document.createElement("div");
        wrapper.append(control);
        document.body.append(wrapper);
    } else {
        reportError(noBodyOrParentError("parent", "HTMLControlGenerator"));
    }
}

/**
 * Builds the control without appending it and returns the element (the standalone project returned a jQuery object: wrap it yourself with
 * `$(HTMLControlGenerator.create(options))` if you still need one). Undefined when the options are not valid.
 */
HTMLControlGenerator.create = options => buildControl(options) ?? undefined;

HTMLControlGenerator.register = registerControl;
