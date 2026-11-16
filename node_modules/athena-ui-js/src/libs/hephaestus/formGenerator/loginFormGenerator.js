//loginFormGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

/* global $, CryptoJS, HTMLControlGenerator */

import { HTMLElementGenerator } from "../HTMLElementGenerator/src/HTMLElementGenerator.js";
import config from "../../config/config.js";
import { getLogin } from "../../config/hooks.js";
import { translate } from "../../core/i18n.js";

const FORM_ID = "loginForm";

function generateRow(name) {
    const id = `${FORM_ID}-${name}`;
    HTMLElementGenerator({
        elementType: "div",
        parent: FORM_ID,
        id,
        class: "container"
    });
    return id;
}

// `label` is a translation key
function generateField(name, label, inputType) {
    const row = generateRow(name);
    HTMLElementGenerator({
        elementType: "span",
        parent: row,
        id: `${row}-label`,
        class: "container",
        text: `${translate(label)}: `
    });
    HTMLControlGenerator({
        inputType,
        parent: row,
        id: `${row}-control`,
        class: "text-filed-class"
    });
}

// Reads the form. The password is SHA-256 hashed when enable_encrypt_password is set.
// `remember` is included when the login_remember_me setting shows the checkbox.
export function getLoginFormData() {
    const username = $(`#${FORM_ID}-username-control`).val();
    let password = $(`#${FORM_ID}-password-control`).val();
    if (config.enable_encrypt_password) password = CryptoJS.SHA256(password).toString();
    const data = { username, password };
    const remember = $(`#${FORM_ID}-remember-control`);
    if (remember.length) data.remember = remember.prop("checked");
    return data;
}

export function generateLoginForm() {
    generateFormDiv();
    generateFormElements();
}

export function generateFormDiv() {
    HTMLElementGenerator({
        elementType: "div",
        parent: "wrapper",
        id: FORM_ID,
        class: config.loginForm_class
    });
}

export function generateFormElements() {
    generateUsernameElements();
    generatePasswordElements();
    generateRememberElement();
    generateSubmitElement();
}

export function generateUsernameElements() {
    generateField("username", "username", "text");
}

export function generatePasswordElements() {
    generateField("password", "password", "password");
}

export function generateRememberElement() {
    if (!config.login_remember_me) return;
    const row = generateRow("remember");
    HTMLControlGenerator({ inputType: "checkbox", parent: row, id: `${row}-control` });
    HTMLElementGenerator({ elementType: "span", parent: row, id: `${row}-label`, text: translate("rememberMe") });
}

export function generateSubmitElement() {
    HTMLControlGenerator({
        inputType: "button",
        parent: generateRow("submit"),
        text: translate("login"),
        value: translate("login"),
        id: `${FORM_ID}-submit-login`,
        class: "button-filed-class",
        onclick: () => {
            if (config.login_enabled) getLogin()?.(getLoginFormData());
        }
    });
}
