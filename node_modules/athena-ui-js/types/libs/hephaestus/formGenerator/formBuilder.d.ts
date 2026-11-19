/**
 * Generates a button.
 *
 * @param {object} options
 * @param {string|Element} [options.parent] id or element, defaults to the body
 * @param {string} [options.id]
 * @param {string} [options.text]
 * @param {"primary"|"secondary"|"danger"|"link"} [options.variant="primary"]
 * @param {"button"|"submit"|"reset"} [options.type="button"]
 * @param {"small"|"large"} [options.size]
 * @param {boolean} [options.disabled]
 * @param {boolean} [options.loading] shows a spinner and blocks clicks
 * @param {(event: Event) => void} [options.onclick]
 * @returns {{element: HTMLButtonElement, setLoading: Function, setDisabled: Function, setText: Function}}
 */
export function generateButton(options?: {
    parent?: string | Element;
    id?: string;
    text?: string;
    variant?: "primary" | "secondary" | "danger" | "link";
    type?: "button" | "submit" | "reset";
    size?: "small" | "large";
    disabled?: boolean;
    loading?: boolean;
    onclick?: (event: Event) => void;
}): {
    element: HTMLButtonElement;
    setLoading: Function;
    setDisabled: Function;
    setText: Function;
};
/**
 * Generates one labelled form field with help text and an error line.
 *
 * @param {object} options
 * @param {string} options.name key of the field in the form values
 * @param {"text"|"password"|"email"|"number"|"date"|"datetime-local"|"time"|"url"|"tel"|"search"|"color"|"range"|"file"|"hidden"|"textarea"|"select"|"checkbox"|"switch"|"radio"|"checkboxes"|"autocomplete"|"multiselect"|"daterange"|"richtext"|"wysiwyg"} [options.type="text"]
 * @param {string} [options.label]
 * @param {string} [options.help] help text under the control
 * @param {*} [options.value] initial value (boolean for checkbox / switch, array for checkboxes / multiple select)
 * @param {(string|{value: string, text?: string, disabled?: boolean})[]} [options.options] choices of select / radio / checkboxes
 * @param {boolean} [options.multiple] select / file: allow several values
 * @param {string} [options.placeholder]
 * @param {number} [options.rows] textarea rows
 * @param {object} [options.rules] validation rules, see validateValue. They can also be given directly
 *        (required, email, minLength, ...)
 * @param {(value, field) => void} [options.onChange]
 * @param {() => object} [options.getValues] all form values (set by generateForm, used by `match`)
 * @returns {{element: HTMLElement, name: string, getValue: Function, setValue: Function, validate: Function,
 *            setError: Function, focus: Function}}
 */
export function generateField(options?: {
    name: string;
    type?: "text" | "password" | "email" | "number" | "date" | "datetime-local" | "time" | "url" | "tel" | "search" | "color" | "range" | "file" | "hidden" | "textarea" | "select" | "checkbox" | "switch" | "radio" | "checkboxes" | "autocomplete" | "multiselect" | "daterange" | "richtext" | "wysiwyg";
    label?: string;
    help?: string;
    value?: any;
    options?: (string | {
        value: string;
        text?: string;
        disabled?: boolean;
    })[];
    multiple?: boolean;
    placeholder?: string;
    rows?: number;
    rules?: object;
    onChange?: (value: any, field: any) => void;
    getValues?: () => object;
}): {
    element: HTMLElement;
    name: string;
    getValue: Function;
    setValue: Function;
    validate: Function;
    setError: Function;
    focus: Function;
};
/**
 * Generates a form from a list of field definitions.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.id]
 * @param {object[]} options.fields field definitions, see generateField
 * @param {string} [options.submitText]
 * @param {string|false} [options.resetText] adds a reset button when set
 * @param {(values: object, form: object) => (void|Promise)} [options.onSubmit] called with the values when every
 *        field is valid. A returned promise keeps the submit button busy; a rejection is shown as form message.
 * @param {(values: object, field: object) => void} [options.onChange]
 * @returns {{element: HTMLFormElement, fields: Object<string, object>, getValues: Function, setValues: Function,
 *            setErrors: Function, validate: Function, reset: Function, setMessage: Function, submitButton: object}}
 */
export function generateForm(options?: {
    parent?: string | Element;
    id?: string;
    fields: object[];
    submitText?: string;
    resetText?: string | false;
    onSubmit?: (values: object, form: object) => (void | Promise<any>);
    onChange?: (values: object, field: object) => void;
}): {
    element: HTMLFormElement;
    fields: {
        [x: string]: object;
    };
    getValues: Function;
    setValues: Function;
    setErrors: Function;
    validate: Function;
    reset: Function;
    setMessage: Function;
    submitButton: object;
};
