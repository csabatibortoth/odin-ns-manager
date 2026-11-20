//formBuilder for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { createCombobox } from "../../core/combobox.js";
import { createDateRange } from "../../core/dateRange.js";
import { asHandle, cx, el, mount, uid } from "../../core/dom.js";
import { translate } from "../../core/i18n.js";
import { validateDateRange, validateValue } from "../../core/validation.js";
import { createRichText, createWysiwyg } from "../inputGenerator/richTextGenerator.js";

const INPUT_TYPES = new Set([
    "text", "password", "email", "number", "date", "datetime-local", "time", "month", "week",
    "url", "tel", "search", "color", "range", "file", "hidden"
]);
const RULE_KEYS = ["required", "email", "minLength", "maxLength", "pattern", "min", "max", "match", "validate"];

/* ------------------BUTTON------------------- */

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
export function generateButton(options = {}) {
    const { variant = "primary", type = "button", size, onclick } = options;
    let disabled = Boolean(options.disabled);
    let loading = false;
    const label = el("span", { class: "button-text", text: options.text ?? "" });
    const element = el("button", {
        id: options.id,
        class: cx("athena-button", `button-${variant}`, size && `button-${size}`, options.class),
        attrs: { type }
    }, label);
    if (onclick) element.addEventListener("click", event => { if (!loading) onclick(event); });

    const sync = () => {
        element.disabled = disabled || loading;
        element.toggleAttribute("aria-busy", loading);
        element.classList.toggle("button-loading", loading);
        element.querySelector(".spinner")?.remove();
        if (loading) element.prepend(el("span", { class: "spinner spinner-small", attrs: { "aria-hidden": "true" } }));
    };
    sync();
    if (options.loading) {
        loading = true;
        sync();
    }
    mount(options.parent, element);
    return asHandle({
        element,
        setLoading(value) {
            loading = Boolean(value);
            sync();
        },
        setDisabled(value) {
            disabled = Boolean(value);
            sync();
        },
        setText(text) {
            label.textContent = text;
        }
    });
}

/* ------------------FIELD------------------- */

function choiceList(wrapper, kind, name, choices, value) {
    const inputs = choices.map(choice => {
        const item = typeof choice === "object" ? choice : { value: choice, text: choice };
        const input = el("input", {
            attrs: { type: kind, name, value: item.value, disabled: item.disabled },
            prop: { checked: kind === "radio" ? item.value === value : Array.isArray(value) && value.includes(item.value) }
        });
        wrapper.append(el("label", { class: "choice" }, input, el("span", { text: item.text ?? item.value })));
        return input;
    });
    return inputs;
}

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
export function generateField(options = {}) {
    const { name, type = "text", label, help, placeholder, onChange } = options;
    const rules = { ...Object.fromEntries(RULE_KEYS.filter(key => options[key] != null).map(key => [key, options[key]])), ...options.rules };
    if (type === "email") rules.email = true;
    // min / max of a date range are dates, not the numeric rules
    if (type === "daterange") {
        delete rules.min;
        delete rules.max;
    }
    const id = options.id ?? uid("field");
    const helpId = `${id}-help`;
    const errorId = `${id}-error`;
    const choiceName = uid("choice");

    const wrapper = el("div", { class: cx("field", `field-${type}`, options.class), attrs: { "data-name": name } });
    const grouped = type === "radio" || type === "checkboxes";
    const inline = type === "checkbox" || type === "switch";
    const caption = label == null ? null : el("span", { class: "field-label-text", text: label });
    if (caption && rules.required) caption.append(el("span", { class: "field-required", text: " *", attrs: { "aria-hidden": "true" } }));

    let controls;
    let controlNodes;
    let getValue;
    let setValue;
    const events = ["input", "change"];
    const container = grouped ? el("fieldset", { class: "field-group" }, el("legend", {}, caption ?? "")) : wrapper;

    if (type === "textarea") {
        const control = el("textarea", { id, attrs: { name, placeholder, rows: options.rows ?? 3 }, prop: { value: options.value ?? "" } });
        controls = [control];
        getValue = () => control.value;
        setValue = value => { control.value = value ?? ""; };
    } else if (type === "select") {
        const control = el("select", { id, attrs: { name, multiple: options.multiple } });
        if (placeholder && !options.multiple) control.append(el("option", { text: placeholder, attrs: { value: "" } }));
        for (const choice of options.options ?? []) {
            const item = typeof choice === "object" ? choice : { value: choice, text: choice };
            control.append(el("option", { text: item.text ?? item.value, attrs: { value: item.value, disabled: item.disabled } }));
        }
        controls = [control];
        getValue = () => options.multiple ? [...control.selectedOptions].map(o => o.value) : control.value;
        setValue = value => {
            const wanted = [].concat(value ?? "");
            [...control.options].forEach(o => { o.selected = wanted.includes(o.value); });
        };
        setValue(options.value);
    } else if (inline) {
        const control = el("input", { id, attrs: { type: "checkbox", name, role: type === "switch" ? "switch" : null }, prop: { checked: Boolean(options.value) } });
        controls = [control];
        getValue = () => control.checked;
        setValue = value => { control.checked = Boolean(value); };
    } else if (grouped) {
        const kind = type === "radio" ? "radio" : "checkbox";
        const list = el("div", { class: "choices" });
        controls = choiceList(list, kind, choiceName, options.options ?? [], options.value);
        container.append(list);
        getValue = () => kind === "radio"
            ? (controls.find(input => input.checked)?.value ?? "")
            : controls.filter(input => input.checked).map(input => input.value);
        setValue = value => controls.forEach(input => {
            input.checked = kind === "radio" ? input.value === value : [].concat(value ?? []).includes(input.value);
        });
    } else if (type === "autocomplete" || type === "multiselect") {
        const combo = createCombobox({
            id, name, placeholder, options: options.options, multiple: type === "multiselect",
            minChars: options.minChars, strict: options.strict, value: options.value, disabled: options.disabled
        });
        controls = [combo.input];
        controlNodes = [combo.element];
        getValue = combo.getValue;
        setValue = combo.setValue;
    } else if (type === "daterange") {
        const range = createDateRange({ id, name, value: options.value, min: options.min, max: options.max, disabled: options.disabled });
        controls = range.inputs;
        controlNodes = [range.element];
        getValue = range.getValue;
        setValue = range.setValue;
    } else if (type === "richtext" || type === "wysiwyg") {
        const rich = (type === "wysiwyg" ? createWysiwyg : createRichText)({
            id, value: options.value, placeholder, minHeight: options.minHeight, toolbar: options.toolbar, disabled: options.disabled
        });
        rich.editor.setAttribute("aria-labelledby", `${id}-label`);
        controls = [rich.editor];
        controlNodes = [rich.element];
        getValue = rich.getValue;
        setValue = rich.setValue;
    } else if (INPUT_TYPES.has(type)) {
        const control = el("input", { id, attrs: { type, name, placeholder, multiple: options.multiple, accept: options.accept, min: options.min, max: options.max, step: options.step, autocomplete: options.autocomplete } });
        if (type !== "file" && options.value != null) control.value = options.value;
        controls = [control];
        if (type === "file") {
            getValue = () => [...control.files];
            setValue = () => {};
        } else if (type === "number" || type === "range") {
            getValue = () => control.value === "" ? "" : control.valueAsNumber;
            setValue = value => { control.value = value ?? ""; };
        } else {
            getValue = () => control.value;
            setValue = value => { control.value = value ?? ""; };
        }
    } else {
        throw new Error(`Athena UI: unknown field type "${type}"`);
    }

    for (const control of controls) {
        control.disabled = Boolean(options.disabled);
        if (!grouped) control.id = control.id || id;
    }

    // Markup: label above the control, a checkbox / switch label wraps its control.
    const errorEl = el("div", { class: "field-error", id: errorId, attrs: { role: "alert" } });
    const helpEl = help ? el("div", { class: "field-help", id: helpId, text: help }) : null;
    if (inline) {
        const track = type === "switch" ? el("span", { class: "switch-track", attrs: { "aria-hidden": "true" } }) : null;
        wrapper.append(el("label", { class: cx("choice", type === "switch" && "switch"), attrs: { for: id } }, controls[0], track ?? "", caption ?? ""));
    } else if (grouped) {
        wrapper.append(container);
    } else {
        if (caption) wrapper.append(el("label", { class: "field-label", id: `${id}-label`, attrs: { for: id } }, caption));
        wrapper.append(...(controlNodes ?? controls));
    }
    if (helpEl) wrapper.append(helpEl);
    wrapper.append(errorEl);
    for (const control of controls) control.setAttribute("aria-describedby", [helpEl && helpId, errorId].filter(Boolean).join(" "));
    if (rules.required && type !== "checkbox") controls.forEach(control => control.setAttribute("aria-required", "true"));
    mount(options.parent, wrapper);

    let touched = false;
    const field = {
        element: wrapper,
        name,
        getValue,
        setValue(value) {
            setValue(value);
            field.setError("");
        },
        setError(message) {
            errorEl.textContent = message;
            wrapper.classList.toggle("field-invalid", Boolean(message));
            controls.forEach(control => control.setAttribute("aria-invalid", message ? "true" : "false"));
        },
        validate() {
            const values = options.getValues?.() ?? { [name]: getValue() };
            const value = getValue();
            // A date range counts as filled when both dates are given.
            const filled = type === "daterange" && !(value.from && value.to) ? "" : value;
            let error = validateValue(filled, rules, values);
            if (!error && type === "daterange") error = validateDateRange(value.from, value.to, { min: options.min, max: options.max });
            field.setError(error);
            return error;
        },
        focus() {
            controls[0]?.focus();
        },
        /** Changes the text of the label (the star of a required field stays). */
        setLabel(text) {
            if (!caption) return;
            text = text == null ? "" : String(text);
            if (caption.firstChild?.nodeType === Node.TEXT_NODE) caption.firstChild.nodeValue = text;
            else caption.prepend(document.createTextNode(text));     // an empty label has no text node yet
        },
        resetState() {
            touched = false;
            field.setError("");
        }
    };

    // Validate when the user leaves the field, then live on every change.
    controls.forEach(control => {
        control.addEventListener("blur", () => { touched = true; field.validate(); });
        events.forEach(event => control.addEventListener(event, () => {
            if (touched) field.validate();
            if (event === "change" || event === "input") onChange?.(getValue(), field);
        }));
    });
    return asHandle(field);
}

/* ------------------FORM------------------- */

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
 * @param {boolean} [options.nested=false] a field called "soa.host" is the key `host` of the object `soa` in the values
 *
 * Field definitions can also have these, which only generateForm reads:
 *  - `show: (values) => boolean`: the field is shown while it returns true. A field that is not shown is not validated and not in the values.
 *  - `label: (values) => string`: a label that follows the other fields (`values` are the raw values of every field)
 *  - `send: false`: the field is validated but not in the values (the second field of "type the password again")
 *  - `trim: true`: a text value is trimmed
 *  - `empty: "omit"|"null"|"empty"`: what an empty value (an empty text, a number that is not a number) becomes: left out, null, or "".
 *    Without it the value stays as it is.
 *
 * A rejection of `onSubmit` with a `details` object ({ "soa.host": "Not a name" }) puts the messages at their fields; what has no field, and the message
 * of the error when no field shows one, go to the message of the form.
 * @returns {{element: HTMLFormElement, fields: Object<string, object>, getValues: Function, getRawValues: Function, setValues: Function,
 *            setErrors: Function, validate: Function, reset: Function, setMessage: Function, arrange: Function, submitButton: object}}
 */
export function generateForm(options = {}) {
    const element = el("form", { id: options.id, class: cx("athena-form", options.class), attrs: { novalidate: true } });
    const fields = {};
    const definitions = {};
    const shown = {};                // name -> is the field shown (a field without `show` always is)
    // What every field holds, the way it is (the fields read it for `match`, and `show` and `label` get it)
    const getRawValues = () => Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.getValue()]));

    // The values of the form: only the fields that are shown and sent, trimmed and emptied as their definitions say, nested when asked
    const getValues = () => {
        const values = {};
        for (const [name, field] of Object.entries(fields)) {
            const definition = definitions[name];
            if (shown[name] === false || definition.send === false) continue;
            let value = field.getValue();
            if (typeof value === "string" && definition.trim) value = value.trim();
            if (value === "" || value === undefined || Number.isNaN(value)) {
                if (definition.empty === "omit") continue;
                if (definition.empty === "null") value = null;
                else if (definition.empty === "empty") value = "";
            }
            if (!options.nested) {
                values[name] = value;
                continue;
            }
            const keys = name.split(".");
            const last = keys.pop();
            let node = values;
            for (const key of keys) node = node[key] ??= {};
            node[last] = value;
        }
        return values;
    };

    // Shows and hides the fields that have `show`, and writes the labels that are functions
    const arrange = () => {
        const raw = getRawValues();
        for (const [name, field] of Object.entries(fields)) {
            const definition = definitions[name];
            if (definition.show) {
                shown[name] = Boolean(definition.show(raw));
                field.element.hidden = !shown[name];
            }
            if (typeof definition.label === "function") field.setLabel(definition.label(raw));
        }
    };

    for (const definition of options.fields ?? []) {
        definitions[definition.name] = definition;
        shown[definition.name] = true;
        const field = generateField({
            ...definition,
            // A label that is a function always gets its caption, even when the first answer is empty: arrange() writes the text
            label: typeof definition.label === "function" ? definition.label({}) ?? "" : definition.label,
            parent: element,
            getValues: getRawValues,
            onChange: (value, source) => {
                definition.onChange?.(value, source);
                arrange();
                options.onChange?.(getValues(), source);
            }
        });
        fields[definition.name] = field;
    }

    const message = el("div", { class: "form-message", attrs: { role: "status" } });
    element.append(message);
    const actions = el("div", { class: "form-actions" });
    element.append(actions);
    const submitButton = generateButton({ parent: actions, text: options.submitText ?? translate("ok"), type: "submit" });
    if (options.resetText) generateButton({ parent: actions, text: options.resetText, type: "reset", variant: "secondary" });

    const form = {
        element,
        fields,
        getValues,
        getRawValues,
        arrange,
        submitButton,
        // With `nested`, { soa: { host: "x" } } sets the field "soa.host" (the shape getValues() returns); { "soa.host": "x" } works as well
        setValues(values, prefix = "") {
            for (const [name, value] of Object.entries(values ?? {})) {
                const path = prefix + name;
                if (fields[path]) fields[path].setValue(value);
                else if (options.nested && value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) form.setValues(value, path + ".");
            }
            arrange();
        },
        // Shows server side errors: { username: "Already taken" }
        setErrors(errors) {
            for (const [name, text] of Object.entries(errors)) fields[name]?.setError(text);
        },
        setMessage(text, isError = true) {
            message.textContent = text;
            message.classList.toggle("form-message-error", isError && Boolean(text));
            message.classList.toggle("form-message-success", !isError && Boolean(text));
        },
        // Validates every field, focuses the first invalid one. Returns the errors by field name.
        validate() {
            const errors = {};
            for (const [name, field] of Object.entries(fields)) {
                if (shown[name] === false) continue;
                const error = field.validate();
                if (error) errors[name] = error;
            }
            fields[Object.keys(errors)[0]]?.focus();
            return errors;
        },
        reset() {
            element.reset();
            Object.values(fields).forEach(field => field.resetState());
            form.setMessage("");
        }
    };

    element.addEventListener("reset", () => queueMicrotask(() => {
        Object.values(fields).forEach(field => field.resetState());
        form.setMessage("");
        arrange();
    }));
    arrange();
    element.addEventListener("submit", async event => {
        event.preventDefault();
        form.setMessage("");
        if (Object.keys(form.validate()).length) return;
        try {
            submitButton.setLoading(true);
            await options.onSubmit?.(getValues(), form);
        } catch (error) {
            const details = error?.details && typeof error.details === "object" ? error.details : null;
            if (!details) form.setMessage(error?.message ?? String(error));
            else {
                // The messages at their fields; what has no field, and the error itself when no field shows anything, in the message of the form
                const rest = [];
                let marked = false;
                for (const [name, text] of Object.entries(details)) {
                    if (fields[name] && shown[name] !== false) {
                        fields[name].setError(String(text));
                        marked = true;
                    } else rest.push(String(text));
                }
                const text = [marked && !rest.length ? "" : error.message, ...rest].filter(Boolean).join(": ");
                form.setMessage(text || translate("form.checkFields"));
            }
        } finally {
            submitButton.setLoading(false);
        }
    });

    mount(options.parent, element);
    return asHandle(form);
}
