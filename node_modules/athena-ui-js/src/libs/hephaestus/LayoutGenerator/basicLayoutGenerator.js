//basicLayoutGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { HTMLElementGenerator } from "../../core/elementGenerator.js";
import config, { withBorder } from "../../config/config.js";
import { generateHeaderContent } from "./headerContentGenerator.js";
import { generateWrapperContent } from "./wrapperContentGenerator.js";
import { generateFooterContent } from "./footerContentGenerator.js";

function generateSection(id, className, parent = "container") {
    HTMLElementGenerator({
        elementType: "div",
        parent,
        id,
        class: withBorder(className)
    });
}

// The element (by id) the container is generated into. Empty: the body, like init(). createApp({ root }) sets it.
let layoutRoot = "";

/** Chooses where generateContainer() puts the page layout: the id of an element, or "" for the body. */
export function setLayoutRoot(id = "") {
    layoutRoot = id;
}

export function generateBasicLayout() {
    generateContainer();
    if (config.generateHeader) generateHeader();
    generateWrapper();
    if (config.generateFooter) generateFooter();
}

export function generateContainer() {
    generateSection("container", config.container_class, layoutRoot);
}

/* HEADER ELEMENT GENERATION */

export function generateHeader() {
    generateSection("header", config.header_class);
    if (config.generateHeadercontent) generateHeaderContent();
}

export function clearHeader() {
    document.getElementById("header")?.replaceChildren();
}

/* WRAPPER ELEMENT GENERATION */

export function generateWrapper() {
    generateSection("wrapper", config.wrapper_class);
    if (config.generateWrappercontent) generateWrapperContent();
}

export function clearWrapper() {
    document.getElementById("wrapper")?.replaceChildren();
}

/* FOOTER ELEMENT GENERATION */

export function generateFooter() {
    generateSection("footer", config.footer_class);
    if (config.generateFooterContent) generateFooterContent();
}

export function clearFooter() {
    document.getElementById("footer")?.replaceChildren();
}
