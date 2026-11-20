//themePicker for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { asHandle, cx, el, mount, uid } from "../../core/dom.js";
import { translate } from "../../core/i18n.js";

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
 * @param {"current"|"both"} [options.previewModes="current"] "current": one picture, in the mode that is in use. "both": the light and the dark picture side by side, so a person sees what each mode of a theme looks like
 * @param {string} [options.class]
 * @returns {{element: HTMLElement, update: Function, destroy: Function}}
 */
export function generateThemePicker(options = {}) {
    const { manager } = options;
    if (!manager) throw new Error("Athena UI: generateThemePicker needs a manager from createThemeManager");
    const name = uid("appearance");

    const group = (legend, items, kind, preview) => {
        const set = el("fieldset", { class: `theme-picker-group theme-picker-${kind}` }, el("legend", { text: legend }));
        const list = el("div", { class: "theme-picker-options" });
        for (const item of items) {
            const input = el("input", { attrs: { type: "radio", name: `${name}-${kind}`, value: item.id } });
            input.addEventListener("change", () => {
                if (input.checked) (kind === "theme" ? manager.setTheme : manager.setMode)(item.id);
            });
            const label = el("label", { class: "theme-picker-option", attrs: { "data-id": item.id } }, input);
            if (preview) label.append(preview(item));
            label.append(el("span", { class: "theme-picker-name", text: item.name ?? item.id }));
            if (item.description) label.append(el("span", { class: "theme-picker-description", text: item.description }));
            list.append(label);
        }
        set.append(list);
        return set;
    };

    const page = (theme, mode, className) => el("span", { class: className, attrs: { "data-theme": theme.id, "data-mode": mode } },
        el("span", { class: "theme-preview-bar" }),
        el("span", { class: "theme-preview-body" }, el("span", { class: "theme-preview-line" }), el("span", { class: "theme-preview-button" })));
    // A small page drawn with the colours of the theme, in the mode that is in use (the light one for "system" in a light browser), or in both modes.
    const preview = theme => options.previewModes === "both" ? el("span", { class: "theme-preview theme-preview-both", attrs: { "aria-hidden": "true" } },
        page(theme, "light", "theme-preview-half"), page(theme, "dark", "theme-preview-half")) : el("span", {
        class: "theme-preview",
        attrs: { "data-theme": theme.id, "data-mode": manager.appearance().dark ? "dark" : "light", "aria-hidden": "true" }
    },
    el("span", { class: "theme-preview-bar" }),
    el("span", { class: "theme-preview-body" }, el("span", { class: "theme-preview-line" }), el("span", { class: "theme-preview-button" })));

    const element = el("div", { class: cx("theme-picker", options.class) });
    const render = () => {
        element.replaceChildren(
            group(options.themeLabel ?? translate("theme"), manager.themes, "theme", preview),
            group(options.modeLabel ?? translate("mode"), manager.modes, "mode", null)
        );
        sync(manager.appearance());
    };
    const sync = state => {
        for (const input of element.querySelectorAll("input")) {
            const kind = input.name.endsWith("-theme") ? "theme" : "mode";
            input.checked = input.value === state[kind];
        }
        // The previews follow dark / light
        for (const node of element.querySelectorAll(".theme-preview:not(.theme-preview-both)")) node.dataset.mode = state.dark ? "dark" : "light";
    };
    render();
    const stop = manager.onChange(sync);
    mount(options.parent, element);
    return asHandle({ element, update: () => { render(); }, destroy() { stop(); element.remove(); } });
}
