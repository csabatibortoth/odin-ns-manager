//JSON tree: a collapsible view of any JSON value, with native details / summary.
//A value from the data is always a text node, never markup. Types are told apart by shape as
//well as colour (strings stand in quotes, null is italic). Limits keep a hostile or huge
//value from making the page heavy; "copy value" copies all of a truncated string.
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { asHandle, cx, el, mount } from "./dom.js";
import { translate } from "./i18n.js";
import { copyToClipboard } from "../hephaestus/feedbackGenerator/feedbackGenerator.js";

export const MAX_DEPTH = 12;
export const MAX_CHILDREN = 200;
export const MAX_TEXT = 1000;
export const MAX_NODES = 5000;
const MAX_TERM = 100;
const MAX_MARKS = 200;

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive places of the search text in the text, at most MAX_MARKS. */
export function findTerm(text, term) {
    const needle = String(term ?? "").trim().slice(0, MAX_TERM);
    const haystack = String(text ?? "");
    if (!needle) return [];
    const re = new RegExp(escapeRegex(needle), "giu");
    const hits = [];
    for (let match = re.exec(haystack); match !== null && hits.length < MAX_MARKS; match = re.exec(haystack)) {
        hits.push([match.index, match.index + match[0].length]);
        if (!match[0].length) re.lastIndex++;
    }
    return hits;
}

/** The text as text nodes, with <mark> around the hits; no HTML parsing, textContent is unchanged. */
export function markedText(text, term) {
    const source = String(text ?? "");
    const hits = findTerm(source, term);
    if (!hits.length) return source;
    const cuts = new Set([0, source.length]);
    for (const [from, to] of hits) { cuts.add(from); cuts.add(to); }
    const points = [...cuts].sort((a, b) => a - b);
    const fragment = document.createDocumentFragment();
    let hitIndex = 0;
    for (let i = 0; i + 1 < points.length; i++) {
        const from = points[i];
        const to = points[i + 1];
        if (from === to) continue;
        const piece = source.slice(from, to);
        while (hitIndex < hits.length && hits[hitIndex][1] <= from) hitIndex++;
        fragment.append(hits[hitIndex]?.[0] === from
            ? el("mark", { class: "athena-jt-hit", text: piece })
            : document.createTextNode(piece));
    }
    return fragment;
}

// One place for every default, used at creation AND by update(): update must not lose the limits.
const DEFAULTS = Object.freeze({ open: 2, term: "", maxDepth: MAX_DEPTH, maxChildren: MAX_CHILDREN, maxText: MAX_TEXT, maxNodes: MAX_NODES });

const whole = (value, fallback, max, min = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(Math.max(Math.round(number), min), max) : fallback;
};
function optionsOf(options = {}) {
    const maxDepth = whole(options.maxDepth, MAX_DEPTH, MAX_DEPTH, 1);
    return {
        ...DEFAULTS,
        ...options,
        maxDepth,
        open: whole(options.open, DEFAULTS.open, maxDepth, 0),
        maxChildren: whole(options.maxChildren, MAX_CHILDREN, MAX_CHILDREN, 1),
        maxText: whole(options.maxText, MAX_TEXT, MAX_TEXT, 1),
        maxNodes: whole(options.maxNodes, MAX_NODES, MAX_NODES, 1)
    };
}

/** The text as an object or an array when it is JSON of that kind; otherwise null. */
export function parseJson(text) {
    const t = String(text ?? "").trim();
    if (!((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]")))) return null;
    try {
        const value = JSON.parse(t);
        return value !== null && typeof value === "object" ? value : null;
    } catch {
        return null;
    }
}

/** A path as a programmer writes it: req.id, items[2].name, headers["x-request-id"]. */
export function pathOf(parts) {
    return parts.reduce((path, key) => {
        if (typeof key === "number") return `${path}[${key}]`;
        if (/^[A-Za-z_$][\w$]*$/.test(key)) return path ? `${path}.${key}` : key;
        return `${path}[${JSON.stringify(key)}]`;
    }, "");
}

/** What "copy value" puts on the clipboard: a string as it is, anything else as JSON. */
export const valueText = value => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

const typeOf = value => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);

function actions(value, path) {
    const button = (label, aria, click) => el("button", {
        class: "athena-jt-btn",
        attrs: { type: "button", title: aria, "aria-label": aria },
        on: { click }
    }, label);
    return el("span", { class: "athena-jt-actions" },
        button("copy", translate("json.copyValue"), () => copyToClipboard(valueText(value))),
        path ? button("path", translate("json.copyPath", { path }), () => copyToClipboard(path)) : null);
}

function shortText(text, max) {
    return text.length > max ? `${text.slice(0, max)}… ${translate("json.moreChars", { count: text.length - max })}` : text;
}

const note = text => el("div", { class: "athena-jt-more", text });

function build(key, value, parts, depth, ctx) {
    if (ctx.count >= ctx.maxNodes) return null;
    ctx.count++;
    const type = typeOf(value);
    const path = pathOf(parts);
    const label = key === null ? null : el("span", { class: "athena-jt-key", text: String(key) });
    const colon = label ? ": " : null;

    if (type === "object" || type === "array") {
        const entries = type === "array" ? value.map((entry, index) => [index, entry]) : Object.entries(value);
        const shown = entries.slice(0, ctx.maxChildren);
        const children = [];
        if (depth >= ctx.maxDepth) {
            children.push(note(translate("json.tooDeep")));
        } else {
            for (const [childKey, childValue] of shown) {
                if (ctx.count >= ctx.maxNodes) {
                    if (!ctx.limited) {
                        children.push(note(translate("json.nodeLimit", { count: ctx.maxNodes })));
                        ctx.limited = true;
                    }
                    break;
                }
                const child = build(childKey, childValue, [...parts, childKey], depth + 1, ctx);
                if (child) children.push(child);
            }
            if (!ctx.limited && entries.length > shown.length) children.push(note(translate("json.more", { count: entries.length - shown.length })));
        }
        return el("details", { class: cx("athena-jt-node", `athena-jt-${type}`), prop: { open: depth < ctx.open } },
            el("summary", {},
                label, colon,
                el("span", { class: "athena-jt-brace", text: type === "array" ? `[${entries.length}]` : `{${entries.length}}` }),
                actions(value, path)),
            el("div", { class: "athena-jt-children" }, children));
    }

    const shown = type === "string" ? `"${shortText(value, ctx.maxText)}"` : String(value);
    const valueNode = el("span", { class: cx("athena-jt-val", `athena-jt-${type}`) });
    // The search text marks string values only; numbers, booleans and null keep their shape.
    if (type === "string") valueNode.append(markedText(shown, ctx.term));
    else valueNode.textContent = shown;
    return el("div", { class: "athena-jt-row" },
        label, colon, valueNode, actions(value, path));
}

/**
 * A JSON value as a tree. Options: parent, class, open (levels open at first, default 2),
 * term (case-insensitive text marked inside string values), maxDepth, maxChildren, maxText,
 * maxNodes. Returns the usual handle with expandAll() and collapseAll().
 */
export function generateJsonTree(value, options = {}) {
    let current = value;
    let base = { ...options };
    let ctx = optionsOf(base);
    const tree = el("div", { class: "athena-jt-tree" });
    const render = () => {
        ctx.count = 0;
        ctx.limited = false;
        tree.replaceChildren(build(null, current, [], 0, ctx) ?? note(translate("json.nodeLimit", { count: ctx.maxNodes })));
    };
    const all = on => tree.querySelectorAll("details").forEach(node => { node.open = on; });
    const bar = el("div", { class: "athena-jt-bar" },
        el("button", { class: "athena-jt-btn", attrs: { type: "button" }, on: { click: () => all(true) } }, translate("json.expandAll")),
        el("button", { class: "athena-jt-btn", attrs: { type: "button" }, on: { click: () => all(false) } }, translate("json.collapseAll")));
    const root = el("div", { class: cx("athena-json-tree", options.class) }, bar, tree);
    if (options.parent) mount(options.parent, root);
    render();
    return asHandle({
        element: root,
        update(next, nextOptions) {
            if (arguments.length) current = next;
            if (nextOptions) base = { ...base, ...nextOptions };
            ctx = optionsOf(base);
            render();
            return this;
        },
        expandAll: () => all(true),
        collapseAll: () => all(false)
    });
}
