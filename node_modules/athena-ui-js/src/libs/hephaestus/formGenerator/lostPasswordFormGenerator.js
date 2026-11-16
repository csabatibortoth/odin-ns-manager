//lostPasswordFormGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import config from "../../config/config.js";
import { getLostPassword } from "../../config/hooks.js";
import { translate } from "../../core/i18n.js";
import { validateValue } from "../../core/validation.js";
import { generateButton, generateField, generateFormDiv, generateMessage, readControl, showMessage } from "./formUtils.js";

const FORM_ID = "lostPasswordForm";

export function getLostPasswordFormData() {
    return { email: readControl(FORM_ID, "email").trim() };
}

export function generateLostPasswordForm(parent = "wrapper") {
    generateFormDiv(FORM_ID, config.lostPasswordForm_class, parent);
    generateField(FORM_ID, "email", "email", "email");
    generateButton(FORM_ID, "reset", translate("resetPassword"), submitLostPassword);
    generateMessage(FORM_ID);
}

function submitLostPassword() {
    const { email } = getLostPasswordFormData();
    const error = validateValue(email, { required: true, email: true });
    showMessage(FORM_ID, error);
    if (!error && config.lost_password_enabled) getLostPassword()?.({ email });
}
