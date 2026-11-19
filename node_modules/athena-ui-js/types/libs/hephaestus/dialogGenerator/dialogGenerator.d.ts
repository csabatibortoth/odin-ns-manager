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
export function showDialog(options?: {
    title?: string;
    content?: string | Node | any[];
    buttons?: {
        text: string;
        value?: any;
        variant?: string;
        autofocus?: boolean;
    }[];
    dismissible?: boolean;
    beforeClose?: (value: any) => (boolean | Promise<boolean>);
    size?: "small" | "medium" | "large" | "full";
    class?: string;
}): Promise<any> & {
    element: HTMLDialogElement;
    backdrop: HTMLDialogElement;
    close: (value?: any) => Promise<void>;
};
/** Message with an OK button. Resolves when it is closed. */
export function alertDialog(message: any, { title, okText }?: {
    okText?: any;
}): Promise<void>;
/** Question with confirm and cancel buttons. Resolves with true / false. See showConfirm for `typeToConfirm`. */
export function confirmDialog(message: any, options?: {}): Promise<boolean> & {
    element: HTMLElement;
    close: Function;
};
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
export function showConfirm({ title, message, confirmText, cancelText, danger, typeToConfirm, size }?: {
    title?: string;
    message: string | Node | any[];
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
    typeToConfirm?: string;
    size?: "small" | "medium" | "large" | "full";
}): Promise<boolean> & {
    element: HTMLElement;
    close: Function;
};
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
 * @param {boolean} [options.nested=false] a field called "soa.host" is `values.soa.host` (see generateForm, which also explains `show`, `label`, `send`, `trim` and `empty` of a field)
 * @param {(values: object, form: object) => (void|Promise)} options.onSubmit
 * @param {(form: object) => void} [options.onReady] called with the form once it is built
 * @returns {Promise<boolean> & {element: HTMLElement, form: object, close: Function}} resolves with true when it was saved, false when dismissed
 */
export function showFormDialog({ title, intro, content, fields, submitText, cancelText, danger, size, nested, onSubmit, onReady }?: {
    title?: string;
    intro?: string;
    content?: string | Node | any[];
    fields: object[];
    submitText?: string;
    cancelText?: string;
    danger?: boolean;
    size?: "small" | "medium" | "large" | "full";
    nested?: boolean;
    onSubmit: (values: object, form: object) => (void | Promise<any>);
    onReady?: (form: object) => void;
}): Promise<boolean> & {
    element: HTMLElement;
    form: object;
    close: Function;
};
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
export function promptDialog(message: string, { title, value, placeholder, type, validate, okText, cancelText }?: {
    title?: string;
    value?: string;
    placeholder?: string;
    type?: string;
    validate?: (value: string) => string;
}): Promise<any>;
