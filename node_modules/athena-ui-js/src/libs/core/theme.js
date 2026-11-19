//theme manager for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

// The look of an application: a theme (a set of colours) and a mode (light, dark, or whatever the system uses).
// Both are a choice of the person at this browser. They are kept in localStorage and put on <html> as
// data-theme and data-mode, which is what the stylesheets read:
//
//     <html data-theme="ocean" data-mode="dark">
//
//     [data-theme="ocean"][data-mode="light"] { --athena-bg: #f4f9fb; ... }
//     [data-theme="ocean"][data-mode="dark"]  { --athena-bg: #0b1c24; ... }
//
// Nothing is sent to a server. theme-boot.js (a classic script of its own) sets the two attributes before the page is
// drawn, so the wrong colours never flash.

import { prefersReducedMotion, readDuration } from "./motion.js";

export const DEFAULT_MODES = [
    { id: "system", name: "Like the system" },
    { id: "light", name: "Light" },
    { id: "dark", name: "Dark" }
];

/**
 * @param {object} options
 * @param {{id: string, name?: string, description?: string}[]} options.themes the first one is the default
 * @param {{id: string, name?: string}[]} [options.modes] default: system, light, dark. Ids "light" and "dark" are the ones that can be resolved
 * @param {string} [options.storageKey="athena.appearance"] localStorage key (also give it to theme-boot.js)
 * @param {string} [options.themeColorVariable] CSS variable whose value becomes <meta name="theme-color"> (the bar of a phone browser)
 * @param {HTMLElement} [options.root] element that gets the attributes (default: <html>)
 * @param {Storage} [options.storage] default: localStorage
 * @param {boolean} [options.transition=true] colours cross-fade when the theme or the mode changes (not under reduced motion)
 * @returns {{themes, modes, appearance: () => object, setTheme: (id) => boolean, setMode: (id) => boolean,
 *            onChange: (listener) => Function, refresh: Function, destroy: Function}}
 */
export function createThemeManager(options = {}) {
    const themes = options.themes ?? [];
    if (!themes.length) throw new Error("Athena UI: createThemeManager needs at least one theme");
    const modes = options.modes ?? DEFAULT_MODES;
    const key = options.storageKey ?? "athena.appearance";
    const root = options.root ?? document.documentElement;
    const storage = options.storage ?? globalThis.localStorage;
    const view = root.ownerDocument.defaultView ?? globalThis;
    const listeners = new Set();
    const systemDark = () => view.matchMedia?.("(prefers-color-scheme: dark)");

    const read = () => {
        try {
            const saved = JSON.parse(storage?.getItem(key) || "{}");
            return {
                theme: themes.some(theme => theme.id === saved.theme) ? saved.theme : themes[0].id,
                mode: modes.some(mode => mode.id === saved.mode) ? saved.mode : "system"
            };
        } catch {
            return { theme: themes[0].id, mode: "system" };
        }
    };

    let current = read();
    const appearance = () => ({ ...current, dark: root.dataset.mode === "dark" });

    let fade = 0;
    let started = false;
    function apply() {
        // A change after the first one cross-fades: the class makes every colour transition for a moment
        if (started && options.transition !== false && !prefersReducedMotion()) {
            root.classList.add("athena-switching");
            clearTimeout(fade);
            fade = setTimeout(() => root.classList.remove("athena-switching"), readDuration("--athena-duration-slow", root) + 60);
        }
        started = true;
        const dark = current.mode === "dark" || (current.mode === "system" && Boolean(systemDark()?.matches));
        root.dataset.theme = current.theme;
        root.dataset.mode = dark ? "dark" : "light";
        if (options.themeColorVariable) {
            const doc = root.ownerDocument;
            let meta = doc.querySelector('meta[name="theme-color"]');
            if (!meta) {
                meta = doc.createElement("meta");
                meta.name = "theme-color";
                doc.head.append(meta);
            }
            const color = view.getComputedStyle(root).getPropertyValue(options.themeColorVariable).trim();
            if (color) meta.content = color;
        }
        listeners.forEach(listener => listener(appearance()));
    }

    function save(change) {
        current = { ...current, ...change };
        try {
            storage?.setItem(key, JSON.stringify(current));
        } catch {
            // Not saved (private browsing, full storage), but it works until the page is closed
        }
        apply();
    }

    const onSystemChange = () => { if (current.mode === "system") apply(); };
    const onStorage = event => {
        if (event.key !== key) return;   // another tab changed it
        current = read();
        apply();
    };
    const media = systemDark();
    media?.addEventListener?.("change", onSystemChange);
    view.addEventListener?.("storage", onStorage);
    apply();

    return {
        themes,
        modes,
        appearance,
        /** Chooses a theme. Returns false (and changes nothing) for one that does not exist. */
        setTheme(id) {
            if (!themes.some(theme => theme.id === id)) return false;
            save({ theme: id });
            return true;
        },
        /** Chooses a mode. Returns false (and changes nothing) for one that does not exist. */
        setMode(id) {
            if (!modes.some(mode => mode.id === id)) return false;
            save({ mode: id });
            return true;
        },
        /** Called with { theme, mode, dark } now, and whenever the look changes. Returns a function that stops it. */
        onChange(listener) {
            listeners.add(listener);
            listener(appearance());
            return () => listeners.delete(listener);
        },
        /** The stylesheet may have loaded after the first call: read the colours (theme-color) again. */
        refresh: apply,
        /** Stops listening to the system and to other tabs. */
        destroy() {
            media?.removeEventListener?.("change", onSystemChange);
            view.removeEventListener?.("storage", onStorage);
            listeners.clear();
        }
    };
}
