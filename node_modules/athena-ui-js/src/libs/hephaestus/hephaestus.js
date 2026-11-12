//Hephaestus module loader for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import libs from "../libs.js";
import themes from "../../res/themes/themes.js";

const loadedScripts = new Map();

// Loads a classic script once. Scripts download in parallel but execute in the
// order they were requested, and stay cacheable by the browser.
export function loadScript(src) {
    if (!loadedScripts.has(src)) {
        loadedScripts.set(src, new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = src;
            script.async = false;
            script.onload = () => resolve(src);
            script.onerror = () => {
                loadedScripts.delete(src);
                script.remove();
                reject(new Error(`Athena UI: failed to load ${src}`));
            };
            document.head.append(script);
        }));
    }
    return loadedScripts.get(src);
}

export function loadLibs(extraScripts = []) {
    return Promise.all([...libs.map(lib => lib.src), ...extraScripts].map(loadScript));
}

// Accepts { id } of a registered theme or a custom { href }. Falls back to the default theme.
export function resolveTheme(selected) {
    if (selected?.href) return selected;
    return themes.find(theme => theme.id === selected?.id) ?? themes[0];
}

// Resolves once the stylesheet is applied, so the layout never renders unstyled.
export function loadTheme(selected) {
    const theme = resolveTheme(selected);
    return new Promise(resolve => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = theme.href;
        link.onload = () => resolve(theme);
        link.onerror = () => {
            console.warn(`Athena UI: failed to load theme ${theme.name ?? theme.href}`);
            resolve(theme);
        };
        document.head.append(link);
    });
}
