//basicMenuGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

/* global HTMLControlGenerator */

import { HTMLElementGenerator } from "../HTMLElementGenerator/src/HTMLElementGenerator.js";
import { BORDERED_CLASS } from "../../config/config.js";
import { getNav } from "../../config/hooks.js";

// Placeholder items used when the application does not provide menuItems.
export function defaultMenuItems(menuId, count = 3) {
    return Array.from({ length: count }, (_, index) => ({
        id: `${menuId}-item-${index + 1}`,
        class: `${menuId.replace("_", "-")}-item-class`,
        text: "",
        inner_text: `item-${index + 1}`
    }));
}

export function generateBasicMenu(options) {
    generateMenuWireFrame(options);
    addMenuItemToWireFrame(options);
}

export function generateMenuWireFrame(options) {
    const menuClass = [options.menu_class, options.bordered && BORDERED_CLASS, options.class]
        .filter(Boolean)
        .join(" ");
    HTMLControlGenerator({
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
        HTMLElementGenerator({
            parent: item.id,
            id: `${options.menu_id}-item-${index}`,
            elementType: "span",
            text: item.inner_text,
            onclick: () => getNav()?.(item.inner_text)
        });
    });
}
