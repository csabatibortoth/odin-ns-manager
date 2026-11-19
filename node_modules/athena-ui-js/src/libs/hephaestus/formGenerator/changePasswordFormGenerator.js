//changePasswordFormGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import config from "../../config/config.js";
import { getChangePassword } from "../../config/hooks.js";
import { translate } from "../../core/i18n.js";
import { validateAll } from "../../core/validation.js";
import { generateButton, generateField, generateFormDiv, generateMessage, readControl, showMessage } from "./formUtils.js";

const FORM_ID = "changePasswordForm";

// Reads the form. The passwords are returned as typed: send them over HTTPS and hash them on the server.
export function getChangePasswordFormData() {
    return {
        currentPassword: readControl(FORM_ID, "current"),
        newPassword: readControl(FORM_ID, "new")
    };
}

// Returns the first error text, or "" when the form is valid. The new password has to differ from the old one.
export function validateChangePasswordForm() {
    const values = {
        current: readControl(FORM_ID, "current"),
        new: readControl(FORM_ID, "new"),
        new2: readControl(FORM_ID, "new2")
    };
    const errors = validateAll({
        current: { required: true },
        new: { required: true, validate: (value, all) => value !== all.current },
        new2: { required: true, match: "new" }
    }, values);
    return Object.values(errors)[0] ?? "";
}

export function generateChangePasswordForm(parent = "wrapper") {
    generateFormDiv(FORM_ID, config.changePasswordForm_class, parent);
    generateField(FORM_ID, "current", "currentPassword", "password");
    generateField(FORM_ID, "new", "newPassword", "password");
    generateField(FORM_ID, "new2", "confirmPassword", "password");
    generateButton(FORM_ID, "change", translate("changePassword"), submitChangePassword);
    generateMessage(FORM_ID);
}

function submitChangePassword() {
    const error = validateChangePasswordForm();
    showMessage(FORM_ID, error);
    if (!error && config.change_password_enabled) getChangePassword()?.(getChangePasswordFormData());
}
