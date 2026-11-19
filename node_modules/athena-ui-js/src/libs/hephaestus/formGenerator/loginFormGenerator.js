//loginFormGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui


import { HTMLElementGenerator } from "../../core/elementGenerator.js";
import config from "../../config/config.js";
import { getLogin } from "../../config/hooks.js";
import { translate } from "../../core/i18n.js";
import { generateControl } from "../../core/controls.js";

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
    generateControl({
        inputType,
        parent: row,
        id: `${row}-control`,
        class: "text-filed-class"
    });
}

// Reads the form. The password is returned as typed: send it over HTTPS and hash it on the server.
// `remember` is included when the login_remember_me setting shows the checkbox.
export function getLoginFormData() {
    const username = document.getElementById(`${FORM_ID}-username-control`)?.value;
    const password = document.getElementById(`${FORM_ID}-password-control`)?.value;
    const data = { username, password };
    const remember = document.getElementById(`${FORM_ID}-remember-control`);
    if (remember) data.remember = remember.checked;
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
    generateControl({ inputType: "checkbox", parent: row, id: `${row}-control` });
    HTMLElementGenerator({ elementType: "span", parent: row, id: `${row}-label`, text: translate("rememberMe") });
}

export function generateSubmitElement() {
    generateControl({
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
