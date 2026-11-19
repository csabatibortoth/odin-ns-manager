//dialogGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { cx, el, setContent, uid } from "../../core/dom.js";
import { removeAfterTransition } from "../../core/motion.js";
import { translate } from "../../core/i18n.js";
import { generateButton, generateForm } from "../formGenerator/formBuilder.js";

/**
 * Opens a dialog and resolves with the value of the button that was used,
 * or with `null` when it was dismissed (Esc, the close button, a click on the backdrop).
 *
 * @param {object} options
 * @param {string} [options.title]
 * @param {string|Node|Array} [options.content] text is inserted as text, never as HTML
 * @param {{text: string, value?: *, variant?: string, autofocus?: boolean}[]} [options.buttons]
 * @param {boolean} [options.dismissible=true]
 * @param {(value) => (boolean|Promise<boolean>)} [options.beforeClose] return false to keep the dialog open
 * @param {"small"|"medium"|"large"|"full"} [options.size="medium"] width of the dialog (360 / 480 / 720 px / the whole window)
 * @param {string} [options.class] extra CSS class(es) of the dialog element
 * @returns {Promise<*> & {element: HTMLDialogElement, backdrop: HTMLDialogElement, close: (value?) => Promise<void>}}
 *          resolves with the pressed button's value; the promise also carries the handle of the open dialog
 */
export function showDialog(options = {}) {
    const { title, content, buttons = [{ text: translate("ok"), value: true }], dismissible = true } = options;
    let handle;
    const promise = new Promise(resolve => {
        const titleId = uid("dialog-title");
        const body = setContent(el("div", { class: "dialog-body" }), content);
        const footer = el("div", { class: "dialog-footer" });
        // A native <dialog>, opened with showModal(): the browser traps the focus, closes it with Esc, puts it above everything (the top layer),
        // makes the page behind it inert, draws the backdrop (::backdrop) and gives the focus back. No inline style is needed.
        const inner = el("div", { class: "dialog-inner" });
        const dialog = el("dialog", {
            class: cx("dialog", options.size && `dialog-${options.size}`, options.class),
            attrs: { "aria-labelledby": title ? titleId : null }
        }, inner);
        if (title) inner.append(el("h2", { class: "dialog-title", id: titleId, text: title }));
        inner.append(body, footer);

        let closing = false;
        const close = async value => {
            if (closing) return;
            closing = true;
            if (options.beforeClose && (await options.beforeClose(value)) === false) {
                closing = false;
                return;
            }
            if (dialog.open) dialog.close();
            resolve(value);
            removeAfterTransition(dialog);      // it fades out first (at once under reduced motion)
        };

        // Esc: the browser asks (cancel); a dialog that cannot be dismissed stays, and beforeClose can still say no
        dialog.addEventListener("cancel", event => {
            event.preventDefault();
            if (dismissible) close(null);
        });
        if (dismissible) {
            inner.prepend(el("button", {
                class: "dialog-close",
                text: "×",
                attrs: { type: "button", "aria-label": translate("close") },
                on: { click: () => close(null) }
            }));
            // A click on the backdrop lands on the dialog element itself (its content fills it up to the edge)
            dialog.addEventListener("mousedown", event => { if (event.target === dialog) close(null); });
        }
        for (const spec of buttons) {
            const { element } = generateButton({
                parent: footer,
                text: spec.text,
                variant: spec.variant ?? "primary",
                onclick: () => close("value" in spec ? spec.value : spec.text)
            });
            if (spec.autofocus) element.dataset.autofocus = "true";
        }

        document.body.append(dialog);
        // Without showModal (an old browser, or jsdom without athena-ui-js/testing) it is opened as a plain, non-modal dialog.
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
        dialog.querySelector("[data-autofocus]")?.focus();
        handle = { element: dialog, backdrop: dialog, close: value => close(value ?? null) };
    });
    // The executor above runs synchronously, so the handle exists here.
    return Object.assign(promise, handle);
}

/** Message with an OK button. Resolves when it is closed. */
export async function alertDialog(message, { title, okText = translate("ok") } = {}) {
    await showDialog({ title, content: message, buttons: [{ text: okText, value: true, autofocus: true }] });
}

/** Question with confirm and cancel buttons. Resolves with true / false. See showConfirm for `typeToConfirm`. */
export function confirmDialog(message, options = {}) {
    return showConfirm({ ...options, message });
}

/**
 * Asks for a confirmation. Resolves with true when confirmed, false when cancelled or dismissed.
 *
 * @param {object} options
 * @param {string} [options.title]
 * @param {string|Node|Array} options.message
 * @param {string} [options.confirmText]
 * @param {string} [options.cancelText]
 * @param {boolean} [options.danger=false] red confirm button
 * @param {string} [options.typeToConfirm] the person has to type exactly this text before the dialog confirms
 *        (for things that cannot be undone: the name of what is deleted)
 * @param {"small"|"medium"|"large"|"full"} [options.size]
 * @returns {Promise<boolean> & {element: HTMLElement, close: Function}}
 */
export function showConfirm({ title, message, confirmText = translate("ok"), cancelText = translate("cancel"), danger = false, typeToConfirm, size } = {}) {
    let input = null;
    const error = el("div", { class: "field-error", attrs: { role: "alert" } });
    const content = [message];
    if (typeToConfirm) {
        input = el("input", { class: "confirm-input", attrs: { type: "text", autocomplete: "off", "aria-label": typeToConfirm, "data-autofocus": "true" } });
        content.push(el("p", { class: "confirm-prompt", text: translate("typeToConfirm", { text: typeToConfirm }) }), input, error);
    }
    const dialog = showDialog({
        title,
        content,
        size,
        buttons: [
            { text: cancelText, value: false, variant: "secondary" },
            { text: confirmText, value: true, variant: danger ? "danger" : "primary", autofocus: !typeToConfirm }
        ],
        beforeClose: value => {
            if (value !== true || !typeToConfirm || input.value === typeToConfirm) return true;
            error.textContent = translate("textMismatch");
            input.focus();
            return false;
        }
    });
    return Object.assign(dialog.then(result => result === true), { element: dialog.element, backdrop: dialog.backdrop, close: dialog.close });
}

/**
 * A dialog that holds a form (see generateForm): validation, Enter submits, the button shows a spinner while it saves.
 * `onSubmit(values, form)` saves. When it throws (or rejects) the message is shown in the dialog and the dialog stays open;
 * `form.setErrors({ field: "message" })` marks single fields, for example with errors of the server. When it returns, the dialog closes.
 *
 * @param {object} options
 * @param {string} [options.title]
 * @param {string} [options.intro] text above the fields
 * @param {string|Node|Array} [options.content] nodes above the fields
 * @param {object[]} options.fields field definitions, see generateField
 * @param {string} [options.submitText]
 * @param {string} [options.cancelText]
 * @param {boolean} [options.danger=false] red submit button
 * @param {"small"|"medium"|"large"|"full"} [options.size]
 * @param {(values: object, form: object) => (void|Promise)} options.onSubmit
 * @param {(form: object) => void} [options.onReady] called with the form once it is built
 * @returns {Promise<boolean> & {element: HTMLElement, form: object, close: Function}} resolves with true when it was saved, false when dismissed
 */
export function showFormDialog({ title, intro, content, fields, submitText = translate("save"), cancelText = translate("cancel"), danger = false, size, onSubmit, onReady } = {}) {
    let saved = false;
    let dialog = null;
    const body = el("div", { class: "dialog-form" });
    if (intro) body.append(el("p", { class: "dialog-intro", text: intro }));
    setContent(body, content);
    const form = generateForm({
        parent: body,
        fields,
        submitText,
        onSubmit: async (values, f) => {
            await onSubmit?.(values, f);
            saved = true;
            dialog.close(true);
        }
    });
    onReady?.(form);
    form.element.querySelector(".form-actions").append(
        generateButton({ text: cancelText, variant: "secondary", onclick: () => dialog.close(null) }).element
    );
    if (danger) {
        form.submitButton.element.classList.remove("button-primary");
        form.submitButton.element.classList.add("button-danger");
    }
    dialog = showDialog({ title, content: body, buttons: [], size });
    const first = form.element.querySelector("input:not([disabled]):not([type=hidden]), select, textarea");
    first?.focus();
    return Object.assign(dialog.then(() => saved), { element: dialog.element, backdrop: dialog.backdrop, form, close: dialog.close });
}

/**
 * Asks for a text value. Resolves with the entered text, or null when cancelled.
 *
 * @param {string} message
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {string} [options.value] initial value
 * @param {string} [options.placeholder]
 * @param {string} [options.type="text"] input type
 * @param {(value: string) => string} [options.validate] returns an error text, or "" when valid
 */
export function promptDialog(message, { title, value = "", placeholder, type = "text", validate, okText = translate("ok"), cancelText = translate("cancel") } = {}) {
    const input = el("input", { attrs: { type, placeholder, "data-autofocus": "true" }, prop: { value } });
    const error = el("div", { class: "field-error", attrs: { role: "alert" } });
    const label = el("label", { class: "field-label", text: message });
    const submit = () => {
        const text = validate?.(input.value) ?? "";
        error.textContent = text;
        return !text;
    };
    input.addEventListener("keydown", event => {
        if (event.key === "Enter") input.closest(".dialog").querySelector(".dialog-footer button:last-child").click();
    });
    return showDialog({
        title,
        content: [label, input, error],
        buttons: [
            { text: cancelText, value: null, variant: "secondary" },
            { text: okText, value: "__ok__", autofocus: false }
        ],
        beforeClose: result => result !== "__ok__" || submit()
    }).then(result => result === "__ok__" ? input.value : null);
}
