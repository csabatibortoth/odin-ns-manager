//formUtils for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

/* global $, CryptoJS, HTMLControlGenerator */

import { HTMLElementGenerator } from "../HTMLElementGenerator/src/HTMLElementGenerator.js";
import config from "../../config/config.js";
import { translate } from "../../core/i18n.js";

export { EMAIL_PATTERN } from "../../core/validation.js";

export function generateFormDiv(formId, className, parent = "wrapper") {
    return HTMLElementGenerator({ elementType: "div", parent, id: formId, class: className });
}

export function generateRow(formId, name) {
    const id = `${formId}-${name}`;
    HTMLElementGenerator({ elementType: "div", parent: formId, id, class: "container" });
    return id;
}

// `label` is a translation key
export function generateField(formId, name, label, inputType) {
    const row = generateRow(formId, name);
    HTMLElementGenerator({ elementType: "span", parent: row, id: `${row}-label`, class: "container", text: `${translate(label)}: ` });
    HTMLControlGenerator({ inputType, parent: row, id: `${row}-control`, class: "text-filed-class" });
}

export function generateButton(formId, name, text, onclick) {
    HTMLControlGenerator({
        inputType: "button",
        parent: generateRow(formId, name),
        text,
        value: text,
        id: `${formId}-submit-${name}`,
        class: "button-filed-class",
        onclick
    });
}

// Message line under the form, used for validation errors and status texts.
export function generateMessage(formId) {
    HTMLElementGenerator({
        elementType: "div",
        parent: generateRow(formId, "message"),
        id: `${formId}-message`,
        class: "form-message"
    });
}

export function showMessage(formId, text, isError = true) {
    $(`#${formId}-message`)
        .text(text)
        .toggleClass("form-message-error", isError)
        .toggleClass("form-message-success", !isError);
}

export function readControl(formId, name) {
    return $(`#${formId}-${name}-control`).val() ?? "";
}

export function hashPassword(password) {
    return config.enable_encrypt_password ? CryptoJS.SHA256(password).toString() : password;
}
