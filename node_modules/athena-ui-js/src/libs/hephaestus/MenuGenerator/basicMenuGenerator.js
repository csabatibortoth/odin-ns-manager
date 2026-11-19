//basicMenuGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui


import { HTMLElementGenerator } from "../../core/elementGenerator.js";
import { BORDERED_CLASS } from "../../config/config.js";
import { getNav } from "../../config/hooks.js";
import { el, uid } from "../../core/dom.js";
import { generateControl } from "../../core/controls.js";

// Placeholder items used when the application does not provide menuItems.
export function defaultMenuItems(menuId, count = 3) {
    return Array.from({ length: count }, (_, index) => ({
        id: `${menuId}-item-${index + 1}`,
        class: `${menuId.replace("_", "-")}-item-class`,
        text: "",
        inner_text: `item-${index + 1}`
    }));
}

/**
 * Generates a menu. An item with `children: [{ inner_text, disabled? }]` opens a submenu on click, Enter, Space
 * or the Down arrow. Esc, a click outside, or choosing an entry closes it. Choosing an entry calls the
 * nav callback with its `inner_text`, like a top level item.
 */
export function generateBasicMenu(options) {
    generateMenuWireFrame(options);
    addMenuItemToWireFrame(options);
}

export function generateMenuWireFrame(options) {
    const menuClass = [options.menu_class, options.bordered && BORDERED_CLASS, options.class]
        .filter(Boolean)
        .join(" ");
    generateControl({
        inputType: "ul",
        parent: options.parent,
        id: options.menu_id,
        class: menuClass,
        items: options.items
    });
}

export function addMenuItemToWireFrame(options) {
    options.items.forEach((item, index) => {
        // Without a parent id HTMLElementGenerator would append the label to the body.
        if (!item.id) return;
        if (item.children?.length) {
            addSubmenu(item, `${options.menu_id}-item-${index}`);
            return;
        }
        HTMLElementGenerator({
            parent: item.id,
            id: `${options.menu_id}-item-${index}`,
            elementType: "span",
            text: item.inner_text,
            onclick: () => getNav()?.(item.inner_text)
        });
    });
}

function addSubmenu(item, labelId) {
    const host = document.getElementById(item.id);
    if (!host) return;
    const listId = uid("submenu");
    const label = el("span", {
        id: labelId,
        class: "menu-parent",
        text: item.inner_text,
        attrs: { role: "button", tabindex: "0", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": listId }
    });
    const list = el("ul", { id: listId, class: "submenu", attrs: { role: "menu", hidden: true } });
    host.classList.add("has-submenu");

    const entries = item.children.map(child => {
        const entry = el("li", {
            class: "submenu-item",
            text: child.inner_text,
            attrs: { role: "menuitem", tabindex: "-1", "aria-disabled": child.disabled ? "true" : null }
        });
        if (!child.disabled) {
            entry.addEventListener("click", () => {
                close(true);
                getNav()?.(child.inner_text);
            });
        }
        list.append(entry);
        return entry;
    });
    const enabled = () => entries.filter(entry => entry.getAttribute("aria-disabled") !== "true");

    const onOutside = event => { if (!host.contains(event.target)) close(); };
    function open(focusFirst = false) {
        list.hidden = false;
        label.setAttribute("aria-expanded", "true");
        document.addEventListener("pointerdown", onOutside);
        if (focusFirst) enabled()[0]?.focus();
    }
    function close(restoreFocus = false) {
        list.hidden = true;
        label.setAttribute("aria-expanded", "false");
        document.removeEventListener("pointerdown", onOutside);
        if (restoreFocus === true) label.focus();
    }

    label.addEventListener("click", () => (list.hidden ? open() : close()));
    label.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
            event.preventDefault();
            if (list.hidden) open(true);
            else enabled()[0]?.focus();
        } else if (event.key === "Escape") {
            close();
        }
    });
    list.addEventListener("keydown", event => {
        const items = enabled();
        const index = items.indexOf(document.activeElement);
        if (event.key === "ArrowDown") items[(index + 1) % items.length]?.focus();
        else if (event.key === "ArrowUp") items[(index - 1 + items.length) % items.length]?.focus();
        else if (event.key === "Home") items[0]?.focus();
        else if (event.key === "End") items[items.length - 1]?.focus();
        else if (event.key === "Escape") close(true);
        else if (event.key === "Enter" || event.key === " ") document.activeElement.click();
        else if (event.key === "Tab") close();
        else return;
        if (event.key !== "Tab") event.preventDefault();
    });

    host.append(label, list);
}
