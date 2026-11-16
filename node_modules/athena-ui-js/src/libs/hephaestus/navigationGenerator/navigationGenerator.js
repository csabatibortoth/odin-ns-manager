//navigationGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { cx, el, mount, setContent, uid } from "../../core/dom.js";
import { translate } from "../../core/i18n.js";
import { pageRange } from "../../core/pagination.js";

/* ------------------TABS------------------- */

/**
 * Generates tabs. Arrow keys, Home and End move between the tabs.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.id]
 * @param {{id: string, label: string, content: *, disabled?: boolean}[]} options.tabs content is text, a Node,
 *        an array, or a function called once when the tab is first shown (lazy content)
 * @param {string} [options.active] id of the initially active tab (default: the first)
 * @param {(id: string) => void} [options.onChange]
 * @returns {{element: HTMLElement, select: (id: string) => void, getActive: () => string}}
 */
export function generateTabs(options = {}) {
    const tabs = options.tabs ?? [];
    const list = el("div", { class: "tab-list", attrs: { role: "tablist" } });
    const element = el("div", { id: options.id, class: cx("tabs", options.class) }, list);
    const base = uid("tabs");
    const buttons = new Map();
    const panels = new Map();
    const rendered = new Set();
    let active;

    for (const tab of tabs) {
        const button = el("button", {
            class: "tab",
            text: tab.label,
            id: `${base}-${tab.id}-tab`,
            attrs: { type: "button", role: "tab", "aria-controls": `${base}-${tab.id}-panel`, disabled: tab.disabled }
        });
        const panel = el("div", {
            class: "tab-panel",
            id: `${base}-${tab.id}-panel`,
            attrs: { role: "tabpanel", "aria-labelledby": button.id, hidden: true, tabindex: 0 }
        });
        button.addEventListener("click", () => select(tab.id));
        list.append(button);
        element.append(panel);
        buttons.set(tab.id, button);
        panels.set(tab.id, panel);
    }

    function select(id) {
        if (!buttons.has(id) || id === active) return;
        active = id;
        for (const [tabId, button] of buttons) {
            const isActive = tabId === id;
            button.setAttribute("aria-selected", String(isActive));
            button.tabIndex = isActive ? 0 : -1;
            button.classList.toggle("tab-active", isActive);
            panels.get(tabId).hidden = !isActive;
        }
        if (!rendered.has(id)) {
            rendered.add(id);
            setContent(panels.get(id), tabs.find(tab => tab.id === id).content);
        }
        options.onChange?.(id);
    }

    list.addEventListener("keydown", event => {
        const enabled = tabs.filter(tab => !tab.disabled).map(tab => tab.id);
        const index = enabled.indexOf(active);
        const target = {
            ArrowRight: enabled[(index + 1) % enabled.length],
            ArrowLeft: enabled[(index - 1 + enabled.length) % enabled.length],
            Home: enabled[0],
            End: enabled[enabled.length - 1]
        }[event.key];
        if (target) {
            event.preventDefault();
            select(target);
            buttons.get(target).focus();
        }
    });

    mount(options.parent, element);
    select(options.active ?? tabs.find(tab => !tab.disabled)?.id);
    return { element, select, getActive: () => active };
}

/* ------------------BREADCRUMBS------------------- */

/**
 * Generates breadcrumbs. The last item is the current page.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {{label: string, href?: string, onclick?: Function}[]} options.items
 */
export function generateBreadcrumbs(options = {}) {
    const items = options.items ?? [];
    const list = el("ol", { class: "breadcrumb-list" });
    items.forEach((item, index) => {
        const current = index === items.length - 1;
        let content;
        if (current) {
            content = el("span", { text: item.label, attrs: { "aria-current": "page" } });
        } else {
            content = el("a", { text: item.label, attrs: { href: item.href ?? "#" } });
            content.addEventListener("click", event => {
                if (item.onclick) {
                    event.preventDefault();
                    item.onclick(item);
                } else if (!item.href) {
                    event.preventDefault();
                }
            });
        }
        list.append(el("li", { class: "breadcrumb-item" }, content));
    });
    return mount(options.parent, el("nav", { id: options.id, class: cx("breadcrumbs", options.class), attrs: { "aria-label": options.label ?? "Breadcrumb" } }, list));
}

/* ------------------PAGINATION------------------- */

/**
 * Generates a page selector.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {number} options.total number of items
 * @param {number} [options.pageSize=10]
 * @param {number} [options.page=1]
 * @param {number} [options.siblings=1] page buttons shown next to the current page
 * @param {(page: number) => void} [options.onChange]
 * @returns {{element: HTMLElement, setPage: Function, setTotal: Function, getPage: Function}}
 */
export function generatePagination(options = {}) {
    const { pageSize = 10, siblings = 1, onChange } = options;
    let total = options.total ?? 0;
    let page = options.page ?? 1;
    const element = el("nav", { id: options.id, class: cx("pagination", options.class), attrs: { "aria-label": options.label ?? "Pagination" } });

    const pages = () => Math.max(1, Math.ceil(total / pageSize));
    function go(target) {
        const next = Math.min(Math.max(target, 1), pages());
        if (next === page) return;
        page = next;
        render();
        onChange?.(page);
    }
    function pageButton(text, target, { disabled, current, label } = {}) {
        return el("button", {
            class: cx("page-button", current && "page-current"),
            text,
            attrs: { type: "button", disabled, "aria-current": current ? "page" : null, "aria-label": label },
            on: { click: () => go(target) }
        });
    }
    function render() {
        page = Math.min(page, pages());
        const parts = [pageButton("‹", page - 1, { disabled: page === 1, label: translate("previous") })];
        for (const item of pageRange(page, pages(), siblings)) {
            parts.push(item === "…" ? el("span", { class: "page-gap", text: "…" }) : pageButton(String(item), item, { current: item === page }));
        }
        parts.push(pageButton("›", page + 1, { disabled: page === pages(), label: translate("next") }));
        element.replaceChildren(...parts);
    }

    render();
    mount(options.parent, element);
    return {
        element,
        getPage: () => page,
        setPage: go,
        setTotal(value) {
            total = value;
            render();
        }
    };
}

/* ------------------ACCORDION------------------- */

/**
 * Generates collapsible panels.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {{id?: string, title: string, content: *, open?: boolean}[]} options.items
 * @param {boolean} [options.multiple=false] allow several panels to be open at once
 * @returns {{element: HTMLElement, toggle: (index: number, open?: boolean) => void}}
 */
export function generateAccordion(options = {}) {
    const element = el("div", { id: options.id, class: cx("accordion", options.class) });
    const sections = [];

    function toggle(index, open) {
        const section = sections[index];
        const willOpen = open ?? section.button.getAttribute("aria-expanded") !== "true";
        if (willOpen && !options.multiple) sections.forEach((other, i) => i !== index && setOpen(other, false));
        setOpen(section, willOpen);
    }
    function setOpen(section, open) {
        section.button.setAttribute("aria-expanded", String(open));
        section.panel.hidden = !open;
        section.item.classList.toggle("accordion-open", open);
    }

    (options.items ?? []).forEach((item, index) => {
        const base = uid("accordion");
        const button = el("button", {
            class: "accordion-header",
            id: `${base}-header`,
            attrs: { type: "button", "aria-controls": `${base}-panel` },
            on: { click: () => toggle(index) }
        }, el("span", { text: item.title }), el("span", { class: "accordion-icon", attrs: { "aria-hidden": "true" } }));
        const panel = el("div", { class: "accordion-panel", id: `${base}-panel`, attrs: { role: "region", "aria-labelledby": button.id } });
        setContent(panel, item.content);
        const wrapper = el("div", { class: "accordion-item" }, el("h3", { class: "accordion-title" }, button), panel);
        const section = { item: wrapper, button, panel };
        sections.push(section);
        element.append(wrapper);
        setOpen(section, false);
    });
    (options.items ?? []).forEach((item, index) => { if (item.open) toggle(index, true); });

    mount(options.parent, element);
    return { element, toggle };
}

/* ------------------DROPDOWN------------------- */

/**
 * Generates a button that opens a menu. Arrow keys move through the items, Esc closes it.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} options.label button text
 * @param {{label?: string, onclick?: Function, href?: string, disabled?: boolean, divider?: boolean}[]} options.items
 * @param {"left"|"right"} [options.align="left"]
 * @returns {{element: HTMLElement, open: Function, close: Function}}
 */
export function generateDropdown(options = {}) {
    const menuId = uid("dropdown");
    const menu = el("div", { class: cx("dropdown-menu", options.align === "right" && "dropdown-right"), id: menuId, attrs: { role: "menu", hidden: true } });
    const button = el("button", {
        class: "athena-button button-secondary dropdown-toggle",
        text: options.label,
        attrs: { type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": menuId }
    });
    const element = el("div", { id: options.id, class: cx("dropdown", options.class) }, button, menu);

    const enabledItems = () => [...menu.querySelectorAll("[role=menuitem]:not([disabled])")];
    const onOutside = event => { if (!element.contains(event.target)) close(); };
    function open() {
        menu.hidden = false;
        button.setAttribute("aria-expanded", "true");
        document.addEventListener("pointerdown", onOutside);
    }
    function close(restoreFocus = false) {
        menu.hidden = true;
        button.setAttribute("aria-expanded", "false");
        document.removeEventListener("pointerdown", onOutside);
        if (restoreFocus === true) button.focus();
    }

    for (const item of options.items ?? []) {
        if (item.divider) {
            menu.append(el("div", { class: "dropdown-divider", attrs: { role: "separator" } }));
            continue;
        }
        const node = item.href
            ? el("a", { text: item.label, attrs: { href: item.href } })
            : el("button", { text: item.label, attrs: { type: "button", disabled: item.disabled } });
        node.classList.add("dropdown-item");
        node.setAttribute("role", "menuitem");
        node.tabIndex = -1;
        node.addEventListener("click", event => {
            close(true);
            item.onclick?.(item, event);
        });
        menu.append(node);
    }

    button.addEventListener("click", () => menu.hidden ? open() : close());
    button.addEventListener("keydown", event => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            if (menu.hidden) open();
            enabledItems()[0]?.focus();
        }
    });
    menu.addEventListener("keydown", event => {
        const items = enabledItems();
        const index = items.indexOf(document.activeElement);
        if (event.key === "ArrowDown") items[(index + 1) % items.length]?.focus();
        else if (event.key === "ArrowUp") items[(index - 1 + items.length) % items.length]?.focus();
        else if (event.key === "Home") items[0]?.focus();
        else if (event.key === "End") items[items.length - 1]?.focus();
        else if (event.key === "Escape") close(true);
        else if (event.key === "Tab") close();
        else return;
        if (event.key !== "Tab") event.preventDefault();
    });

    mount(options.parent, element);
    return { element, open, close };
}

/* ------------------SIDEBAR------------------- */

/**
 * Generates a vertical navigation with nested items. On small screens it collapses behind a toggle button.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {{id: string, label: string, icon?: string, href?: string, children?: object[]}[]} options.items
 * @param {(item: object) => void} [options.onSelect]
 * @param {string} [options.active] id of the initially selected item
 * @returns {{element: HTMLElement, select: (id: string) => void, toggle: Function}}
 */
export function generateSidebar(options = {}) {
    const { onSelect } = options;
    const links = new Map();
    const listId = uid("sidebar");

    function buildList(items, nested) {
        const list = el("ul", { class: nested ? "sidebar-sublist" : "sidebar-list" });
        for (const item of items) {
            const li = el("li", { class: "sidebar-item" });
            const content = [item.icon ? el("span", { class: "sidebar-icon", text: item.icon, attrs: { "aria-hidden": "true" } }) : "", el("span", { text: item.label })];
            if (item.children?.length) {
                const sub = buildList(item.children, true);
                sub.hidden = true;
                const header = el("button", { class: "sidebar-link sidebar-parent", attrs: { type: "button", "aria-expanded": "false" } }, ...content, el("span", { class: "accordion-icon", attrs: { "aria-hidden": "true" } }));
                header.addEventListener("click", () => {
                    sub.hidden = !sub.hidden;
                    header.setAttribute("aria-expanded", String(!sub.hidden));
                });
                li.append(header, sub);
            } else {
                const link = el(item.href ? "a" : "button", { class: "sidebar-link", attrs: item.href ? { href: item.href } : { type: "button" } }, ...content);
                link.addEventListener("click", () => select(item.id, true));
                links.set(item.id, { link, item });
                li.append(link);
            }
            list.append(li);
        }
        return list;
    }

    const toggleButton = el("button", {
        class: "athena-button button-secondary sidebar-toggle",
        text: "☰",
        attrs: { type: "button", "aria-label": "Menu", "aria-expanded": "false", "aria-controls": listId }
    });
    const list = buildList(options.items ?? [], false);
    list.id = listId;
    const element = el("nav", { id: options.id, class: cx("sidebar", options.class), attrs: { "aria-label": options.label ?? "Sidebar" } }, toggleButton, list);

    function toggle(open) {
        const next = open ?? !element.classList.contains("sidebar-open");
        element.classList.toggle("sidebar-open", next);
        toggleButton.setAttribute("aria-expanded", String(next));
    }
    toggleButton.addEventListener("click", () => toggle());

    function select(id, fromUser = false) {
        const entry = links.get(id);
        if (!entry) return;
        for (const { link } of links.values()) link.removeAttribute("aria-current");
        entry.link.setAttribute("aria-current", "page");
        // Open the parents of the selected item.
        for (let node = entry.link.closest(".sidebar-sublist"); node; node = node.parentElement?.closest(".sidebar-sublist")) {
            node.hidden = false;
            node.previousElementSibling?.setAttribute("aria-expanded", "true");
        }
        if (fromUser) {
            toggle(false);
            onSelect?.(entry.item);
        }
    }

    mount(options.parent, element);
    if (options.active) select(options.active);
    return { element, select, toggle };
}
