//Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui
//Version: 2.4.1

// The whole API as ES module exports. There are no side effects: importing this file does not touch the page, does not load a script and does not
// put anything on globalThis. For pages that need globals use `athena-ui-js/classic`, and to download only what you use import from the entry points
// (`athena-ui-js/table`, `athena-ui-js/dialog`, ...).

import config, { applyConfig } from "./libs/config/config.js";
import { getAppConfig, setHooks } from "./libs/config/hooks.js";
import { loadScript, loadTheme } from "./libs/hephaestus/hephaestus.js";
import { generateBasicLayout, setLayoutRoot } from "./libs/hephaestus/LayoutGenerator/basicLayoutGenerator.js";
import { asHandle, resolveElement, uid } from "./libs/core/dom.js";
import { setLocale } from "./libs/core/i18n.js";

/**
 * Loads the theme, waits for the page and generates the layout.
 *
 * @param {object} [options]
 * @param {{id?: number, href?: string}} [options.theme] registered theme id or custom stylesheet
 * @param {object} [options.config] settings overriding the defaults (and the global appConfig)
 * @param {Function} [options.nav] navigation callback (falls back to the global nav)
 * @param {Function} [options.login] login callback (falls back to the global login)
 * @param {Function} [options.register] registration callback (falls back to the global register)
 * @param {Function} [options.lostPassword] lost password callback (falls back to the global lostPassword)
 * @param {Function} [options.changePassword] change password callback (falls back to the global changePassword)
 * @param {object} [options.menuItems] { headerMenu, footerMenu } (falls back to the global menuItems)
 * @returns {Promise<object>} the effective configuration
 */
export async function init(options = {}) {
    applyConfig(getAppConfig(), options.config);
    setLocale(config.locale);
    setHooks(options);

    await Promise.all([
        config.customLoader ? loadScript(config.customLoader) : undefined,
        loadTheme(options.theme ?? options.themes),
        new Promise(resolve => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", resolve, { once: true }) : resolve()))
    ]);

    generateBasicLayout();
    return config;
}

/**
 * Starts Athena UI inside an element of your page instead of the body, so it can be one part of a larger page (or of several apps).
 * It does what init() does (settings, language, theme, hooks), and the layout (container, header, wrapper, footer) is generated into
 * `root`. The parts follow the settings: `config: { generateHeader: false, generateFooter: false }` leaves only the wrapper, which is where
 * the components go by default (the element with the id "wrapper"). One app per page: the parts have fixed ids.
 *
 * @param {object} options the options of init(), and
 * @param {string|Element} options.root the element to build into (an element, an id or a selector)
 * @returns {Promise<{element: HTMLElement, container: HTMLElement, header: HTMLElement|null, wrapper: HTMLElement|null, footer: HTMLElement|null,
 *           config: object, update: Function, destroy: Function}>}
 */
export async function createApp(options = {}) {
    const root = resolveElement(options.root);
    if (!root) throw new Error("Athena UI: createApp needs a root element (an element, an id or a selector)");
    if (!root.id) root.id = uid("athena-app");
    setLayoutRoot(root.id);
    let effective;
    try {
        effective = await init(options);
    } finally {
        setLayoutRoot("");
    }
    return asHandle({
        element: root,
        container: document.getElementById("container"),
        header: document.getElementById("header"),
        wrapper: document.getElementById("wrapper"),
        footer: document.getElementById("footer"),
        config: effective,
        destroy() {
            document.getElementById("container")?.remove();
        }
    });
}

/**
 * Switches the theme at runtime: { id } of a registered theme or { href } of a stylesheet.
 * @returns {Promise<object>} the applied theme
 */
export function setTheme(selected) {
    return loadTheme(selected);
}

export { config, loadScript };
export { default as Cookies } from "./libs/core/cookies.js";
export * from "./libs/core/elementGenerator.js";
export * from "./libs/core/controls.js";
export * from "./libs/core/hungarianControls.js";
export * from "./libs/hephaestus/LayoutGenerator/basicLayoutGenerator.js";
export * from "./libs/hephaestus/LayoutGenerator/headerContentGenerator.js";
export * from "./libs/hephaestus/LayoutGenerator/wrapperContentGenerator.js";
export * from "./libs/hephaestus/LayoutGenerator/footerContentGenerator.js";
export * from "./libs/hephaestus/MenuGenerator/basicMenuGenerator.js";
export * from "./libs/hephaestus/MenuGenerator/menuGenerator.js";
export * from "./libs/hephaestus/formGenerator/loginFormGenerator.js";
export * from "./libs/hephaestus/formGenerator/registrationFormGenerator.js";
export * from "./libs/hephaestus/formGenerator/lostPasswordFormGenerator.js";
export * from "./libs/hephaestus/chartGenerator/chartGenerator.js";
export * from "./libs/hephaestus/tableGenerator/tableGenerator.js";
export * from "./libs/hephaestus/formGenerator/changePasswordFormGenerator.js";
export * from "./libs/hephaestus/formGenerator/formBuilder.js";
export * from "./libs/hephaestus/formGenerator/authForms.js";
export * from "./libs/hephaestus/feedbackGenerator/feedbackGenerator.js";
export * from "./libs/hephaestus/dialogGenerator/dialogGenerator.js";
export * from "./libs/hephaestus/navigationGenerator/navigationGenerator.js";
export * from "./libs/hephaestus/componentGenerator/componentGenerator.js";
export * from "./libs/hephaestus/inputGenerator/inputGenerator.js";
export * from "./libs/hephaestus/inputGenerator/dropZoneGenerator.js";
export * from "./libs/hephaestus/inputGenerator/richTextGenerator.js";
export { el, setContent, resolveElement, asHandle, createSafeBuilder } from "./libs/core/dom.js";
export * from "./libs/core/sanitize.js";
export * from "./libs/hephaestus/router/router.js";
export * from "./libs/hephaestus/auth/session.js";
export * from "./libs/hephaestus/auth/authState.js";
export * from "./libs/core/i18n.js";
export * from "./libs/core/validation.js";
export * from "./libs/core/csv.js";
export * from "./libs/core/dateRange.js";
export * from "./libs/core/format.js";
export * from "./libs/core/motion.js";
export * from "./libs/hephaestus/widgetGrid/widgetGrid.js";
export * from "./libs/core/gridLayout.js";
export * from "./libs/hephaestus/codeGenerator/codeGenerator.js";
export * from "./libs/hephaestus/codeGenerator/codeEditor.js";
export * from "./libs/core/codeLanguages.js";
export * from "./libs/core/codeDiff.js";
export * from "./libs/hephaestus/modalGenerator/modalGenerator.js";
export * from "./libs/core/theme.js";
export * from "./libs/hephaestus/componentGenerator/themePicker.js";
