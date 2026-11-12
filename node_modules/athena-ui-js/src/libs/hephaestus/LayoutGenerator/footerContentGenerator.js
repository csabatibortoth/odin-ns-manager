//footerContentGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

/* global $ */

import { HTMLElementGenerator } from "../HTMLElementGenerator/src/HTMLElementGenerator.js";
import config, { withBorder } from "../../config/config.js";
import { getMenuItems } from "../../config/hooks.js";
import { generateBasicMenu, defaultMenuItems } from "../MenuGenerator/basicMenuGenerator.js";

export function generateFooterContent() {
    generateFooterMenu();
    generateFooterCopyrightText();
}

export function generateFooterMenu() {
    generateBasicMenu({
        parent: "footer",
        menu_id: "footer_menu",
        class: withBorder(config.footer_menu_class),
        items: getMenuItems()?.footerMenu ?? defaultMenuItems("footer_menu")
    });
}

export function clearFooterMenu() {
    $("#footer_menu").empty();
}

export function generateFooterCopyrightText() {
    HTMLElementGenerator({
        parent: "footer",
        id: "copyright_text",
        elementType: "h6",
        text: `${config.copyright} v${config.version}`
    });
}
