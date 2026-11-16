//Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui
//Version: 1.0.0

/* global $ */

import config, { applyConfig } from "./libs/config/config.js";
import { getAppConfig, setHooks } from "./libs/config/hooks.js";
import { loadLibs, loadScript, loadTheme } from "./libs/hephaestus/hephaestus.js";
import * as layout from "./libs/hephaestus/LayoutGenerator/basicLayoutGenerator.js";
import * as header from "./libs/hephaestus/LayoutGenerator/headerContentGenerator.js";
import * as wrapper from "./libs/hephaestus/LayoutGenerator/wrapperContentGenerator.js";
import * as footer from "./libs/hephaestus/LayoutGenerator/footerContentGenerator.js";
import * as menu from "./libs/hephaestus/MenuGenerator/basicMenuGenerator.js";
import * as loginForm from "./libs/hephaestus/formGenerator/loginFormGenerator.js";
import * as registrationForm from "./libs/hephaestus/formGenerator/registrationFormGenerator.js";
import * as lostPasswordForm from "./libs/hephaestus/formGenerator/lostPasswordFormGenerator.js";
import * as chart from "./libs/hephaestus/chartGenerator/chartGenerator.js";
import * as table from "./libs/hephaestus/tableGenerator/tableGenerator.js";
import * as changePasswordForm from "./libs/hephaestus/formGenerator/changePasswordFormGenerator.js";
import * as formBuilder from "./libs/hephaestus/formGenerator/formBuilder.js";
import * as feedback from "./libs/hephaestus/feedbackGenerator/feedbackGenerator.js";
import * as dialog from "./libs/hephaestus/dialogGenerator/dialogGenerator.js";
import * as navigation from "./libs/hephaestus/navigationGenerator/navigationGenerator.js";
import * as components from "./libs/hephaestus/componentGenerator/componentGenerator.js";
import * as inputs from "./libs/hephaestus/inputGenerator/inputGenerator.js";
import * as richText from "./libs/hephaestus/inputGenerator/richTextGenerator.js";
import * as sanitize from "./libs/core/sanitize.js";
import * as router from "./libs/hephaestus/router/router.js";
import * as session from "./libs/hephaestus/auth/session.js";
import * as i18n from "./libs/core/i18n.js";
import * as validation from "./libs/core/validation.js";
import * as csv from "./libs/core/csv.js";
import * as modal from "./libs/hephaestus/modalGenerator/modalGenerator.js";
import Cookies from "./libs/js-cookie/src/api.mjs";
import { HTMLElementGenerator } from "./libs/hephaestus/HTMLElementGenerator/src/HTMLElementGenerator.js";

if (typeof $ !== "function") {
    throw new Error("Athena UI: jQuery has to be loaded before athena-ui.js");
}

/**
 * Loads the libraries and the theme in parallel, then generates the layout.
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
    i18n.setLocale(config.locale);
    setHooks(options);

    await Promise.all([
        loadLibs(config.customLoader ? [config.customLoader] : []),
        loadTheme(options.theme ?? options.themes),
        new Promise(resolve => $(resolve))
    ]);

    layout.generateBasicLayout();
    return config;
}

/**
 * Switches the theme at runtime: { id } of a registered theme or { href } of a stylesheet.
 * @returns {Promise<object>} the applied theme
 */
export function setTheme(selected) {
    return loadTheme(selected);
}

const AthenaUI = {
    init,
    config,
    loadScript,
    Cookies,
    HTMLElementGenerator,
    ...layout,
    ...header,
    ...wrapper,
    ...footer,
    ...menu,
    ...loginForm,
    ...registrationForm,
    ...lostPasswordForm,
    ...changePasswordForm,
    ...formBuilder,
    ...feedback,
    ...dialog,
    ...navigation,
    ...components,
    ...inputs,
    ...richText,
    ...sanitize,
    ...router,
    ...session,
    ...i18n,
    ...validation,
    ...csv,
    setTheme,
    ...chart,
    ...table,
    ...modal
};

// Classic scripts (the customLoader, inline handlers) keep working: the whole API
// stays reachable as globals, like in the pre-module versions.
Object.assign(globalThis, AthenaUI, { AthenaUI });

export { config, loadScript, Cookies, HTMLElementGenerator };
export * from "./libs/hephaestus/LayoutGenerator/basicLayoutGenerator.js";
export * from "./libs/hephaestus/LayoutGenerator/headerContentGenerator.js";
export * from "./libs/hephaestus/LayoutGenerator/wrapperContentGenerator.js";
export * from "./libs/hephaestus/LayoutGenerator/footerContentGenerator.js";
export * from "./libs/hephaestus/MenuGenerator/basicMenuGenerator.js";
export * from "./libs/hephaestus/formGenerator/loginFormGenerator.js";
export * from "./libs/hephaestus/formGenerator/registrationFormGenerator.js";
export * from "./libs/hephaestus/formGenerator/lostPasswordFormGenerator.js";
export * from "./libs/hephaestus/chartGenerator/chartGenerator.js";
export * from "./libs/hephaestus/tableGenerator/tableGenerator.js";
export * from "./libs/hephaestus/formGenerator/changePasswordFormGenerator.js";
export * from "./libs/hephaestus/formGenerator/formBuilder.js";
export * from "./libs/hephaestus/feedbackGenerator/feedbackGenerator.js";
export * from "./libs/hephaestus/dialogGenerator/dialogGenerator.js";
export * from "./libs/hephaestus/navigationGenerator/navigationGenerator.js";
export * from "./libs/hephaestus/componentGenerator/componentGenerator.js";
export * from "./libs/hephaestus/inputGenerator/inputGenerator.js";
export * from "./libs/hephaestus/inputGenerator/richTextGenerator.js";
export * from "./libs/core/sanitize.js";
export * from "./libs/hephaestus/router/router.js";
export * from "./libs/hephaestus/auth/session.js";
export * from "./libs/core/i18n.js";
export * from "./libs/core/validation.js";
export * from "./libs/core/csv.js";
export * from "./libs/hephaestus/modalGenerator/modalGenerator.js";
export default AthenaUI;
