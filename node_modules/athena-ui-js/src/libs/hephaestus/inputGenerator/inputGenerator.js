//inputGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { createCombobox } from "../../core/combobox.js";
import { createDateRange } from "../../core/dateRange.js";
import { cx, el, mount, setContent, uid } from "../../core/dom.js";
import { formatBytes, matchesAccept } from "../../core/format.js";
import { translate } from "../../core/i18n.js";
import { generateButton } from "../formGenerator/formBuilder.js";
import { generateProgress } from "../feedbackGenerator/feedbackGenerator.js";

/* ------------------COMBOBOX (autocomplete, multi select)------------------- */

/**
 * Generates an input with suggestions. `options` is an array of strings / { value, text }, or a function
 * (query) => options | Promise<options> for remote data.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.label]
 * @param {Array|Function} options.options
 * @param {number} [options.minChars=1] characters needed before suggestions show
 * @param {boolean} [options.strict=false] only a value chosen from the list is accepted
 * @param {(item: {value, text}) => void} [options.onSelect]
 * @param {(value) => void} [options.onChange]
 * @returns {{element: HTMLElement, input: HTMLInputElement, getValue: Function, setValue: Function}}
 */
export function generateAutocomplete(options = {}) {
    return wrapCombobox(options, { multiple: false });
}

/**
 * Generates a multiple selection with chips. Same options as generateAutocomplete; getValue returns an array.
 */
export function generateMultiSelect(options = {}) {
    return wrapCombobox(options, { multiple: true });
}

function wrapCombobox(options, mode) {
    const id = options.id ?? uid("combo");
    const combo = createCombobox({ ...options, ...mode, id });
    const wrapper = el("div", { class: "field" });
    if (options.label) wrapper.append(el("label", { class: "field-label", text: options.label, attrs: { for: id } }));
    wrapper.append(combo.element);
    mount(options.parent, wrapper);
    return combo;
}

/* ------------------DATE RANGE------------------- */

/**
 * Generates a from / to date picker (the native pickers of the browser). The end date cannot be picked before
 * the start date, and validate() reports a reversed range typed by hand.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.label]
 * @param {string} [options.from] initial start, "2026-01-31"
 * @param {string} [options.to] initial end
 * @param {string} [options.min] earliest date
 * @param {string} [options.max] latest date
 * @param {(value: {from: string, to: string}) => void} [options.onChange]
 * @returns {{element: HTMLElement, getValue: () => {from: string, to: string}, setValue: Function, validate: () => string}}
 */
export function generateDateRange(options = {}) {
    const range = createDateRange(options);
    const wrapper = el("div", { class: "field" });
    const error = el("div", { class: "field-error", attrs: { role: "alert" } });
    if (options.label) wrapper.append(el("span", { class: "field-label", text: options.label }));
    wrapper.append(range.element, error);
    range.element.addEventListener("change", () => { error.textContent = range.validate(); });
    mount(options.parent, wrapper);
    return range;
}

/* ------------------FILE UPLOAD------------------- */

/**
 * Generates a drop zone with a file list and upload progress.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.accept] ".png,image/*"
 * @param {boolean} [options.multiple=true]
 * @param {number} [options.maxSize] bytes per file
 * @param {string} [options.url] upload endpoint (multipart POST). Without it the files are only collected.
 * @param {string} [options.fieldName="file"] name of the form field the file is sent as
 * @param {Object<string,string>} [options.headers]
 * @param {boolean} [options.autoUpload=true] upload as soon as files are added
 * @param {(files: File[]) => void} [options.onSelect]
 * @param {(file: File, percent: number) => void} [options.onProgress]
 * @param {(file: File, response: string) => void} [options.onComplete]
 * @param {(file: File, error: Error) => void} [options.onError]
 * @returns {{element: HTMLElement, getFiles: () => File[], upload: () => Promise<void>, clear: Function}}
 */
export function generateFileUpload(options = {}) {
    const { accept, multiple = true, maxSize, url, fieldName = "file", autoUpload = true } = options;
    const entries = [];
    const input = el("input", { class: "dropzone-input", attrs: { type: "file", accept, multiple, tabindex: "-1", "aria-hidden": "true" } });
    const zone = el("div", { class: "dropzone", attrs: { role: "button", tabindex: "0" } }, el("span", { text: translate("dropFiles") }));
    const list = el("ul", { class: "file-list" });
    const errors = el("div", { class: "field-error", attrs: { role: "alert" } });
    const element = el("div", { id: options.id, class: cx("file-upload", options.class) }, zone, input, errors, list);

    function render(entry) {
        entry.node ??= el("li", { class: "file-item" });
        entry.node.replaceChildren(
            el("span", { class: "file-name", text: `${entry.file.name} (${formatBytes(entry.file.size)})` }),
            entry.progress.element,
            el("span", { class: cx("file-status", entry.error && "field-error"), text: entry.error ?? "" }),
            el("button", {
                class: "chip-remove",
                text: "×",
                attrs: { type: "button", "aria-label": `${translate("close")} ${entry.file.name}` },
                on: { click: () => remove(entry) }
            })
        );
        return entry.node;
    }
    function remove(entry) {
        entry.xhr?.abort();
        entries.splice(entries.indexOf(entry), 1);
        entry.node.remove();
    }
    function send(entry) {
        return new Promise(resolve => {
            const xhr = new XMLHttpRequest();
            entry.xhr = xhr;
            entry.error = null;
            xhr.open("POST", url);
            for (const [name, value] of Object.entries(options.headers ?? {})) xhr.setRequestHeader(name, value);
            xhr.upload.onprogress = event => {
                if (!event.lengthComputable) return;
                const percent = Math.round((event.loaded / event.total) * 100);
                entry.progress.setValue(percent);
                options.onProgress?.(entry.file, percent);
            };
            const fail = message => {
                entry.error = message;
                entry.progress.element.classList.add("progress-error");
                render(entry);
                options.onError?.(entry.file, new Error(message));
                resolve();
            };
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    entry.done = true;
                    entry.progress.setValue(100);
                    options.onComplete?.(entry.file, xhr.responseText);
                    resolve();
                } else {
                    fail(`${xhr.status} ${xhr.statusText}`);
                }
            };
            xhr.onerror = () => fail("Network error");
            const body = new FormData();
            body.append(fieldName, entry.file);
            xhr.send(body);
        });
    }
    async function upload() {
        if (!url) return;
        await Promise.all(entries.filter(entry => !entry.done && !entry.xhr?.readyState).map(send));
    }
    function add(files) {
        const problems = [];
        let accepted = [...files];
        if (!multiple) {
            entries.slice().forEach(remove);
            accepted = accepted.slice(0, 1);
        }
        const added = [];
        for (const file of accepted) {
            if (!matchesAccept(file, accept)) {
                problems.push(translate("validation.pattern") + ` (${file.name})`);
            } else if (maxSize != null && file.size > maxSize) {
                problems.push(translate("validation.fileSize", { name: file.name, max: formatBytes(maxSize) }));
            } else {
                const entry = { file, progress: generateProgress({ value: 0, class: "file-progress" }) };
                entries.push(entry);
                list.append(render(entry));
                added.push(entry);
            }
        }
        errors.textContent = problems.join(" ");
        if (added.length) {
            options.onSelect?.(added.map(entry => entry.file));
            if (autoUpload) upload();
        }
    }

    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            input.click();
        }
    });
    input.addEventListener("change", () => {
        add(input.files);
        input.value = "";
    });
    zone.addEventListener("dragover", event => { event.preventDefault(); zone.classList.add("dropzone-over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dropzone-over"));
    zone.addEventListener("drop", event => {
        event.preventDefault();
        zone.classList.remove("dropzone-over");
        add(event.dataTransfer.files);
    });

    mount(options.parent, element);
    return {
        element,
        getFiles: () => entries.map(entry => entry.file),
        upload,
        clear: () => entries.slice().forEach(remove),
        add
    };
}

/* ------------------STEPPER (wizard)------------------- */

/**
 * Generates a multi step form (wizard).
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {{id?: string, title: string, content: *, validate?: () => (boolean|string|Promise<boolean|string>)}[]} options.steps
 *        content is text, a Node, an array, or a function called once when the step is first shown.
 *        `validate` runs before leaving the step forwards: false or an error text blocks it.
 * @param {() => void} [options.onFinish] called when Finish is pressed on the last step
 * @param {(index: number) => void} [options.onChange]
 * @returns {{element: HTMLElement, next: Function, back: Function, goTo: Function, getCurrent: Function}}
 */
export function generateStepper(options = {}) {
    const steps = options.steps ?? [];
    let current = 0;
    const header = el("ol", { class: "stepper-steps" });
    const panels = steps.map((step, index) => {
        header.append(el("li", { class: "stepper-step", attrs: { "data-step": index } },
            el("span", { class: "stepper-number", text: String(index + 1) }), el("span", { class: "stepper-title", text: step.title })));
        return el("div", { class: "stepper-panel", attrs: { hidden: true } });
    });
    const rendered = new Set();
    const error = el("div", { class: "field-error", attrs: { role: "alert" } });
    const nav = el("div", { class: "form-actions" });
    const element = el("div", { id: options.id, class: cx("stepper", options.class) }, header, ...panels, error, nav);
    const backButton = generateButton({ parent: nav, text: translate("back"), variant: "secondary", onclick: () => back() });
    const nextButton = generateButton({ parent: nav, text: translate("next"), onclick: () => next() });

    function show(index) {
        current = index;
        panels.forEach((panel, i) => { panel.hidden = i !== index; });
        [...header.children].forEach((li, i) => {
            li.classList.toggle("stepper-done", i < index);
            li.classList.toggle("stepper-current", i === index);
            if (i === index) li.setAttribute("aria-current", "step");
            else li.removeAttribute("aria-current");
        });
        if (!rendered.has(index)) {
            rendered.add(index);
            setContent(panels[index], steps[index].content);
        }
        error.textContent = "";
        backButton.setDisabled(index === 0);
        nextButton.setText(index === steps.length - 1 ? translate("finish") : translate("next"));
        options.onChange?.(index);
    }
    async function next() {
        nextButton.setLoading(true);
        try {
            const result = await steps[current].validate?.();
            if (result === false || typeof result === "string") {
                error.textContent = typeof result === "string" ? result : translate("validation.invalid");
                return;
            }
            if (current === steps.length - 1) options.onFinish?.();
            else show(current + 1);
        } finally {
            nextButton.setLoading(false);
        }
    }
    function back() {
        if (current > 0) show(current - 1);
    }

    mount(options.parent, element);
    if (steps.length) show(0);
    return {
        element,
        next,
        back,
        // Going back is always possible, going forward only one step at a time through next().
        goTo: index => { if (index >= 0 && index < current) show(index); },
        getCurrent: () => current
    };
}
