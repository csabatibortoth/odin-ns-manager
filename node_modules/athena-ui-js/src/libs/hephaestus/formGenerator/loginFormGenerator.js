//loginFormGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

/* global $, CryptoJS, HTMLControlGenerator */

import { HTMLElementGenerator } from "../HTMLElementGenerator/src/HTMLElementGenerator.js";
import config from "../../config/config.js";
import { getLogin } from "../../config/hooks.js";

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

function generateField(name, label, inputType) {
    const row = generateRow(name);
    HTMLElementGenerator({
        elementType: "span",
        parent: row,
        id: `${row}-label`,
        class: "container",
        text: label
    });
    HTMLControlGenerator({
        inputType,
        parent: row,
        id: `${row}-control`,
        class: "text-filed-class"
    });
}

// Reads the form. The password is SHA-256 hashed when enable_encrypt_password is set.
export function getLoginFormData() {
    const username = $(`#${FORM_ID}-username-control`).val();
    let password = $(`#${FORM_ID}-password-control`).val();
    if (config.enable_encrypt_password) password = CryptoJS.SHA256(password).toString();
    return { username, password };
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
    generateSubmitElement();
}

export function generateUsernameElements() {
    generateField("username", "Username: ", "text");
}

export function generatePasswordElements() {
    generateField("password", "Password: ", "password");
}

export function generateSubmitElement() {
    HTMLControlGenerator({
        inputType: "button",
        parent: generateRow("submit"),
        text: "Login",
        value: "Login",
        id: `${FORM_ID}-submit-login`,
        class: "button-filed-class",
        onclick: () => {
            if (config.login_enabled) getLogin()?.(getLoginFormData());
        }
    });
}
