//dateRange for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { cx, el, uid } from "./dom.js";
import { translate } from "./i18n.js";
import { validateDateRange } from "./validation.js";

/**
 * Internal: two native date inputs (from / to). The "to" picker starts at the chosen start date.
 * Values are ISO dates ("2026-01-31"), an empty date is "".
 */
export function createDateRange(options = {}) {
    const id = options.id ?? uid("daterange");
    const make = (suffix, labelKey) => {
        const input = el("input", { id: `${id}-${suffix}`, attrs: { type: "date", name: options.name ? `${options.name}-${suffix}` : null, min: options.min, max: options.max }, prop: { disabled: Boolean(options.disabled) } });
        const label = el("label", { class: "daterange-part" }, el("span", { text: translate(labelKey) }), input);
        return { input, label };
    };
    const from = make("from", "dateFrom");
    const to = make("to", "dateTo");
    const element = el("div", { class: cx("daterange", options.class), attrs: { role: "group" } }, from.label, to.label);

    const syncLimits = () => {
        // The end cannot be picked before the start (when no minimum is set, the start is the minimum).
        to.input.min = from.input.value || options.min || "";
        from.input.max = to.input.value || options.max || "";
    };
    const getValue = () => ({ from: from.input.value, to: to.input.value });
    const setValue = value => {
        from.input.value = value?.from ?? "";
        to.input.value = value?.to ?? "";
        syncLimits();
    };
    for (const part of [from, to]) {
        part.input.addEventListener("change", () => {
            syncLimits();
            options.onChange?.(getValue());
        });
    }
    setValue({ from: options.from ?? options.value?.from, to: options.to ?? options.value?.to });
    return {
        element,
        inputs: [from.input, to.input],
        getValue,
        setValue,
        validate: () => validateDateRange(from.input.value, to.input.value, { min: options.min, max: options.max })
    };
}
