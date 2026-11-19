/**
 * Generates the appearance picker of an account page: a group of themes with a small preview of each, and a group of modes.
 * The preview is drawn with the colours of the theme itself: the stylesheet of a theme applies to any element that has the
 * attributes data-theme and data-mode, not only to <html>.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {ReturnType<import("../../core/theme.js").createThemeManager>} options.manager
 * @param {string} [options.themeLabel] legend of the theme group (default: translated "Theme")
 * @param {string} [options.modeLabel] legend of the mode group (default: translated "Mode")
 * @param {string} [options.class]
 * @returns {{element: HTMLElement, update: Function, destroy: Function}}
 */
export function generateThemePicker(options?: {
    parent?: string | Element;
    manager: ReturnType<typeof import("../../core/theme.js").createThemeManager>;
    themeLabel?: string;
    modeLabel?: string;
    class?: string;
}): {
    element: HTMLElement;
    update: Function;
    destroy: Function;
};
