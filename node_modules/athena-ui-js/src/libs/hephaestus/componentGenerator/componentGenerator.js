//componentGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { asHandle, cx, el, mount, resolveElement, setContent, uid } from "../../core/dom.js";
import { generateBreadcrumbs } from "../navigationGenerator/navigationGenerator.js";
import { generateSpinner } from "../feedbackGenerator/feedbackGenerator.js";
import { translate } from "../../core/i18n.js";
import { closePopover, followAnchor, openPopover, placePopover, settlePopover, supportsPopover } from "../../core/popover.js";

/**
 * Generates a link. External links open in a new tab and get `rel="noopener noreferrer"`.
 * With `onclick` and no `href` it behaves as an in-page action.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} options.text
 * @param {string} [options.href]
 * @param {boolean} [options.external]
 * @param {(event: Event) => void} [options.onclick]
 * @returns {HTMLAnchorElement}
 */
export function generateLink(options = {}) {
    const link = el("a", {
        id: options.id,
        class: cx("athena-link", options.class),
        text: options.text,
        attrs: {
            href: options.href ?? "#",
            target: options.external ? "_blank" : null,
            rel: options.external ? "noopener noreferrer" : null
        }
    });
    link.addEventListener("click", event => {
        if (options.onclick) {
            if (!options.href) event.preventDefault();
            options.onclick(event);
        } else if (!options.href) {
            event.preventDefault();
        }
    });
    return mount(options.parent, link);
}

/**
 * Generates a section with an optional heading. Returns the section, fill it through `content`
 * or append to it.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.title]
 * @param {number} [options.level=2] heading level 1..6
 * @param {string|Node|Array|Function} [options.content]
 * @returns {HTMLElement}
 */
export function generateSection(options = {}) {
    const section = el("section", { id: options.id, class: cx("athena-section", options.class) });
    if (options.title) {
        const id = uid("section");
        section.setAttribute("aria-labelledby", id);
        section.append(el(`h${Math.min(Math.max(options.level ?? 2, 1), 6)}`, { id, text: options.title }));
    }
    setContent(section, options.content);
    return mount(options.parent, section);
}

/**
 * Generates a card.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.title]
 * @param {string} [options.image] image URL shown on top
 * @param {string} [options.imageAlt]
 * @param {string|Node|Array|Function} [options.content]
 * @param {string|Node|Array|Function} [options.footer]
 * @returns {{element: HTMLElement, body: HTMLElement}} append to `body` to add more content
 */
export function generateCard(options = {}) {
    const body = setContent(el("div", { class: "card-body" }), options.content);
    const card = el("div", { id: options.id, class: cx("card", options.class) });
    if (options.image) card.append(el("img", { class: "card-image", attrs: { src: options.image, alt: options.imageAlt ?? "" } }));
    if (options.title) body.prepend(el("h3", { class: "card-title", text: options.title }));
    card.append(body);
    if (options.footer) card.append(setContent(el("div", { class: "card-footer" }), options.footer));
    mount(options.parent, card);
    return asHandle({ element: card, body });
}

/**
 * Generates a small label.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} options.text
 * @param {"neutral"|"info"|"success"|"warning"|"error"} [options.variant="neutral"]
 * @param {boolean} [options.pill]
 * @returns {HTMLElement}
 */
export function generateBadge(options = {}) {
    return mount(options.parent, el("span", {
        id: options.id,
        class: cx("badge", `badge-${options.variant ?? "neutral"}`, options.pill && "badge-pill", options.class),
        text: options.text
    }));
}

// Up to two initials of a name: "Ada Lovelace" -> "AL"
export function initialsOf(name = "") {
    return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => [...word][0].toUpperCase()).join("");
}

/**
 * Generates an avatar: the image, or the initials of the name when there is no (working) image.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.name]
 * @param {string} [options.src]
 * @param {"small"|"large"} [options.size]
 * @returns {HTMLElement}
 */
export function generateAvatar(options = {}) {
    const avatar = el("span", {
        id: options.id,
        class: cx("avatar", options.size && `avatar-${options.size}`, options.class),
        attrs: { role: "img", "aria-label": options.name ?? "avatar" }
    });
    const showInitials = () => avatar.replaceChildren(el("span", { text: initialsOf(options.name), attrs: { "aria-hidden": "true" } }));
    if (options.src) {
        const image = el("img", { attrs: { src: options.src, alt: "" } });
        image.addEventListener("error", showInitials);
        avatar.append(image);
    } else {
        showInitials();
    }
    return mount(options.parent, avatar);
}

/**
 * Generates a KPI tile: a label, a big value and an optional change.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} options.label
 * @param {string|number} options.value
 * @param {number} [options.delta] change in percent, shown with an arrow
 * @param {boolean} [options.invertDelta] a falling value is good news (costs, errors)
 * @param {"ok"|"warn"|"bad"} [options.tone] colours the tile (the class is-ok / is-warn / is-bad) and adds the word to the screen reader text
 * @param {string} [options.note] small text under the value ("of 120 hosts", "updated 2 min ago")
 * @returns {{element: HTMLElement, setValue: Function, setNote: Function, setTone: Function}}
 */
export function generateStat(options = {}) {
    const valueText = document.createTextNode(String(options.value ?? ""));
    const toneWord = el("span", { class: "athena-visually-hidden" });
    const value = el("div", { class: "stat-value" }, valueText, toneWord);
    const element = el("div", { id: options.id, class: cx("stat", options.class) }, el("div", { class: "stat-label", text: options.label }), value);
    if (options.delta != null) {
        const good = options.invertDelta ? options.delta < 0 : options.delta > 0;
        const kind = options.delta === 0 ? "neutral" : good ? "good" : "bad";
        const arrow = options.delta > 0 ? "▲" : options.delta < 0 ? "▼" : "■";
        element.append(el("div", { class: cx("stat-delta", `stat-${kind}`), text: `${arrow} ${Math.abs(options.delta)}%` }));
    }
    const note = el("div", { class: "stat-note" });
    value.after(note);
    const setValue = text => { valueText.data = String(text); };
    const setNote = text => { note.textContent = text ?? ""; note.hidden = !text; };
    const setTone = tone => {
        for (const name of ["ok", "warn", "bad"]) element.classList.toggle(`is-${name}`, name === tone);
        toneWord.textContent = tone ? ` (${translate(`tone.${tone}`)})` : "";
    };
    setNote(options.note);
    setTone(options.tone);
    mount(options.parent, element);
    return asHandle({
        element, setValue, setNote, setTone,
        update: ({ value: text, note: noteText, tone } = {}) => {
            if (text != null) setValue(text);
            if (noteText !== undefined) setNote(noteText);
            if (tone !== undefined) setTone(tone);
        }
    });
}

/**
 * Generates a responsive grid. The columns collapse to one on small screens.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {number} [options.columns=3]
 * @param {string} [options.gap] any CSS length
 * @returns {HTMLElement} append the cells to it
 */
export function generateGrid(options = {}) {
    const grid = el("div", { id: options.id, class: cx("athena-grid", options.class) });
    grid.style.setProperty("--grid-columns", String(options.columns ?? 3));
    if (options.gap) grid.style.setProperty("--grid-gap", options.gap);
    return mount(options.parent, grid);
}

/**
 * Adds a tooltip to an element. It shows on hover and on keyboard focus, and Esc hides it.
 * It is a native popover (`popover="manual"`), so it is drawn above everything and never cut off by a parent with `overflow: hidden`. A touch
 * does not show it (a tap would hide the thing it describes). Browsers without the popover API show it with CSS, as before.
 *
 * @param {Element|string} target element or id
 * @param {string} text
 */
export function generateTooltip(target, text) {
    const node = resolveElement(target);
    if (!node) return null;
    const id = uid("tooltip");
    const native = supportsPopover();
    const tip = el("span", { class: "tooltip-text athena-popover", id, text, attrs: { role: "tooltip", popover: native ? "manual" : null } });
    // Inputs and images cannot hold the tooltip text, so they get a wrapper.
    let host = node;
    if (node.matches("input,img,select,textarea")) {
        host = el("span", { class: "tooltip-wrap" });
        node.replaceWith(host);
        host.append(node);
    } else if (!node.matches("a[href],button") && !node.hasAttribute("tabindex")) {
        node.tabIndex = 0;
    }
    host.classList.add("has-tooltip");
    node.setAttribute("aria-describedby", id);
    host.append(tip);
    if (native) {
        let stop = null;
        const show = () => {
            if (tip.matches(":popover-open")) return;
            placePopover(node, tip, { side: "top", align: "center", gap: 6, room: 40 });
            openPopover(tip);
            settlePopover(tip);
            stop = followAnchor(node, tip, { side: "top", align: "center", gap: 6, room: 40 });
        };
        const hide = () => {
            stop?.();
            stop = null;
            closePopover(tip);
        };
        host.addEventListener("pointerenter", event => { if (event.pointerType !== "touch") show(); });
        host.addEventListener("pointerleave", hide);
        host.addEventListener("focusin", show);
        host.addEventListener("focusout", hide);
        host.addEventListener("keydown", event => { if (event.key === "Escape") hide(); });
    }
    return tip;
}

/* ------------------PAGE PARTS------------------- */

/**
 * The top of a page: breadcrumbs, the title (a heading), a description and the actions of the page.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {{label: string, href?: string, onclick?: Function}[]} [options.breadcrumbs] see generateBreadcrumbs
 * @param {(Node|string)[]|Node} [options.actions] buttons, shown at the end of the header
 * @param {1|2|3} [options.level=1] heading level
 * @returns {{element: HTMLElement, setTitle: Function, setDescription: Function, actions: HTMLElement}}
 */
export function generatePageHeader(options = {}) {
    const title = el(`h${options.level ?? 1}`, { class: "page-title", text: options.title });
    const description = el("p", { class: "page-description", text: options.description ?? "" });
    description.hidden = !options.description;
    const actions = setContent(el("div", { class: "page-actions" }), options.actions);
    const heading = el("div", { class: "page-heading" }, title, description);
    const element = el("header", { id: options.id, class: cx("page-header", options.class) });
    if (options.breadcrumbs?.length) generateBreadcrumbs({ parent: element, items: options.breadcrumbs });
    element.append(el("div", { class: "page-header-row" }, heading, actions));
    mount(options.parent, element);
    return asHandle({
        element, actions,
        setTitle: text => { title.textContent = text; },
        setDescription: text => { description.textContent = text ?? ""; description.hidden = !text; }
    });
}

/**
 * A list of facts: a term and its description, in pairs (a <dl>).
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {{term: string, description: (string|number|Node|Array), title?: string}[]} options.items text is inserted as text
 * @param {boolean} [options.inline=false] terms and descriptions side by side
 * @returns {{element: HTMLElement, setItems: Function}}
 */
export function generateFacts(options = {}) {
    const element = el("dl", { id: options.id, class: cx("facts", options.inline && "facts-inline", options.class) });
    const setItems = items => {
        element.replaceChildren();
        for (const item of items ?? []) {
            const group = el("div", { class: "fact" }, el("dt", { text: item.term }), setContent(el("dd", { attrs: { title: item.title } }), item.description));
            element.append(group);
        }
    };
    setItems(options.items);
    mount(options.parent, element);
    return asHandle({ element, setItems, update: ({ items } = {}) => { if (items) setItems(items); } });
}

/**
 * What a list shows when there is nothing in it: a title, a short explanation and what to do about it.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} options.title
 * @param {string} [options.message]
 * @param {string|Node} [options.icon] decorative
 * @param {{text: string, onclick: Function, variant?: string}} [options.action] a button
 */
export function generateEmptyState(options = {}) {
    const element = el("div", { id: options.id, class: cx("empty-state", options.class) });
    if (options.icon) element.append(setContent(el("div", { class: "empty-icon", attrs: { "aria-hidden": "true" } }), options.icon));
    element.append(el("p", { class: "empty-title", text: options.title }));
    if (options.message) element.append(el("p", { class: "empty-message", text: options.message }));
    if (options.action) {
        const button = el("button", { class: `athena-button button-${options.action.variant ?? "primary"}`, text: options.action.text, attrs: { type: "button" } });
        button.addEventListener("click", event => options.action.onclick?.(event));
        element.append(button);
    }
    mount(options.parent, element);
    return asHandle({ element });
}

/**
 * A skeleton: grey lines with a shimmer where text or a card will be, so the page does not jump when it arrives. It is a live region that says
 * "Loading..." to a screen reader; the shimmer stops under reduced motion.
 *
 * @param {object} [options]
 * @param {string|Element} [options.parent]
 * @param {number} [options.lines=3] the last of several lines is shorter
 * @param {string} [options.class] e.g. "skeleton-card" in your own CSS gives the box a height
 */
export function generateSkeleton(options = {}) {
    const lines = Array.from({ length: Math.max(1, options.lines ?? 3) }, () => el("span", { class: "athena-skeleton athena-skeleton-line", attrs: { "aria-hidden": "true" } }));
    const element = el("div", { id: options.id, class: cx("athena-skeleton-box", options.class), attrs: { role: "status", "aria-live": "polite" } },
        ...lines, el("span", { class: "athena-visually-hidden", text: translate("loading") }));
    mount(options.parent, element);
    return asHandle({ element });
}

/**
 * A placeholder while something loads: a spinner and a text (a live region, so a screen reader says it).
 *
 * @param {object} [options]
 * @param {string|Element} [options.parent]
 * @param {string} [options.text] default: the translated "Loading..."
 */
export function generateLoading(options = {}) {
    const text = options.text ?? translate("loading");
    const element = el("div", { id: options.id, class: cx("loading-state", options.class), attrs: { role: "status", "aria-live": "polite" } });
    generateSpinner({ parent: element, label: text });
    element.append(el("span", { class: "loading-text", text }));
    mount(options.parent, element);
    return asHandle({ element });
}
