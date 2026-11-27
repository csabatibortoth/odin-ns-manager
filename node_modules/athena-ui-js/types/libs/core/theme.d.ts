/**
 * @param {object} options
 * @param {{id: string, name?: string, description?: string, defaultMode?: "light"|"dark"}[]} options.themes the first one is the default. `defaultMode`: the mode this
 *        theme is shown in while the person has not chosen a mode (give theme-boot.js the same with data-dark-themes / data-light-themes)
 * @param {{id: string, name?: string}[]} [options.modes] default: system, light, dark. Ids "light" and "dark" are the ones that can be resolved
 * @param {string} [options.storageKey="athena.appearance"] localStorage key (also give it to theme-boot.js)
 * @param {string} [options.themeColorVariable] CSS variable whose value becomes <meta name="theme-color"> (the bar of a phone browser)
 * @param {HTMLElement} [options.root] element that gets the attributes (default: <html>)
 * @param {Storage} [options.storage] default: localStorage
 * @param {boolean} [options.transition=true] colours cross-fade when the theme or the mode changes (not under reduced motion)
 * @returns {{themes, modes, appearance: () => object, setTheme: (id) => boolean, setMode: (id) => boolean,
 *            onChange: (listener) => Function, refresh: Function, destroy: Function}}
 */
export function createThemeManager(options?: {
    themes: {
        id: string;
        name?: string;
        description?: string;
        defaultMode?: "light" | "dark";
    }[];
    modes?: {
        id: string;
        name?: string;
    }[];
    storageKey?: string;
    themeColorVariable?: string;
    root?: HTMLElement;
    storage?: Storage;
    transition?: boolean;
}): {
    themes: any;
    modes: any;
    appearance: () => object;
    setTheme: (id: any) => boolean;
    setMode: (id: any) => boolean;
    onChange: (listener: any) => Function;
    refresh: Function;
    destroy: Function;
};
export const DEFAULT_MODES: {
    id: string;
    name: string;
}[];
