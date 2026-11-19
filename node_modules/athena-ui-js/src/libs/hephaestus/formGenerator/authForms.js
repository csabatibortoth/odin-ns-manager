//authForms for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { translate } from "../../core/i18n.js";
import { generateForm } from "./formBuilder.js";

// Real <form> elements with the autocomplete tokens that password managers look for (username, current-password, new-password,
// email), so saving and filling passwords works and Enter submits. The password is sent as it is: hashing it in the browser
// only turns the hash into the password. Use HTTPS, and let the server hash it (argon2, scrypt, bcrypt).
//
// onSubmit is asynchronous. When it throws (or rejects) the message is shown in the form and the person can try again; an error
// that carries `fields` ({ username: "Already taken" }) marks those fields as well.

function build(options, { fields, submitText }) {
    return generateForm({
        parent: options.parent,
        id: options.id,
        class: options.class,
        fields,
        submitText: options.submitText ?? submitText,
        onSubmit: async (values, form) => {
            try {
                await options.onSubmit?.(values, form);
            } catch (error) {
                if (error?.fields) form.setErrors(error.fields);
                throw error;
            }
        }
    });
}

/**
 * A sign in form: username (or email), password, and optionally "Remember me".
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {(values: {username: string, password: string, remember?: boolean}, form: object) => (void|Promise)} options.onSubmit
 * @param {boolean} [options.remember=false] shows "Remember me"
 * @param {"username"|"email"} [options.identifier="username"] what the first field asks for
 * @param {string} [options.submitText]
 */
export function generateSignInForm(options = {}) {
    const email = options.identifier === "email";
    const fields = [
        { name: "username", label: translate(email ? "email" : "username"), type: email ? "email" : "text", autocomplete: "username", required: true },
        { name: "password", label: translate("password"), type: "password", autocomplete: "current-password", required: true }
    ];
    if (options.remember) fields.push({ name: "remember", label: translate("rememberMe"), type: "checkbox" });
    return build(options, { fields, submitText: translate("login") });
}

/**
 * A registration form: username, email, password and its confirmation.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {(values: {username: string, email: string, password: string}, form: object) => (void|Promise)} options.onSubmit
 *        the confirmation is checked here and not sent
 * @param {number} [options.passwordMinLength=8]
 * @param {boolean} [options.username=true] false leaves the username out (sign in with the email)
 * @param {string} [options.submitText]
 */
export function generateSignUpForm(options = {}) {
    const fields = [];
    if (options.username !== false) fields.push({ name: "username", label: translate("username"), autocomplete: "username", required: true });
    fields.push(
        { name: "email", label: translate("email"), type: "email", autocomplete: "email", required: true },
        { name: "password", label: translate("password"), type: "password", autocomplete: "new-password", required: true, minLength: options.passwordMinLength ?? 8 },
        { name: "confirmPassword", label: translate("confirmPassword"), type: "password", autocomplete: "new-password", required: true, match: "password" }
    );
    return build({
        ...options,
        onSubmit: (values, form) => {
            const { confirmPassword, ...rest } = values;
            void confirmPassword;
            return options.onSubmit?.(rest, form);
        }
    }, { fields, submitText: translate("register") });
}

/**
 * Asks for the email address to send a reset link to.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {(values: {email: string}, form: object) => (void|Promise)} options.onSubmit
 */
export function generatePasswordResetForm(options = {}) {
    return build(options, {
        fields: [{ name: "email", label: translate("email"), type: "email", autocomplete: "email", required: true }],
        submitText: translate("resetPassword")
    });
}

/**
 * Change of the password of the person who is signed in: the current one, the new one and its confirmation.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {(values: {currentPassword: string, newPassword: string}, form: object) => (void|Promise)} options.onSubmit
 * @param {number} [options.passwordMinLength=8]
 * @param {string} [options.username] when given, a hidden username field helps the password manager to update the right entry
 */
export function generatePasswordChangeForm(options = {}) {
    const fields = [
        { name: "currentPassword", label: translate("currentPassword"), type: "password", autocomplete: "current-password", required: true },
        { name: "newPassword", label: translate("newPassword"), type: "password", autocomplete: "new-password", required: true, minLength: options.passwordMinLength ?? 8 },
        { name: "confirmPassword", label: translate("confirmPassword"), type: "password", autocomplete: "new-password", required: true, match: "newPassword" }
    ];
    const form = build({
        ...options,
        onSubmit: (values, f) => {
            const { confirmPassword, ...rest } = values;
            void confirmPassword;
            return options.onSubmit?.(rest, f);
        }
    }, { fields, submitText: translate("changePassword") });
    if (options.username) {
        const hidden = document.createElement("input");
        hidden.type = "text";
        hidden.name = "username";
        hidden.value = options.username;
        hidden.autocomplete = "username";
        hidden.hidden = true;
        form.element.prepend(hidden);
    }
    return form;
}
