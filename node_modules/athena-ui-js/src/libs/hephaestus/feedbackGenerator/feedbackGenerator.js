//feedbackGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { cx, el, mount, setContent } from "../../core/dom.js";
import { translate } from "../../core/i18n.js";

const TOAST_CONTAINER_ID = "athena-toasts";
const URGENT_TYPES = new Set(["error", "warning"]);

function closeButton(onclick) {
    return el("button", {
        class: "alert-close",
        text: "×",
        attrs: { type: "button", "aria-label": translate("close") },
        on: { click: onclick }
    });
}

/**
 * Shows a toast notification in the corner of the page.
 *
 * @param {object|string} options a message, or an options object
 * @param {string} options.message
 * @param {string} [options.title]
 * @param {"info"|"success"|"warning"|"error"} [options.type="info"]
 * @param {number} [options.duration=4000] ms before it disappears, 0 keeps it until it is closed
 * @returns {{close: Function}}
 */
export function showToast(options) {
    const { message, title, type = "info", duration = 4000 } = typeof options === "string" ? { message: options } : options;
    let container = document.getElementById(TOAST_CONTAINER_ID);
    if (!container) {
        container = el("div", { id: TOAST_CONTAINER_ID, class: "toast-container" });
        document.body.append(container);
    }
    let timer;
    const close = () => {
        clearTimeout(timer);
        toast.remove();
    };
    const toast = el("div", {
        class: cx("toast", `alert-${type}`),
        attrs: { role: URGENT_TYPES.has(type) ? "alert" : "status" }
    }, el("div", { class: "alert-body" }, title ? el("strong", { text: title }) : "", el("div", { text: message })), closeButton(close));
    container.append(toast);
    if (duration > 0) {
        timer = setTimeout(close, duration);
        // Do not hide a toast the user is reading.
        toast.addEventListener("mouseenter", () => clearTimeout(timer));
        toast.addEventListener("mouseleave", () => { timer = setTimeout(close, duration); });
    }
    return { close };
}

/**
 * Generates an inline alert box.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.id]
 * @param {string|Node} options.message
 * @param {string} [options.title]
 * @param {"info"|"success"|"warning"|"error"} [options.type="info"]
 * @param {boolean} [options.dismissible]
 * @returns {HTMLElement}
 */
export function generateAlert(options = {}) {
    const { type = "info", title, message, dismissible } = options;
    const body = el("div", { class: "alert-body" });
    if (title) body.append(el("strong", { text: title }));
    body.append(setContent(el("div"), message));
    const alert = el("div", {
        id: options.id,
        class: cx("alert", `alert-${type}`, options.class),
        attrs: { role: URGENT_TYPES.has(type) ? "alert" : "status" }
    }, body);
    if (dismissible) alert.append(closeButton(() => alert.remove()));
    return mount(options.parent, alert);
}

/**
 * Generates a loading spinner.
 *
 * @param {object} [options]
 * @param {string|Element} [options.parent]
 * @param {string} [options.id]
 * @param {"small"|"large"} [options.size]
 * @param {string} [options.label] accessible text, defaults to the translated "Loading..."
 * @returns {HTMLElement}
 */
export function generateSpinner(options = {}) {
    return mount(options.parent, el("span", {
        id: options.id,
        class: cx("spinner", options.size && `spinner-${options.size}`, options.class),
        attrs: { role: "status", "aria-label": options.label ?? translate("loading") }
    }));
}

/**
 * Generates a progress bar. Without a value it is indeterminate.
 *
 * @param {object} [options]
 * @param {string|Element} [options.parent]
 * @param {string} [options.id]
 * @param {number} [options.value] 0..max
 * @param {number} [options.max=100]
 * @param {string} [options.label] text shown above the bar
 * @param {"info"|"success"|"warning"|"error"} [options.type]
 * @returns {{element: HTMLElement, setValue: (value: number) => void}}
 */
export function generateProgress(options = {}) {
    const max = options.max ?? 100;
    const fill = el("div", { class: "progress-fill" });
    const bar = el("div", {
        class: "progress-bar",
        attrs: { role: "progressbar", "aria-valuemin": 0, "aria-valuemax": max, "aria-label": options.label ?? null }
    }, fill);
    const element = el("div", { id: options.id, class: cx("progress", options.type && `progress-${options.type}`, options.class) },
        options.label ? el("div", { class: "progress-label", text: options.label }) : "", bar);

    const setValue = value => {
        const indeterminate = value == null;
        element.classList.toggle("progress-indeterminate", indeterminate);
        if (indeterminate) {
            bar.removeAttribute("aria-valuenow");
            fill.style.width = "";
        } else {
            const clamped = Math.min(Math.max(value, 0), max);
            bar.setAttribute("aria-valuenow", clamped);
            fill.style.width = `${(clamped / max) * 100}%`;
        }
    };
    setValue(options.value);
    mount(options.parent, element);
    return { element, setValue };
}
