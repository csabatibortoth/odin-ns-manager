//menuGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { asHandle, cx, el, mount, setContent, uid } from "../../core/dom.js";
import { translate } from "../../core/i18n.js";
import { isSafeUrl } from "../../core/sanitize.js";
import { initialsOf } from "../componentGenerator/componentGenerator.js";

/**
 * @typedef {object} MenuItem
 * @property {string} id
 * @property {string} label
 * @property {string|Node} [icon]
 * @property {string} [href]
 * @property {boolean} [disabled]
 * @property {"end"} [align]
 * @property {number|string|{text: (number|string), tone?: "info"|"ok"|"warn"|"bad"}} [badge]
 * @property {string} [badgeLabel]
 * @property {{name: string, src?: string}} [avatar]
 * @property {MenuItem[]} [children]
 */

const ENABLED = "[role=menuitem]:not([aria-disabled=true]):not(:disabled)";

/** The text of a badge: numbers above 99 become "99+", 0 / null / false / "" mean no badge. */
export function badgeText(value) {
    if (value == null || value === false || value === 0 || value === "") return "";
    return typeof value === "number" && value > 99 ? "99+" : String(value);
}

/**
 * Generates a navigation menu. Items are real links (`href`) or buttons, so the keyboard and screen readers work without help:
 * Tab reaches every item, Enter and Space use it, the arrow keys move inside a group, Esc closes it.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {MenuItem[]} options.items
 *        `icon` is shown before the label (text, or a Node such as an SVG; it is hidden from screen readers).
 *        `badge` is a small count or word after the label (0, null and "" show nothing, numbers above 99 show "99+").
 *        `badgeLabel` is what a screen reader hears for it ("3 unread"); without it the badge text is read after the label.
 *        `avatar` shows the picture (or the initials) of a person: for the user menu, usually with `align: "end"` and children.
 *        An item with `children` opens a group; a child can have children too (a group inside a group, any depth).
 * @param {(item: MenuItem, event: Event) => void} [options.onNavigate] called when a PERSON uses an item (click, Enter, Space).
 *        It is never called by select() or while the menu is built.
 * @param {string} [options.active] id of the item that is the current page at the start
 * @param {boolean} [options.followHash=false] the item whose `href` equals location.hash is the active one, and follows hashchange
 * @param {"bar"|"bottom-tabs"|"responsive"} [options.layout="bar"] "bottom-tabs": a bar of tabs at the bottom of the screen,
 *        groups open as sheets above it. "responsive": a bar on wide screens, bottom tabs on a tablet or phone (max 700px).
 * @param {number} [options.breakpoint=700] layout "responsive": the screen width in px up to which the menu is a bar of tabs at the bottom
 * @param {string} [options.label] accessible name of the navigation
 *
 * Colours: on a coloured header set --athena-menu-bg, --athena-menu-fg, --athena-menu-hover and --athena-menu-active (the line under the active item)
 * on the menu or on a parent (they default to a transparent bar, the colour of the text, --athena-hover and --athena-accent).
 * @param {string} [options.id]
 * @param {string} [options.class]
 * @returns {{element: HTMLElement, select: (id: string|null) => void, getActive: () => string|null, setBadge: (id: string, badge) => void,
 *            close: Function, update: (changes?: {items?: object[]}) => object, destroy: Function}}
 */
export function generateMenu(options = {}) {
    const layout = options.layout ?? "bar";
    let items = options.items ?? [];
    let active = null;
    const nodes = new Map();       // id -> { item, control, li, parent (id) }
    let openGroups = [];           // from the outermost to the innermost: { toggle, sheet, depth }

    const list = el("ul", { class: "athena-menu-list" });
    const element = el("nav", {
        id: options.id,
        class: cx("athena-menu", `athena-menu-${layout}`, options.class),
        attrs: { "aria-label": options.label ?? translate("menu") }
    }, list);
    const doc = element.ownerDocument;
    const view = doc.defaultView;
    // layout "responsive": tabs at the bottom up to the breakpoint (the class is-tabs carries the style)
    let tabsQuery = null;
    const tabsChanged = () => element.classList.toggle("is-tabs", tabsQuery.matches);
    if (layout === "responsive" && view?.matchMedia) {
        tabsQuery = view.matchMedia(`(max-width: ${Number(options.breakpoint) > 0 ? Number(options.breakpoint) : 700}px)`);
        tabsQuery.addEventListener("change", tabsChanged);
        tabsChanged();
    }

    const badgeNode = badge => {
        const spec = badge != null && typeof badge === "object" ? badge : { text: badge };
        const text = badgeText(spec.text);
        return text ? el("span", { class: cx("menu-badge", spec.tone && `menu-badge-${spec.tone}`), text }) : null;
    };

    const content = item => {
        const parts = [];
        if (item.avatar) {
            const avatar = el("span", { class: "menu-avatar", attrs: { "aria-hidden": "true" } });
            if (item.avatar.src && isSafeUrl(item.avatar.src)) avatar.append(el("img", { attrs: { src: item.avatar.src, alt: "" } }));
            else avatar.textContent = initialsOf(item.avatar.name);
            parts.push(avatar);
        }
        if (item.icon) parts.push(setContent(el("span", { class: "menu-icon", attrs: { "aria-hidden": "true" } }), item.icon));
        parts.push(el("span", { class: "menu-label", text: item.label }));
        const badge = badgeNode(item.badge);
        if (badge) parts.push(badge);
        return parts;
    };

    // A link when there is an address, a button otherwise.
    const control = (item, inGroup) => {
        const attrs = { "data-id": item.id, role: inGroup ? "menuitem" : null };
        const node = item.href && !item.children?.length
            ? el("a", { class: cx("menu-control", inGroup && "menu-sub-control"), attrs: { ...attrs, href: item.href } }, ...content(item))
            : el("button", { class: cx("menu-control", inGroup && "menu-sub-control"), attrs: { ...attrs, type: "button", disabled: item.disabled } }, ...content(item));
        if (item.disabled && node.tagName === "A") {
            node.setAttribute("aria-disabled", "true");
            node.removeAttribute("href");
        }
        if (item.badgeLabel) node.setAttribute("aria-label", `${item.label}, ${item.badgeLabel}`);
        if (inGroup) node.tabIndex = -1;
        return node;
    };

    /* ------------------GROUPS (any depth)------------------- */

    function closeFrom(depth, restoreFocus = false) {
        const closing = openGroups.filter(group => group.depth >= depth);
        if (!closing.length) return;
        for (const { toggle, sheet } of closing.reverse()) {
            sheet.hidden = true;
            toggle.setAttribute("aria-expanded", "false");
        }
        const outermost = closing.at(-1);
        openGroups = openGroups.filter(group => group.depth < depth);
        if (restoreFocus) outermost.toggle.focus();
        if (!openGroups.length) doc.removeEventListener("pointerdown", onOutside);
    }
    const closeAll = (restoreFocus = false) => closeFrom(0, restoreFocus);
    const onOutside = event => { if (!element.contains(event.target)) closeAll(); };

    function openSheet(toggle, sheet, depth, focusFirst) {
        closeFrom(depth);   // siblings and everything deeper than this group close first
        sheet.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        if (!openGroups.length) doc.addEventListener("pointerdown", onOutside);
        openGroups.push({ toggle, sheet, depth });
        if (focusFirst) sheet.querySelector(`:scope > li > ${ENABLED}`)?.focus();
    }

    // Builds a group: the toggle (a button) and its sheet, which holds the children (which may be groups again).
    function buildGroup(item, depth, toggle) {
        const sheetId = uid("menu-sheet");
        const sheet = el("ul", { id: sheetId, class: cx("menu-sheet", depth > 0 && "menu-sheet-nested"), attrs: { role: "menu", hidden: true, "aria-label": item.label } });
        toggle.setAttribute("aria-haspopup", "menu");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-controls", sheetId);
        toggle.append(el("span", { class: "menu-caret", text: depth > 0 ? "▸" : "▾", attrs: { "aria-hidden": "true" } }));
        toggle.addEventListener("click", () => (sheet.hidden ? openSheet(toggle, sheet, depth, depth > 0) : closeFrom(depth)));
        toggle.addEventListener("keydown", event => {
            const opens = depth === 0 ? ["ArrowDown", "ArrowUp"] : ["ArrowRight"];
            if (opens.includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                openSheet(toggle, sheet, depth, true);
            }
        });
        for (const child of item.children) sheet.append(buildItem(child, depth + 1, item.id, "menuitem"));
        sheet.addEventListener("keydown", event => {
            // Only the innermost sheet reacts: the event comes from an item that is a direct child of this sheet
            if (event.target.closest(".menu-sheet") !== sheet) return;
            const entries = [...sheet.querySelectorAll(`:scope > li > ${ENABLED}`)];
            const index = entries.indexOf(doc.activeElement);
            if (event.key === "ArrowDown") entries[(index + 1) % entries.length]?.focus();
            else if (event.key === "ArrowUp") entries[(index - 1 + entries.length) % entries.length]?.focus();
            else if (event.key === "Home") entries[0]?.focus();
            else if (event.key === "End") entries.at(-1)?.focus();
            else if (event.key === "Escape" || (event.key === "ArrowLeft" && depth > 0)) closeFrom(depth, true);
            else if (event.key === "Tab") closeAll();
            else return;
            if (event.key !== "Tab") {
                event.preventDefault();
                event.stopPropagation();
            }
        });
        return sheet;
    }

    function buildItem(item, depth, parentId, role) {
        const li = el("li", { class: cx("menu-item", depth === 0 && item.align === "end" && "menu-item-end", item.children?.length && "has-submenu"), attrs: { role: role === "menuitem" ? "none" : null } });
        const node = control(item, depth > 0);
        nodes.set(item.id, { item, control: node, li, parent: parentId });
        if (item.children?.length) {
            li.append(node, buildGroup(item, depth, node));
        } else {
            node.addEventListener("click", event => {
                if (item.disabled) return;
                if (depth > 0) closeAll(true);
                options.onNavigate?.(item, event);
            });
            li.append(node);
        }
        return li;
    }

    function build() {
        closeAll();
        list.replaceChildren();
        nodes.clear();
        for (const item of items) list.append(buildItem(item, 0, null, null));
        // Arrow keys move along the top level, like a toolbar (Tab still reaches every item).
        list.onkeydown = event => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            if (event.target.closest(".menu-sheet")) return;
            const tops = [...list.querySelectorAll(":scope > li > .menu-control:not(:disabled)")];
            const index = tops.indexOf(event.target);
            if (index < 0) return;
            event.preventDefault();
            tops[(index + (event.key === "ArrowRight" ? 1 : -1) + tops.length) % tops.length].focus();
        };
        select(active);
    }

    /** Marks the current page: class is-active and aria-current="page" on the item (and has-active on every group around it). Does not call onNavigate. */
    function select(id) {
        active = id ?? null;
        for (const { control: node, li } of nodes.values()) {
            node.classList.remove("is-active");
            node.removeAttribute("aria-current");
            li.classList.remove("has-active");
        }
        const found = nodes.get(active);
        if (!found) return;
        found.control.classList.add("is-active");
        found.control.setAttribute("aria-current", "page");
        for (let parent = found.parent; parent; parent = nodes.get(parent)?.parent) nodes.get(parent)?.li.classList.add("has-active");
    }

    /** Changes the badge of an item (a number, text, { text, tone }, or 0 / null to remove it) without building the menu again. */
    function setBadge(id, badge) {
        const found = nodes.get(id);
        if (!found) return;
        found.item.badge = badge;
        found.control.querySelector(".menu-badge")?.remove();
        const node = badgeNode(badge);
        if (node) found.control.querySelector(".menu-caret") ? found.control.querySelector(".menu-caret").before(node) : found.control.append(node);
    }

    const fromHash = () => {
        const hash = view.location.hash;
        const match = [...nodes.values()].find(({ item }) => item.href && item.href === hash);
        if (match) select(match.item.id);
    };
    if (options.followHash) view.addEventListener("hashchange", fromHash);

    active = options.active ?? null;
    build();
    if (options.followHash) fromHash();
    mount(options.parent, element);

    return asHandle({
        element,
        select,
        setBadge,
        getActive: () => active,
        close: closeAll,
        update(changes = {}) {
            if (changes.items) {
                items = changes.items;
                build();
                if (options.followHash) fromHash();
            }
            return this;
        },
        destroy() {
            closeAll();
            view.removeEventListener("hashchange", fromHash);
            tabsQuery?.removeEventListener("change", tabsChanged);
            element.remove();
        }
    });
}
