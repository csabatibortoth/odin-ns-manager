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

/* ------------------DATE AND TIME RANGE------------------- */

const pad = n => String(n).padStart(2, "0");

/** A Date as the value of a datetime-local input, in the local time of the person: "2026-11-19T10:30". */
export function toLocalInput(date, seconds = false) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return seconds ? `${base}:${pad(d.getSeconds())}` : base;
}

/** The value of a datetime-local input as a Date (local time), or null when it is empty or not valid. */
export function fromLocalInput(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** The presets of generateDateTimeRange: a name, and how far back from now they reach. */
export const DEFAULT_RANGE_PRESETS = [
    { id: "15m", labelKey: "range.last15m", minutes: 15 },
    { id: "1h", labelKey: "range.last1h", minutes: 60 },
    { id: "24h", labelKey: "range.last24h", minutes: 24 * 60 },
    { id: "7d", labelKey: "range.last7d", minutes: 7 * 24 * 60 },
    { id: "30d", labelKey: "range.last30d", minutes: 30 * 24 * 60 }
];

/**
 * Internal: two datetime-local inputs and a list of presets (last 15 minutes, hour, 24 hours, 7 days). Choosing a preset fills
 * both inputs; changing an input switches the preset to "Custom". A preset is remembered as a preset: getRange() works out
 * "now" when it is called, so a screen that refreshes asks again and gets the moving window.
 *
 * @param {object} options
 * @param {string} [options.id]
 * @param {string} [options.from] initial start (datetime-local value)
 * @param {string} [options.to] initial end
 * @param {string} [options.preset] id of the preset to start with
 * @param {object[]} [options.presets] default DEFAULT_RANGE_PRESETS; { id, label | labelKey, minutes }
 * @param {boolean} [options.seconds=false] the inputs ask for seconds too
 * @param {string} [options.min]
 * @param {string} [options.max]
 * @param {boolean} [options.disabled]
 * @param {(value: {from: string, to: string, preset: string}) => void} [options.onChange]
 */
export function createDateTimeRange(options = {}) {
    const id = options.id ?? uid("datetimerange");
    const presets = options.presets ?? DEFAULT_RANGE_PRESETS;
    const step = options.seconds ? 1 : 60;
    const labelOf = preset => preset.label ?? translate(preset.labelKey);
    let preset = "";

    const select = el("select", { id: `${id}-preset`, attrs: { "aria-label": translate("range.preset") }, prop: { disabled: Boolean(options.disabled) } },
        el("option", { text: translate("range.custom"), prop: { value: "" } }),
        ...presets.map(p => el("option", { text: labelOf(p), prop: { value: p.id } })));
    const make = (suffix, labelKey) => {
        const input = el("input", { id: `${id}-${suffix}`, attrs: { type: "datetime-local", step, min: options.min, max: options.max }, prop: { disabled: Boolean(options.disabled) } });
        return { input, label: el("label", { class: "daterange-part" }, el("span", { text: translate(labelKey) }), input) };
    };
    const from = make("from", "dateFrom");
    const to = make("to", "dateTo");
    const element = el("div", { class: cx("daterange datetimerange", options.class), attrs: { role: "group" } },
        el("label", { class: "daterange-part" }, el("span", { text: translate("range.preset") }), select), from.label, to.label);

    const presetRange = id2 => {
        const found = presets.find(p => p.id === id2);
        if (!found) return null;
        const now = new Date();
        return { from: new Date(now.getTime() - found.minutes * 60000), to: now };
    };
    const getValue = () => ({ from: from.input.value, to: to.input.value, preset });
    const apply = id2 => {
        preset = id2;
        select.value = id2;
        const range = presetRange(id2);
        if (range) {
            from.input.value = toLocalInput(range.from, options.seconds);
            to.input.value = toLocalInput(range.to, options.seconds);
        }
    };
    select.addEventListener("change", () => {
        apply(select.value);
        options.onChange?.(getValue());
    });
    for (const part of [from, to]) {
        part.input.addEventListener("change", () => {
            preset = "";
            select.value = "";
            options.onChange?.(getValue());
        });
    }
    const setValue = value => {
        if (value?.preset) apply(value.preset);
        else {
            preset = "";
            select.value = "";
            from.input.value = value?.from ?? "";
            to.input.value = value?.to ?? "";
        }
    };
    setValue({ from: options.from, to: options.to, preset: options.preset });
    const validate = () => {
        const a = fromLocalInput(from.input.value);
        const b = fromLocalInput(to.input.value);
        if (a && b && b < a) return translate("validation.dateRange");
        return "";
    };
    return {
        element,
        inputs: [select, from.input, to.input],
        getValue,
        setValue,
        /** The range as Dates: a preset is measured from now (when this is called), a custom range is what the inputs hold. */
        getRange() {
            const moving = presetRange(preset);
            return moving ?? { from: fromLocalInput(from.input.value), to: fromLocalInput(to.input.value) };
        },
        validate
    };
}
