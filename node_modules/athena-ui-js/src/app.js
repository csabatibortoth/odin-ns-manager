//app entry of Athena UI: init, createApp and setTheme, the start of a page, without the components
//Import only what you use: `import { init } from "athena-ui-js/app"`. The root file loads every component, this one only the layout and the theme.
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

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
