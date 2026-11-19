//registrationFormGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import config from "../../config/config.js";
import { getRegister } from "../../config/hooks.js";
import { translate } from "../../core/i18n.js";
import { validateAll } from "../../core/validation.js";
import { generateButton, generateField, generateFormDiv, generateMessage, readControl, showMessage } from "./formUtils.js";

const FORM_ID = "registrationForm";

// Reads the form. The password is returned as typed: send it over HTTPS and hash it on the server.
export function getRegistrationFormData() {
    return {
        username: readControl(FORM_ID, "username"),
        email: readControl(FORM_ID, "email"),
        password: readControl(FORM_ID, "password")
    };
}

// Returns the first error text, or "" when the form is valid.
export function validateRegistrationForm() {
    const values = {
        username: readControl(FORM_ID, "username").trim(),
        email: readControl(FORM_ID, "email"),
        password: readControl(FORM_ID, "password"),
        password2: readControl(FORM_ID, "password2")
    };
    const errors = validateAll({
        username: { required: true },
        email: { required: true, email: true },
        password: { required: true },
        password2: { required: true, match: "password" }
    }, values);
    return Object.values(errors)[0] ?? "";
}

export function generateRegistrationForm(parent = "wrapper") {
    generateFormDiv(FORM_ID, config.registrationForm_class, parent);
    generateField(FORM_ID, "username", "username", "text");
    generateField(FORM_ID, "email", "email", "email");
    generateField(FORM_ID, "password", "password", "password");
    generateField(FORM_ID, "password2", "confirmPassword", "password");
    generateButton(FORM_ID, "register", translate("register"), submitRegistration);
    generateMessage(FORM_ID);
}

function submitRegistration() {
    const error = validateRegistrationForm();
    showMessage(FORM_ID, error);
    if (!error && config.registration_enabled) getRegister()?.(getRegistrationFormData());
}
