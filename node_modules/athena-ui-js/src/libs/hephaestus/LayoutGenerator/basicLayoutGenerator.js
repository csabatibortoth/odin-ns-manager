//basicLayoutGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

/* global $ */

import { HTMLElementGenerator } from "../HTMLElementGenerator/src/HTMLElementGenerator.js";
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

export function generateBasicLayout() {
    generateContainer();
    if (config.generateHeader) generateHeader();
    generateWrapper();
    if (config.generateFooter) generateFooter();
}

export function generateContainer() {
    generateSection("container", config.container_class, "");
}

/* HEADER ELEMENT GENERATION */

export function generateHeader() {
    generateSection("header", config.header_class);
    if (config.generateHeadercontent) generateHeaderContent();
}

export function clearHeader() {
    $("#header").empty();
}

/* WRAPPER ELEMENT GENERATION */

export function generateWrapper() {
    generateSection("wrapper", config.wrapper_class);
    if (config.generateWrappercontent) generateWrapperContent();
}

export function clearWrapper() {
    $("#wrapper").empty();
}

/* FOOTER ELEMENT GENERATION */

export function generateFooter() {
    generateSection("footer", config.footer_class);
    if (config.generateFooterContent) generateFooterContent();
}

export function clearFooter() {
    $("#footer").empty();
}
