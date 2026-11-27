//Widget grid of Athena UI: a dashboard of widgets that can be added, configured, moved, resized, locked, saved and loaded.
//Layout is CSS grid. The place of a widget is a few CSS classes (no inline style), the maths is in core/gridLayout.js.
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { animate, prefersReducedMotion } from "../../core/motion.js";
import { asHandle, el, resolveElement, uid } from "../../core/dom.js";
import { translate } from "../../core/i18n.js";
import { showFormDialog } from "../dialogGenerator/dialogGenerator.js";
import { clampItem, compact, findFreeSpot, normalize, placeItem } from "../../core/gridLayout.js";

/* ------------------REGISTRY------------------- */

const registry = new Map();

/**
 * Registers a type of widget, so grids can create it, load it from a saved layout and show its settings.
 *
 * @param {string} type name of the type, for example "stat" (it is saved in layouts)
 * @param {object} definition
 * @param {(context: WidgetContext) => (void|Function|{update?: Function, destroy?: Function})} definition.render builds the widget into `context.element`;
 *        it may return a function (called when the widget goes away) or an object with `update(context)` and `destroy(context)`
 * @param {(context: WidgetContext) => void} [definition.update] called (throttled) when the config or the title changed; without it the widget is rendered again
 * @param {(context: WidgetContext, size: {width: number, height: number}) => void} [definition.resize] called (throttled) when the body changes its size
 * @param {(context: WidgetContext) => void} [definition.destroy] called when the widget is removed or the grid is destroyed
 * @param {object[]|((widget: object) => object[])} [definition.configForm] field definitions (see generateField) of the settings dialog; the field `name` is the key in the config
 * @param {object} [definition.defaultConfig] config of a new widget
 * @param {string} [definition.title] title of a new widget
 * @param {string} [definition.description] one line about the type, shown by createWidgetGallery
 * @param {{w: number, h: number}} [definition.defaultSize={w: 3, h: 2}] size in grid cells
 * @param {{w?: number, h?: number}} [definition.minSize]
 * @param {{w?: number, h?: number}} [definition.maxSize]
 *
 * @typedef {object} WidgetContext
 * @property {string} id
 * @property {string} type
 * @property {HTMLElement} element the body of the widget: build into it
 * @property {object} config the current config (read it again in update())
 * @property {string} title
 * @property {{width: number, height: number}} size the box of the body, as it is now
 * @property {{width: number, height: number}} contentSize what is left inside the padding of the body: the room a chart or a table has
 * @property {(title: string) => void} setTitle
 */
export function registerWidget(type, definition) {
    if (typeof type !== "string" || !/^[\w.:-]{1,100}$/.test(type)) throw new TypeError("Athena UI: a widget type is a short name of letters, digits and . _ : -");
    if (typeof definition?.render !== "function") throw new TypeError(`Athena UI: the widget type "${type}" needs a render function`);
    registry.set(type, definition);
}

/** Forgets a widget type. Widgets of it that are in grids stay and are shown as unknown. */
export function unregisterWidget(type) {
    return registry.delete(type);
}

/** The names of the registered widget types. */
export function getWidgetTypes() {
    return [...registry.keys()];
}

/** What a gallery needs to know about a type (null when it is not registered). */
export function getWidgetType(type) {
    const def = registry.get(type);
    return def ? { type, title: String(def.title ?? type), description: String(def.description ?? "") } : null;
}

/* ------------------CLASSES FOR PLACES------------------- */

// A place is a few classes whose rules are written into one constructed style sheet of the document (or shadow root): the strict
// Content-Security-Policy that forbids the style attribute allows it, and the browser lays the grid out.
const sheets = new WeakMap();
function classSheet(root) {
    if (!sheets.has(root)) {
        const usable = typeof CSSStyleSheet === "function" && Array.isArray(root.adoptedStyleSheets) && typeof CSSStyleSheet.prototype.replaceSync === "function";
        const sheet = usable ? new CSSStyleSheet() : null;
        if (sheet) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        sheets.set(root, { sheet, rules: new Map() });
    }
    return sheets.get(root);
}

/** Gives the class of one declaration (and writes its rule the first time); returns "" without constructed style sheets. */
function useClass(root, name, css) {
    const state = classSheet(root);
    if (!state.sheet) return "";
    if (!state.rules.has(name)) {
        state.rules.set(name, `.${name} { ${css} }`);
        state.sheet.replaceSync(`@layer athena {\n${[...state.rules.values()].join("\n")}\n}`);
    }
    return name;
}

const PLACE_CLASSES = [["x", "wg-x", n => `grid-column-start: ${n + 1}`], ["y", "wg-y", n => `grid-row-start: ${n + 1}`], ["w", "wg-w", n => `grid-column-end: span ${n}`], ["h", "wg-h", n => `grid-row-end: span ${n}`]];

/** Puts a node on a place. With CSSOM as the fallback where there are no constructed style sheets (still no style attribute in the markup). */
function setPlace(root, node, place) {
    const classes = [];
    for (const [key, prefix, css] of PLACE_CLASSES) {
        const name = useClass(root, `${prefix}-${place[key]}`, css(place[key]));
        if (name) classes.push(name);
    }
    if (classes.length) {
        for (const old of node.dataset.placeClasses?.split(" ").filter(Boolean) ?? []) if (!classes.includes(old)) node.classList.remove(old);
        node.classList.add(...classes);
        node.dataset.placeClasses = classes.join(" ");
    } else {
        node.style.gridColumn = `${place.x + 1} / span ${place.w}`;
        node.style.gridRow = `${place.y + 1} / span ${place.h}`;
    }
}

/* ------------------HELPERS------------------- */

const wholeNumber = (value, min, max, fallback) => (Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : fallback);
const plain = value => {
    // a JSON copy without the keys that change prototypes
    const text = JSON.stringify(value ?? {});
    if (text.length > 200000) throw new RangeError("Athena UI: the config of a widget is too large");
    return JSON.parse(text, (key, item) => (key === "__proto__" || key === "constructor" || key === "prototype" ? undefined : item));
};
const isPlainObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const SAFE_ID = /^[\w.:-]{1,100}$/;
const LAYOUT_VERSION = 1;

/* ------------------THE GRID------------------- */

/**
 * A grid of widgets.
 *
 * @param {object} options
 * @param {string|HTMLElement} options.element the container
 * @param {number} [options.columns=12] columns when there are no breakpoints
 * @param {number} [options.rowHeight=80] height of a row in px
 * @param {number} [options.gap=12] gap between widgets in px
 * @param {Record<string, {minWidth?: number, columns: number}>} [options.breakpoints] layouts by the width of the container, for example
 *        `{ large: { minWidth: 900, columns: 12 }, small: { minWidth: 0, columns: 4 } }`. A breakpoint without a layout of its own is derived from the widest one.
 * @param {object[]} [options.widgets] first widgets: `{ type, title?, config?, x?, y?, w?, h?, locked?, id? }`
 * @param {object} [options.layout] a saved layout (getLayout()), used instead of `widgets`
 * @param {boolean} [options.editable=false] edit mode: move, resize, settings, duplicate, remove
 * @param {boolean} [options.compact=true] widgets fall upwards when there is room (false: they stay where they are put)
 * @param {boolean} [options.animate=true] widgets slide to their new places (never under reduced motion)
 * @param {string} [options.label] accessible name of the dashboard
 * @param {"push"|"swap"} [options.collision="push"] what a widget moved onto another does: push it down, or exchange places (when that fits)
 * @param {number} [options.maxWidgets=200]
 * @param {number} [options.changeDelay=0] ms to wait after a change before onChange is called (a drag is many steps: one call after the last); 0 calls it at once. `flush()` calls it now
 * @param {(layout: object, reason: string) => void} [options.onChange] called after a change made by the person or by add/remove/...: "move", "resize", "add", "remove", "duplicate", "settings", "lock", "undo", "redo"
 * @returns the handle: { element, addWidget, addWidgetWithSettings, flush, removeWidget, duplicateWidget, configureWidget, updateWidget, getWidget, getWidgets, lockWidget, setEditable, isEditable,
 *          getLayout, setLayout, undo, redo, canUndo, canRedo, getBreakpoint, beginDrop, destroy }
 */
export function createWidgetGrid(options = {}) {
    const element = resolveElement(options.element);
    if (!element) throw new TypeError("Athena UI: createWidgetGrid needs an element");
    const root = element.getRootNode?.() ?? document;
    const rowHeight = wholeNumber(options.rowHeight, 20, 1000, 80);
    const gap = wholeNumber(options.gap, 0, 100, 12);
    const compactItems = options.compact !== false;
    const animateMoves = options.animate !== false;
    const collision = options.collision === "swap" ? "swap" : "push";
    const maxWidgets = wholeNumber(options.maxWidgets, 1, 2000, 200);
    const breakpoints = Object.entries(options.breakpoints ?? { default: { minWidth: 0, columns: options.columns ?? 12 } })
        .map(([name, value]) => ({ name, minWidth: wholeNumber(value.minWidth, 0, 100000, 0), columns: wholeNumber(value.columns, 1, 48, 12) }))
        .sort((a, b) => b.minWidth - a.minWidth);
    if (!breakpoints.length) throw new TypeError("Athena UI: createWidgetGrid needs at least one breakpoint");

    /** @type {Map<string, any>} */
    const widgets = new Map();
    let breakpoint = breakpoints[0];
    let editable = false;
    let gesture = null;
    let destroyed = false;
    let starting = true;     // the first widgets are not a change
    const timers = new Set();

    const live = el("div", { class: "athena-visually-hidden", attrs: { role: "status", "aria-live": "polite" } });
    element.after(live);
    element.classList.add("athena-widget-grid");
    if (options.label) element.setAttribute("aria-label", options.label);
    element.setAttribute("role", "group");
    const announce = text => {
        live.textContent = "";
        live.textContent = text;
    };

    const intersection = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries => {
        for (const entry of entries) {
            const widget = widgets.get(entry.target.dataset.widgetId);
            if (!widget) continue;
            widget.visible = entry.isIntersecting;
            if (widget.visible) showWidget(widget);
        }
    }) : null;
    const resizing = typeof ResizeObserver === "function" ? new ResizeObserver(entries => {
        for (const entry of entries) {
            const node = entry.target;
            if (node === element) {
                const next = pickBreakpoint();
                if (next !== breakpoint) switchBreakpoint(next);
                continue;
            }
            const widget = widgets.get(node.closest(".widget")?.dataset.widgetId);
            if (widget) later(widget, "resizeTimer", () => {
                if (!widget.rendered) return;
                measure(widget);       // the size the widget is asked about is the one it has now
                widget.def?.resize?.(widget.context, widget.context.size);
            }, 100);
        }
    }) : null;

    function later(owner, key, fn, ms) {
        clearTimeout(owner[key]);
        owner[key] = setTimeout(() => {
            timers.delete(owner[key]);
            if (!destroyed) fn();
        }, ms);
        timers.add(owner[key]);
    }

    /* ---- breakpoints and layouts ---- */

    function pickBreakpoint() {
        const width = element.clientWidth;
        if (!width) return breakpoint;
        return breakpoints.find(entry => width >= entry.minWidth) ?? breakpoints.at(-1);
    }

    const limitsOf = widget => ({ min: widget.def?.minSize, max: widget.def?.maxSize });

    /** The items of one breakpoint, in the form of gridLayout.js. */
    function itemsOf(bp) {
        return [...widgets.values()].filter(widget => widget.places[bp.name]).map(widget => ({ id: widget.id, locked: widget.locked, ...widget.places[bp.name] }));
    }

    function store(bp, items) {
        for (const item of items) {
            const widget = widgets.get(item.id);
            if (widget) widget.places[bp.name] = { x: item.x, y: item.y, w: item.w, h: item.h };
        }
    }

    /** Widgets without a place at this breakpoint get one, derived from the widest breakpoint that has them. */
    function ensurePlaces(bp) {
        const missing = [...widgets.values()].filter(widget => !widget.places[bp.name]);
        if (!missing.length) return;
        const source = breakpoints.find(entry => entry !== bp && missing.every(widget => widget.places[entry.name])) ?? breakpoints.find(entry => entry !== bp && missing.some(widget => widget.places[entry.name]));
        const items = itemsOf(bp);
        const reading = missing.map(widget => ({ id: widget.id, ...(widget.places[source?.name] ?? { x: 0, y: 1e6, w: 3, h: 2 }) })).sort((a, b) => a.y - b.y || a.x - b.x);
        for (const item of reading) {
            const widget = widgets.get(item.id);
            const size = clampItem(item, bp.columns, limitsOf(widget));
            const spot = findFreeSpot(items, size.w, size.h, bp.columns);
            const placed = { id: item.id, locked: widget.locked, ...spot, w: size.w, h: size.h };
            items.push(placed);
            widget.places[bp.name] = { x: placed.x, y: placed.y, w: placed.w, h: placed.h };
        }
    }

    function applyContainerClasses() {
        for (const old of [...element.classList].filter(name => /^wg-(cols|rh|gap)-/.test(name))) element.classList.remove(old);
        const names = [
            useClass(root, `wg-cols-${breakpoint.columns}`, `grid-template-columns: repeat(${breakpoint.columns}, minmax(0, 1fr))`),
            useClass(root, `wg-rh-${rowHeight}`, `grid-auto-rows: ${rowHeight}px`),
            useClass(root, `wg-gap-${gap}`, `gap: ${gap}px`)
        ].filter(Boolean);
        if (names.length) element.classList.add(...names);
        else {
            element.style.gridTemplateColumns = `repeat(${breakpoint.columns}, minmax(0, 1fr))`;
            element.style.gridAutoRows = `${rowHeight}px`;
            element.style.gap = `${gap}px`;
        }
    }

    /** Puts every node on its place; the nodes that moved slide there (FLIP). */
    function applyPlaces({ slide = animateMoves, except } = {}) {
        const nodes = [...widgets.values()].map(widget => widget.node);
        const sliding = slide && !prefersReducedMotion() && nodes.length <= 60;
        const before = sliding ? new Map(nodes.map(node => [node, node.getBoundingClientRect()])) : null;
        for (const widget of widgets.values()) if (widget.places[breakpoint.name]) setPlace(root, widget.node, widget.places[breakpoint.name]);
        if (!before) return;
        for (const node of nodes) {
            if (node === except) continue;
            const was = before.get(node);
            const now = node.getBoundingClientRect();
            const dx = was.left - now.left;
            const dy = was.top - now.top;
            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) animate(node, [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: 160 });
        }
    }

    function switchBreakpoint(next) {
        cancelGesture();
        breakpoint = next;
        ensurePlaces(next);
        applyContainerClasses();
        applyPlaces({ slide: false });
    }

    /** Keeps the DOM order equal to the order of reading, so Tab goes through the widgets as the eye does. */
    function orderDom() {
        const order = [...widgets.values()].filter(widget => widget.places[breakpoint.name]).sort((a, b) => a.places[breakpoint.name].y - b.places[breakpoint.name].y || a.places[breakpoint.name].x - b.places[breakpoint.name].x);
        const current = [...element.children].filter(node => node.classList.contains("widget"));
        if (order.every((widget, index) => current[index] === widget.node)) return;
        const focused = element.contains(document.activeElement) ? document.activeElement : null;
        for (const widget of order) element.append(widget.node);
        focused?.focus?.({ preventScroll: true });
    }

    /* ---- the widget ---- */

    function buildNode(widget) {
        const titleId = uid("widget-title");
        const handle = el("button", { class: "widget-handle", attrs: { type: "button", "aria-describedby": titleId } }, "⠿");
        const title = el("h3", { class: "widget-title", attrs: { id: titleId } });
        const settings = el("button", { class: "widget-action", attrs: { type: "button", "data-action": "settings" } }, "⚙");
        const copy = el("button", { class: "widget-action", attrs: { type: "button", "data-action": "duplicate" } }, "⧉");
        const remove = el("button", { class: "widget-action", attrs: { type: "button", "data-action": "remove" } }, "✕");
        const body = el("div", { class: "widget-body" });
        const node = el("section", { class: "widget", attrs: { "data-widget-id": widget.id, "data-widget-type": widget.type, "aria-labelledby": titleId } },
            el("header", { class: "widget-header" }, handle, title, el("div", { class: "widget-actions" }, settings, copy, remove)), body);
        for (const dir of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) node.append(el("span", { class: `widget-resize widget-resize-${dir}`, attrs: { "data-dir": dir } }));
        widget.node = node;
        widget.parts = { handle, title, settings, copy, remove, body };
        widget.context = {
            id: widget.id,
            type: widget.type,
            element: body,
            get config() { return widget.config; },
            get title() { return widget.title; },
            size: { width: 0, height: 0 },
            contentSize: { width: 0, height: 0 },
            setTitle: text => setTitle(widget, text)
        };
        labelNode(widget);
        node.classList.toggle("is-locked", widget.locked);
        resizing?.observe(body);
        if (intersection) intersection.observe(node);
        else {
            widget.visible = true;
            queueMicrotask(() => !destroyed && showWidget(widget));
        }
    }

    function labelNode(widget) {
        const { handle, title, settings, copy, remove } = widget.parts;
        title.textContent = widget.title;
        const params = { title: widget.title };
        handle.setAttribute("aria-label", translate("widget.move", params));
        settings.setAttribute("aria-label", translate("widget.settings", params));
        copy.setAttribute("aria-label", translate("widget.duplicate", params));
        remove.setAttribute("aria-label", translate("widget.remove", params));
        for (const part of [settings, copy, remove, handle]) part.title = part.getAttribute("aria-label");
        widget.node.querySelectorAll(".widget-resize").forEach(handleNode => handleNode.setAttribute("aria-hidden", "true"));
    }

    function setTitle(widget, text) {
        widget.title = String(text ?? "").slice(0, 200);
        labelNode(widget);
    }

    /** Renders the widget when it is visible for the first time, or brings it up to date when it changed while it was not. */
    function showWidget(widget) {
        if (destroyed || !widget.visible) return;
        if (!widget.rendered) renderWidget(widget);
        else if (widget.dirty) updateNow(widget);
    }

    /** Sets context.size (the box of the body) and context.contentSize (inside its padding). */
    function measure(widget) {
        const body = widget.parts.body;
        const rect = body.getBoundingClientRect();
        widget.context.size = { width: Math.round(rect.width), height: Math.round(rect.height) };
        const style = body.ownerDocument.defaultView?.getComputedStyle?.(body);
        const pad = name => Number.parseFloat(style?.[name]) || 0;
        widget.context.contentSize = {
            width: Math.max(0, widget.context.size.width - pad("paddingLeft") - pad("paddingRight")),
            height: Math.max(0, widget.context.size.height - pad("paddingTop") - pad("paddingBottom"))
        };
    }

    function renderWidget(widget) {
        widget.rendered = true;
        widget.dirty = false;
        widget.def = registry.get(widget.type);
        widget.parts.body.replaceChildren();
        widget.node.classList.remove("is-unknown", "is-failed");
        measure(widget);
        if (!widget.def) {
            widget.node.classList.add("is-unknown");
            widget.parts.body.append(el("p", { class: "widget-note", text: translate("widget.unknown", { type: widget.type }) }));
            return;
        }
        try {
            const result = widget.def.render(widget.context);
            widget.instance = typeof result === "function" ? { destroy: result } : (result ?? {});
        } catch (error) {
            console.error(`Athena UI: the widget "${widget.type}" failed to render`, error);
            widget.node.classList.add("is-failed");
            widget.parts.body.replaceChildren(el("p", { class: "widget-note", text: translate("widget.failed") }));
        }
    }

    function disposeWidget(widget) {
        try {
            widget.instance?.destroy?.(widget.context);
            if (widget.rendered && widget.def?.destroy && !widget.instance?.destroy) widget.def.destroy(widget.context);
        } catch (error) {
            console.error(`Athena UI: the widget "${widget.type}" failed to clean up`, error);
        }
        widget.instance = null;
        widget.rendered = false;
    }

    function updateNow(widget) {
        widget.dirty = false;
        measure(widget);
        const update = widget.instance?.update ?? widget.def?.update;
        if (!update) {
            disposeWidget(widget);
            renderWidget(widget);
            return;
        }
        try {
            update.call(widget.instance, widget.context);
        } catch (error) {
            console.error(`Athena UI: the widget "${widget.type}" failed to update`, error);
        }
    }

    function createWidget(data) {
        const widget = {
            id: data.id, type: data.type, title: data.title, config: data.config, locked: Boolean(data.locked), places: data.places ?? {},
            node: null, parts: null, context: null, def: registry.get(data.type), instance: null, rendered: false, visible: false, dirty: false
        };
        widgets.set(widget.id, widget);
        buildNode(widget);
        element.append(widget.node);
        return widget;
    }

    function removeNode(widget) {
        clearTimeout(widget.updateTimer);
        clearTimeout(widget.resizeTimer);
        disposeWidget(widget);
        intersection?.unobserve(widget.node);
        resizing?.unobserve(widget.parts.body);
        widget.node.remove();
        widgets.delete(widget.id);
    }

    /* ---- layout JSON ---- */

    /** The layout as plain, versioned JSON: where it is stored is up to the application. */
    function getLayout({ breakpoint: only } = {}) {
        const items = itemsOf(breakpoint);
        const order = new Map(items.sort((a, b) => a.y - b.y || a.x - b.x).map((item, index) => [item.id, index]));
        return {
            version: LAYOUT_VERSION,
            widgets: [...widgets.values()].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9)).map(widget => ({
                id: widget.id, type: widget.type, title: widget.title, config: plain(widget.config), locked: widget.locked,
                layouts: Object.fromEntries(Object.entries(widget.places).map(([name, place]) => [name, { ...place }])),
                // for an application that keeps ONE layout: the place of the widget in that breakpoint, flat (x, y, w, h)
                ...(only && widget.places[only] ? { x: widget.places[only].x, y: widget.places[only].y, w: widget.places[only].w, h: widget.places[only].h } : {})
            }))
        };
    }

    /** Checks one entry of a layout; returns the clean widget or a string with the reason. */
    function checkEntry(entry, seen) {
        if (!isPlainObject(entry)) return "not an object";
        if (typeof entry.type !== "string" || !SAFE_ID.test(entry.type)) return "bad type";
        let config;
        try {
            config = isPlainObject(entry.config) ? plain(entry.config) : {};
        } catch {
            return "bad config";
        }
        const places = {};
        for (const bp of breakpoints) {
            const place = entry.layouts?.[bp.name] ?? (breakpoints.length === 1 ? entry : null);
            if (!isPlainObject(place) || ![place.x, place.y, place.w, place.h].every(Number.isFinite)) continue;
            places[bp.name] = { x: wholeNumber(place.x, 0, 10000, 0), y: wholeNumber(place.y, 0, 100000, 0), w: wholeNumber(place.w, 1, 48, 1), h: wholeNumber(place.h, 1, 1000, 1) };
        }
        let id = typeof entry.id === "string" && SAFE_ID.test(entry.id) && !seen.has(entry.id) ? entry.id : null;
        while (!id || seen.has(id)) id = uid("widget");
        seen.add(id);
        const def = registry.get(entry.type);
        return { id, type: entry.type, title: typeof entry.title === "string" ? entry.title.slice(0, 200) : (def?.title ?? entry.type), config, locked: entry.locked === true, places };
    }

    /**
     * Replaces everything by a saved layout. An entry that is not valid is skipped; a type that is not registered is shown as a placeholder (its data is kept).
     * @returns {{loaded: number, skipped: {index: number, reason: string}[]}}
     */
    function setLayout(layout, { reset = true } = {}) {
        if (!isPlainObject(layout) || layout.version !== LAYOUT_VERSION || !Array.isArray(layout.widgets)) throw new TypeError(`Athena UI: a layout is { version: ${LAYOUT_VERSION}, widgets: [...] }`);
        cancelGesture();
        const seen = new Set();
        const skipped = [];
        const clean = [];
        layout.widgets.forEach((entry, index) => {
            if (clean.length >= maxWidgets) return skipped.push({ index, reason: "too many widgets" });
            const result = checkEntry(entry, seen);
            if (typeof result === "string") skipped.push({ index, reason: result });
            else clean.push(result);
        });
        const keep = new Map(clean.map(item => [item.id, item]));
        for (const widget of [...widgets.values()]) if (!keep.has(widget.id) || widget.type !== keep.get(widget.id).type) removeNode(widget);
        for (const item of clean) {
            const widget = widgets.get(item.id);
            if (!widget) {
                createWidget(item);
                continue;
            }
            const changed = JSON.stringify(widget.config) !== JSON.stringify(item.config) || widget.title !== item.title;
            Object.assign(widget, { config: item.config, locked: item.locked, places: item.places });
            widget.node.classList.toggle("is-locked", item.locked);
            if (widget.title !== item.title) setTitle(widget, item.title);
            if (changed) markChanged(widget);
        }
        // validate the places of every breakpoint: inside the columns, no overlaps
        for (const bp of breakpoints) {
            const items = itemsOf(bp);
            if (items.length) store(bp, normalizeKeeping(items, bp));
        }
        ensurePlaces(breakpoint);
        applyContainerClasses();
        applyPlaces({ slide: false });
        orderDom();
        if (reset) {
            snapshots.length = 0;
            snapshots.push(JSON.stringify(getLayout()));
            position = 0;
        }
        for (const skip of skipped) console.warn(`Athena UI: widget ${skip.index} of the layout was skipped (${skip.reason})`);
        return { loaded: clean.length, skipped };
    }

    function normalizeKeeping(items, bp) {
        return normalize(items, bp.columns, item => limitsOf(widgets.get(item.id)));
    }

    function markChanged(widget) {
        widget.dirty = true;
        if (widget.visible && widget.rendered) later(widget, "updateTimer", () => updateNow(widget), 100);
    }

    /* ---- snapshots ---- */

    const snapshots = [];
    let position = -1;

    function commit(reason) {
        const snapshot = JSON.stringify(getLayout());
        if (snapshot === snapshots[position]) return;
        snapshots.length = position + 1;
        snapshots.push(snapshot);
        if (snapshots.length > 100) snapshots.shift();
        position = snapshots.length - 1;
        if (!starting) notify(reason);
    }

    // onChange is called at once, or, with the option `changeDelay`, a moment after the last change (a drag is many steps): then it is told the reason of the last one.
    let changeTimer = 0;
    let pendingReason = null;
    function notify(reason) {
        if (!(options.changeDelay > 0)) {
            options.onChange?.(getLayout(), reason);
            return;
        }
        pendingReason = reason;
        clearTimeout(changeTimer);
        changeTimer = setTimeout(flush, options.changeDelay);
    }
    /** Calls onChange now when a change is waiting for its delay (leaving the page, a button "save"). */
    function flush() {
        clearTimeout(changeTimer);
        if (pendingReason === null) return;
        const reason = pendingReason;
        pendingReason = null;
        if (!destroyed) options.onChange?.(getLayout(), reason);
    }

    function travel(step, reason) {
        const next = position + step;
        if (next < 0 || next >= snapshots.length) return false;
        position = next;
        setLayout(JSON.parse(snapshots[position]), { reset: false });
        options.onChange?.(getLayout(), reason);
        return true;
    }

    /* ---- add, remove, change ---- */

    // Puts a new widget in the grid without telling anybody (no undo step, no onChange): addWidget and addWidgetWithSettings are the two ways to finish it.
    function place(type, { id, title, config, x, y, w, h, locked } = {}) {
        const def = registry.get(type);
        if (!def) throw new TypeError(`Athena UI: the widget type "${type}" is not registered`);
        if (widgets.size >= maxWidgets) throw new RangeError(`Athena UI: a grid holds at most ${maxWidgets} widgets`);
        const widgetId = typeof id === "string" && SAFE_ID.test(id) && !widgets.has(id) ? id : uid("widget");
        const size = clampItem({ x: 0, y: 0, w: w ?? def.defaultSize?.w ?? 3, h: h ?? def.defaultSize?.h ?? 2 }, breakpoint.columns, { min: def.minSize, max: def.maxSize });
        const items = itemsOf(breakpoint);
        const spot = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : findFreeSpot(items, size.w, size.h, breakpoint.columns);
        const widget = createWidget({ id: widgetId, type, title: String(title ?? def.title ?? type).slice(0, 200), config: plain({ ...def.defaultConfig, ...config }), locked, places: {} });
        widget.places[breakpoint.name] = { ...clampItem({ ...size, ...spot }, breakpoint.columns, { min: def.minSize, max: def.maxSize }) };
        const placed = placeItem([...items, { id: widgetId, ...widget.places[breakpoint.name] }], widgetId, {}, breakpoint.columns, { limits: limitsOf(widget), compactItems });
        if (placed) store(breakpoint, placed);
        else widget.places[breakpoint.name] = { ...findFreeSpot(items, size.w, size.h, breakpoint.columns), w: size.w, h: size.h };      // a locked widget is there
        for (const bp of breakpoints) if (bp !== breakpoint) delete widget.places[bp.name];
        for (const bp of breakpoints) if (bp !== breakpoint && itemsOf(bp).length) ensurePlaces(bp);
        applyPlaces();
        orderDom();
        return widgetId;
    }

    function addWidget(type, options = {}) {
        const widgetId = place(type, options);
        commit("add");
        announce(translate("widget.added", { title: widgets.get(widgetId).title }));
        return widgetId;
    }

    /**
     * Adds a widget and opens its settings at once. A person who gives up leaves the grid as it was: nothing is added, there is no undo step and onChange is not called. A person who saves
     * has added a widget: one undo step ("add") and one call of onChange.
     * @returns {Promise<string|null>} the id of the widget, or null when the settings were dismissed
     */
    async function addWidgetWithSettings(type, options = {}) {
        const widgetId = place(type, options);
        const saved = await configureWidget(widgetId, { reason: "add" });
        if (destroyed) return null;
        if (saved) {
            announce(translate("widget.added", { title: widgets.get(widgetId)?.title ?? "" }));
            return widgetId;
        }
        const widget = widgets.get(widgetId);
        if (widget) {
            removeNode(widget);
            for (const bp of breakpoints) {
                const items = itemsOf(bp);
                if (items.length && compactItems) store(bp, compact(items));
            }
            applyPlaces();
        }
        return null;
    }

    function removeWidget(id) {
        const widget = widgets.get(id);
        if (!widget) return false;
        const title = widget.title;
        removeNode(widget);
        for (const bp of breakpoints) {
            const items = itemsOf(bp);
            if (items.length && compactItems) store(bp, compact(items));
        }
        applyPlaces();
        commit("remove");
        announce(translate("widget.removed", { title }));
        return true;
    }

    function duplicateWidget(id) {
        const widget = widgets.get(id);
        if (!widget) return null;
        const place = widget.places[breakpoint.name];
        return addWidget(widget.type, { title: translate("widget.copy", { title: widget.title }), config: plain(widget.config), w: place.w, h: place.h });
    }

    function lockWidget(id, locked = true) {
        const widget = widgets.get(id);
        if (!widget) return false;
        widget.locked = Boolean(locked);
        widget.node.classList.toggle("is-locked", widget.locked);
        commit("lock");
        return true;
    }

    /** Changes the title and / or the config (merged) from code, for example with new data. It is not an undo step. */
    function updateWidget(id, { title, config } = {}) {
        const widget = widgets.get(id);
        if (!widget) return false;
        if (title !== undefined) setTitle(widget, title);
        if (config !== undefined) widget.config = plain({ ...widget.config, ...config });
        markChanged(widget);
        return true;
    }

    function configureWidget(id, { reason = "settings" } = {}) {
        const widget = widgets.get(id);
        if (!widget) return null;
        const form = typeof widget.def?.configForm === "function" ? widget.def.configForm(widget) : (widget.def?.configForm ?? []);
        const fields = [
            { name: "widgetTitle", label: translate("widget.titleLabel"), type: "text", value: widget.title, required: true },
            ...form.map(field => ({ ...field, value: widget.config[field.name] ?? field.value }))
        ];
        return showFormDialog({
            title: translate("widget.settingsTitle"), fields, size: "small",
            onSubmit(values) {
                const { widgetTitle, ...config } = values;
                setTitle(widget, widgetTitle || widget.title);
                widget.config = plain({ ...widget.config, ...config });
                markChanged(widget);
                commit(reason);
            }
        });
    }

    /* ---- moving and resizing: pointer ---- */

    function metrics() {
        const rect = element.getBoundingClientRect();
        const cell = (rect.width - gap * (breakpoint.columns - 1)) / breakpoint.columns;
        return { strideX: cell + gap, strideY: rowHeight + gap };
    }

    function cancelGesture() {
        if (!gesture) return;
        const current = gesture;
        gesture = null;
        current.stop?.();
        store(breakpoint, current.base);
        endDragVisuals(current);
        applyPlaces({ slide: false });
    }

    /* ---- the placeholder and the widget that follows the pointer ---- */

    function showPlaceholder(current, place) {
        const slide = animateMoves && !prefersReducedMotion();
        const fresh = !current.placeholder;
        if (fresh) current.placeholder = el("div", { class: "widget-placeholder", attrs: { "aria-hidden": "true" } });
        const node = current.placeholder;
        const was = !fresh && slide ? node.getBoundingClientRect() : null;
        setPlace(root, node, place);
        if (fresh) element.prepend(node);
        if (!was) return;
        const now = node.getBoundingClientRect();
        const dx = was.left - now.left;
        const dy = was.top - now.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) animate(node, [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: 160 });
    }

    // The offset is a held Web Animation, not a style attribute. It is direct manipulation (the widget is where the finger is), so it stays under reduced motion.
    function follow(current) {
        if (!current.pointerAt) return;
        const node = current.widget.node;
        const place = current.widget.places[breakpoint.name];
        const x = current.pointerAt.dx - (place.x - current.start.x) * current.strideX;
        const y = current.pointerAt.dy - (place.y - current.start.y) * current.strideY;
        const frames = [{ translate: `${x}px ${y}px` }, { translate: `${x}px ${y}px` }];
        if (current.follower) current.follower.effect.setKeyframes(frames);
        else if (typeof node.animate === "function") {
            current.follower = node.animate(frames, { duration: 1, fill: "forwards" });
        }
    }

    function endDragVisuals(current) {
        current.follower?.cancel();
        current.placeholder?.remove();
        current.widget?.node.classList.remove("is-dragging");
        element.classList.remove("is-receiving");
    }

    /** One try of a gesture: the base layout with the item in the new place; shows it when it is possible. */
    function tryPlace(current, place) {
        const widget = current.widget;
        const next = placeItem(current.base, widget.id, place, breakpoint.columns, { limits: limitsOf(widget), compactItems, collision: current.reason === "move" ? collision : "push", swapCover: 0.5 });
        if (!next) return false;
        const changed = JSON.stringify(next) !== JSON.stringify(current.shown);
        current.shown = next;
        if (changed) {
            store(breakpoint, next);
            applyPlaces({ except: current.pointer ? widget.node : undefined });
        }
        return changed;
    }

    function finishGesture(current, reason) {
        gesture = null;
        // where the widget was under the finger, so that it can slide from there into its place
        const from = current.follower && animateMoves && !prefersReducedMotion() ? current.widget.node.getBoundingClientRect() : null;
        endDragVisuals(current);
        if (from) {
            const now = current.widget.node.getBoundingClientRect();
            animate(current.widget.node, [{ translate: `${from.left - now.left}px ${from.top - now.top}px` }, { translate: "0 0" }], { duration: 160 });
        }
        orderDom();
        if (JSON.stringify(current.shown ?? current.base) !== JSON.stringify(current.base)) commit(reason);
    }

    function startPointer(event) {
        if (!editable || gesture || event.button !== 0) return;
        const resize = event.target.closest(".widget-resize");
        const grab = event.target.closest(".widget-handle");
        if (!resize && !grab) return;
        const node = event.target.closest(".widget");
        const widget = node && widgets.get(node.dataset.widgetId);
        if (!widget || widget.locked) return;
        event.preventDefault();
        const base = itemsOf(breakpoint);
        const start = widget.places[breakpoint.name];
        const { strideX, strideY } = metrics();
        const dir = resize?.dataset.dir ?? "";
        const target = resize ?? grab;
        const limits = limitsOf(widget);
        const current = { widget, base, shown: base, pointer: true, reason: dir ? "resize" : "move", start: { ...start }, strideX, strideY };
        gesture = current;
        node.classList.add("is-dragging");
        try {
            target.setPointerCapture(event.pointerId);
        } catch {
            // no active pointer (a synthetic event): the handle still gets the events that are sent to it
        }
        const move = moveEvent => {
            const dx = Math.round((moveEvent.clientX - event.clientX) / strideX);
            const dy = Math.round((moveEvent.clientY - event.clientY) / strideY);
            if (!dir) {
                current.pointerAt = { dx: moveEvent.clientX - event.clientX, dy: moveEvent.clientY - event.clientY };
                tryPlace(current, { x: start.x + dx, y: start.y + dy });
                showPlaceholder(current, widget.places[breakpoint.name]);
                return follow(current);
            }
            const place = {};
            const minW = Math.max(1, limits.min?.w ?? 1);
            const minH = Math.max(1, limits.min?.h ?? 1);
            const maxW = Math.min(limits.max?.w ?? breakpoint.columns, breakpoint.columns);
            const maxH = limits.max?.h ?? Infinity;
            if (dir.includes("e")) place.w = Math.min(Math.max(start.w + dx, minW), maxW);
            if (dir.includes("w")) {
                place.w = Math.min(Math.max(start.w - dx, minW), maxW);
                place.x = start.x + start.w - place.w;
            }
            if (dir.includes("s")) place.h = Math.min(Math.max(start.h + dy, minH), maxH);
            if (dir.includes("n")) {
                place.h = Math.min(Math.max(start.h - dy, minH), maxH);
                place.y = Math.max(start.y + start.h - place.h, 0);
                place.h = start.y + start.h - place.y;
            }
            return tryPlace(current, place);
        };
        const end = () => {
            target.removeEventListener("pointermove", move);
            target.removeEventListener("pointerup", up);
            target.removeEventListener("pointercancel", cancel);
            target.removeEventListener("lostpointercapture", up);
        };
        const up = () => {
            end();
            if (gesture === current) finishGesture(current, current.reason);
        };
        const cancel = () => {
            end();
            if (gesture === current) cancelGesture();
        };
        current.stop = end;
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", up);
        target.addEventListener("pointercancel", cancel);
        target.addEventListener("lostpointercapture", up);
    }

    /* ---- dropping a new widget from outside the grid ---- */

    /**
     * Starts the drag of a new widget from outside the grid (a gallery, a toolbox of the application).
     * Give move() the position of the pointer; the grid shows where the widget would land. drop() adds it there, cancel() leaves the grid as it was.
     * @returns {{move: (clientX: number, clientY: number) => boolean, drop: (options?: {withSettings?: boolean}) => (string|null|Promise<string|null>), cancel: () => void}|null}
     *          null when the type is not registered, the grid is full or another gesture is going on
     */
    function beginDrop(type) {
        const def = registry.get(type);
        if (!def || gesture || destroyed || widgets.size >= maxWidgets) return null;
        const limits = { min: def.minSize, max: def.maxSize };
        const size = clampItem({ x: 0, y: 0, w: def.defaultSize?.w ?? 3, h: def.defaultSize?.h ?? 2 }, breakpoint.columns, limits);
        const id = uid("widget-drop");
        const current = { external: true, widget: null, base: itemsOf(breakpoint), spot: null };
        gesture = current;
        element.classList.add("is-receiving");

        const leave = () => {
            current.spot = null;
            current.placeholder?.remove();
            current.placeholder = null;
            store(breakpoint, current.base);
            applyPlaces();
        };
        return {
            move(clientX, clientY) {
                if (gesture !== current) return false;
                const rect = element.getBoundingClientRect();
                const { strideX, strideY } = metrics();
                // two rows below the last widget still count: a person drops "under" the dashboard
                if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom + 2 * strideY) {
                    if (current.spot) leave();
                    return false;
                }
                const x = Math.floor((clientX - rect.left) / strideX) - Math.floor(size.w / 2);
                const y = Math.floor((clientY - rect.top) / strideY);
                const wanted = clampItem({ ...size, x, y }, breakpoint.columns, limits);
                const next = placeItem([...current.base, { ...size, id, x: 0, y: 1e5 }], id, { x: wanted.x, y: wanted.y }, breakpoint.columns, { limits, compactItems });
                if (!next) return Boolean(current.spot);      // a locked widget is there: keep the last place that worked
                const item = next.find(entry => entry.id === id);
                current.spot = { x: item.x, y: item.y, w: item.w, h: item.h };
                store(breakpoint, next);
                applyPlaces();
                showPlaceholder(current, current.spot);
                return true;
            },
            drop({ withSettings = false } = {}) {
                if (gesture !== current) return null;
                const spot = current.spot;
                cancelGesture();
                if (!spot) return null;
                return withSettings ? addWidgetWithSettings(type, spot) : addWidget(type, spot);
            },
            cancel() {
                if (gesture === current) cancelGesture();
            }
        };
    }

    /* ---- moving and resizing: keyboard ---- */

    const describe = widget => {
        const place = widget.places[breakpoint.name];
        return translate("widget.position", { x: place.x + 1, y: place.y + 1, w: place.w, h: place.h });
    };

    function dropKeyboard(current, keep) {
        if (gesture !== current) return;
        if (!keep) {
            cancelGesture();
            announce(translate("widget.cancelled"));
        } else {
            finishGesture(current, current.reason);
            announce(translate("widget.dropped", { title: current.widget.title }) + " " + describe(current.widget));
        }
        current.widget.parts.handle.removeAttribute("aria-pressed");
    }

    function keyHandle(event) {
        const handle = event.target.closest(".widget-handle");
        if (!handle || !editable) return;
        const node = handle.closest(".widget");
        const widget = widgets.get(node.dataset.widgetId);
        if (!widget || widget.locked) return;
        const picked = gesture?.widget === widget && gesture.keyboard;
        const pick = event.key === " " || event.key === "Enter";
        if (event.type === "keyup") {
            if (event.key === " ") event.preventDefault();      // Space must not click the button
            return;
        }
        if (!picked) {
            if (!pick || gesture) return;
            event.preventDefault();
            gesture = { widget, base: itemsOf(breakpoint), shown: itemsOf(breakpoint), keyboard: true, reason: "move" };
            node.classList.add("is-dragging");
            handle.setAttribute("aria-pressed", "true");
            announce(translate("widget.pickedUp", { title: widget.title }) + " " + describe(widget));
            return;
        }
        const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (arrows) {
            event.preventDefault();
            const place = widget.places[breakpoint.name];
            const next = event.shiftKey ? { w: place.w + arrows[0], h: place.h + arrows[1] } : { x: place.x + arrows[0], y: place.y + arrows[1] };
            gesture.reason = event.shiftKey ? "resize" : gesture.reason;
            if (event.shiftKey && (arrows[0] < 0 || arrows[1] < 0) && (place.w + arrows[0] < 1 || place.h + arrows[1] < 1)) return announce(translate("widget.blocked"));
            const before = JSON.stringify(widget.places[breakpoint.name]);
            const placed = placeItem(itemsOf(breakpoint), widget.id, next, breakpoint.columns, { limits: limitsOf(widget), compactItems, collision: event.shiftKey ? "push" : collision });
            if (placed) {
                store(breakpoint, placed);
                gesture.shown = placed;
                applyPlaces();
            }
            announce(placed && JSON.stringify(widget.places[breakpoint.name]) !== before ? describe(widget) : translate("widget.blocked"));
        } else if (pick) {
            event.preventDefault();
            dropKeyboard(gesture, true);
        } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            dropKeyboard(gesture, false);
        }
    }

    function blurHandle(event) {
        if (gesture?.keyboard && event.target.closest?.(".widget-handle")) dropKeyboard(gesture, true);
    }

    function clickAction(event) {
        const button = event.target.closest(".widget-action");
        if (!button || !editable) return;
        const id = button.closest(".widget")?.dataset.widgetId;
        const action = button.dataset.action;
        if (action === "settings") configureWidget(id);
        else if (action === "duplicate") duplicateWidget(id);
        else if (action === "remove") removeWidget(id);
    }

    element.addEventListener("pointerdown", startPointer);
    element.addEventListener("keydown", keyHandle);
    element.addEventListener("keyup", keyHandle);
    element.addEventListener("focusout", blurHandle);
    element.addEventListener("click", clickAction);

    /* ---- start ---- */

    function setEditable(flag = true) {
        editable = Boolean(flag);
        if (!editable) cancelGesture();
        element.classList.toggle("is-editable", editable);
    }

    breakpoint = pickBreakpoint();
    applyContainerClasses();
    if (options.layout) setLayout(options.layout);
    else {
        for (const entry of options.widgets ?? []) {
            const def = registry.get(entry.type);
            if (!def) {
                console.warn(`Athena UI: the widget type "${entry.type}" is not registered`);
                continue;
            }
            addWidget(entry.type, entry);
        }
        snapshots.length = 0;
        snapshots.push(JSON.stringify(getLayout()));
        position = 0;
    }
    setEditable(options.editable);
    resizing?.observe(element);
    starting = false;

    return asHandle({
        element,
        addWidget, addWidgetWithSettings, removeWidget, duplicateWidget, configureWidget, updateWidget, lockWidget, flush,
        getWidget: id => (widgets.has(id) ? { id, type: widgets.get(id).type, title: widgets.get(id).title, config: plain(widgets.get(id).config), locked: widgets.get(id).locked, element: widgets.get(id).node } : null),
        getWidgets: () => [...widgets.keys()],
        setEditable, isEditable: () => editable,
        getLayout, setLayout,
        undo: () => travel(-1, "undo"), redo: () => travel(1, "redo"),
        canUndo: () => position > 0, canRedo: () => position < snapshots.length - 1,
        getBreakpoint: () => breakpoint.name,
        beginDrop,
        destroy() {
            if (destroyed) return;
            flush();             // a change that waits for its delay is delivered, not lost
            destroyed = true;
            cancelGesture();
            for (const timer of timers) clearTimeout(timer);
            for (const widget of [...widgets.values()]) removeNode(widget);
            intersection?.disconnect();
            resizing?.disconnect();
            element.removeEventListener("pointerdown", startPointer);
            element.removeEventListener("keydown", keyHandle);
            element.removeEventListener("keyup", keyHandle);
            element.removeEventListener("focusout", blurHandle);
            element.removeEventListener("click", clickAction);
            element.classList.remove("athena-widget-grid", "is-editable");
            for (const name of [...element.classList].filter(name => /^wg-/.test(name))) element.classList.remove(name);
            live.remove();
        }
    });
}
