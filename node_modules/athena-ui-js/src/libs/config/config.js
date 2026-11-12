//config for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

export const BORDERED_CLASS = "default-cointainer-bordered";

export const defaults = Object.freeze({
    version: "0.4.1",
    container_class: "container",
    header_class: "header-container",
    header_menu_class: "header-menu menu",
    wrapper_class: "wrapper-container",
    footer_class: "footer-container",
    footer_menu_class: "footer-menu menu",
    loginForm_class: "login-form form",

    bordered: true,
    generateHeader: true,
    generateFooter: true,
    generateHeadercontent: true,
    generateFooterContent: true,
    generateWrappercontent: true,
    login_enabled: false,
    enable_encrypt_password: false,

    header_title_text: "Athena UI",
    header_img_url: undefined,
    copyright: "Here is the bottom Copyright Text for website",

    // URL (relative to the page) of an extra classic script, loaded before the layout is generated
    customLoader: undefined
});

const config = { ...defaults };

export default config;

// Copies every known setting that is defined in the given sources onto the live config.
export function applyConfig(...sources) {
    for (const source of sources) {
        if (!source) continue;
        for (const key of Object.keys(defaults)) {
            if (source[key] !== undefined) config[key] = source[key];
        }
    }
    return config;
}

// Appends the border class to a class list when borders are enabled.
export function withBorder(className) {
    return config.bordered ? `${className} ${BORDERED_CLASS}` : className;
}
