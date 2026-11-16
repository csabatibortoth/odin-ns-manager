//componentGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { cx, el, mount, setContent, uid } from "../../core/dom.js";

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
    return { element: card, body };
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
 * @returns {{element: HTMLElement, setValue: Function}}
 */
export function generateStat(options = {}) {
    const value = el("div", { class: "stat-value", text: String(options.value ?? "") });
    const element = el("div", { id: options.id, class: cx("stat", options.class) }, el("div", { class: "stat-label", text: options.label }), value);
    if (options.delta != null) {
        const good = options.invertDelta ? options.delta < 0 : options.delta > 0;
        const kind = options.delta === 0 ? "neutral" : good ? "good" : "bad";
        const arrow = options.delta > 0 ? "▲" : options.delta < 0 ? "▼" : "■";
        element.append(el("div", { class: cx("stat-delta", `stat-${kind}`), text: `${arrow} ${Math.abs(options.delta)}%` }));
    }
    mount(options.parent, element);
    return { element, setValue: text => { value.textContent = String(text); } };
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
 * Adds a tooltip to an element. It shows on hover and on keyboard focus.
 *
 * @param {Element|string} target element or id
 * @param {string} text
 */
export function generateTooltip(target, text) {
    const node = typeof target === "string" ? document.getElementById(target) : target;
    if (!node) return null;
    const id = uid("tooltip");
    const tip = el("span", { class: "tooltip-text", id, text, attrs: { role: "tooltip" } });
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
    return tip;
}
