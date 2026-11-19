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
export function generateSignInForm(options?: {
    parent?: string | Element;
    onSubmit: (values: {
        username: string;
        password: string;
        remember?: boolean;
    }, form: object) => (void | Promise<any>);
    remember?: boolean;
    identifier?: "username" | "email";
    submitText?: string;
}): {
    element: HTMLFormElement;
    fields: {
        [x: string]: any;
    };
    getValues: Function;
    getRawValues: Function;
    setValues: Function;
    setErrors: Function;
    validate: Function;
    reset: Function;
    setMessage: Function;
    arrange: Function;
    submitButton: object;
};
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
export function generateSignUpForm(options?: {
    parent?: string | Element;
    onSubmit: (values: {
        username: string;
        email: string;
        password: string;
    }, form: object) => (void | Promise<any>);
    passwordMinLength?: number;
    username?: boolean;
    submitText?: string;
}): {
    element: HTMLFormElement;
    fields: {
        [x: string]: any;
    };
    getValues: Function;
    getRawValues: Function;
    setValues: Function;
    setErrors: Function;
    validate: Function;
    reset: Function;
    setMessage: Function;
    arrange: Function;
    submitButton: object;
};
/**
 * Asks for the email address to send a reset link to.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {(values: {email: string}, form: object) => (void|Promise)} options.onSubmit
 */
export function generatePasswordResetForm(options?: {
    parent?: string | Element;
    onSubmit: (values: {
        email: string;
    }, form: object) => (void | Promise<any>);
}): {
    element: HTMLFormElement;
    fields: {
        [x: string]: any;
    };
    getValues: Function;
    getRawValues: Function;
    setValues: Function;
    setErrors: Function;
    validate: Function;
    reset: Function;
    setMessage: Function;
    arrange: Function;
    submitButton: object;
};
/**
 * Change of the password of the person who is signed in: the current one, the new one and its confirmation.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {(values: {currentPassword: string, newPassword: string}, form: object) => (void|Promise)} options.onSubmit
 * @param {number} [options.passwordMinLength=8]
 * @param {string} [options.username] when given, a hidden username field helps the password manager to update the right entry
 */
export function generatePasswordChangeForm(options?: {
    parent?: string | Element;
    onSubmit: (values: {
        currentPassword: string;
        newPassword: string;
    }, form: object) => (void | Promise<any>);
    passwordMinLength?: number;
    username?: string;
}): {
    element: HTMLFormElement;
    fields: {
        [x: string]: any;
    };
    getValues: Function;
    getRawValues: Function;
    setValues: Function;
    setErrors: Function;
    validate: Function;
    reset: Function;
    setMessage: Function;
    arrange: Function;
    submitButton: object;
};
