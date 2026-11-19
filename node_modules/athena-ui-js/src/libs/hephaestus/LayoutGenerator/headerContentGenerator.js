//headerContentGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { HTMLElementGenerator } from "../../core/elementGenerator.js";
import config, { withBorder } from "../../config/config.js";
import { getMenuItems } from "../../config/hooks.js";
import { generateBasicMenu, defaultMenuItems } from "../MenuGenerator/basicMenuGenerator.js";
import { generateMenu } from "../MenuGenerator/menuGenerator.js";

export function generateHeaderContent() {
    generateContaninerForElements({ parent: "header", id: "header_logo_container", text: "" });
    generateHeaderLogo();
    generateContaninerForElements({ parent: "header", id: "header_title_container", text: "" });
    generateHeaderTitle();
    generateContaninerForElements({ parent: "header", id: "header_menu_container", text: "" });
    generateHeaderMenu();
}

/**
 * Generates the menu of the header. Without options it is built from the global `menuItems` / nav callback, as before.
 * With `options.items` it is a generateMenu (no globals): `generateHeaderMenu({ items, onNavigate, active, layout, followHash })`.
 */
export function generateHeaderMenu(options) {
    if (options?.items) {
        document.getElementById("header_menu_container")?.replaceChildren();
        return generateMenu({ ...options, parent: "header_menu_container", id: options.id ?? "header_menu" });
    }
    generateBasicMenu({
        parent: "header_menu_container",
        menu_id: "header_menu",
        class: withBorder(config.header_menu_class),
        items: getMenuItems()?.headerMenu ?? defaultMenuItems("header_menu")
    });
}

export function clearHeaderMenu() {
    document.getElementById("header_menu_container")?.replaceChildren();
}

export function generateHeaderTitle() {
    HTMLElementGenerator({
        parent: "header_title_container",
        id: "header_title_text",
        elementType: "h1",
        text: config.header_title_text
    });
}

export function generateHeaderLogo() {
    HTMLElementGenerator({
        parent: "header_logo_container",
        id: "header_title_logo",
        elementType: "img",
        src: config.header_img_url,
        alt: `${config.header_title_text}_logo`
    });
}

export function generateContaninerForElements(params) {
    HTMLElementGenerator({
        parent: params.parent,
        id: params.id,
        elementType: "div",
        text: params.text
    });
}
