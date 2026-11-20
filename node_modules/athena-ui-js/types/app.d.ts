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
export function init(options?: {
    theme?: {
        id?: number;
        href?: string;
    };
    config?: object;
    nav?: Function;
    login?: Function;
    register?: Function;
    lostPassword?: Function;
    changePassword?: Function;
    menuItems?: object;
}): Promise<object>;
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
export function createApp(options?: {
    root: string | Element;
}): Promise<{
    element: HTMLElement;
    container: HTMLElement;
    header: HTMLElement | null;
    wrapper: HTMLElement | null;
    footer: HTMLElement | null;
    config: object;
    update: Function;
    destroy: Function;
}>;
/**
 * Switches the theme at runtime: { id } of a registered theme or { href } of a stylesheet.
 * @returns {Promise<object>} the applied theme
 */
export function setTheme(selected: any): Promise<object>;
import config from "./libs/config/config.js";
import { loadScript } from "./libs/hephaestus/hephaestus.js";
export { config, loadScript };
