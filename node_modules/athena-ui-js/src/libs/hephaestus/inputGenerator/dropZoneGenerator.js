//dropZoneGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { asHandle, cx, el, mount, setContent, uid } from "../../core/dom.js";
import { formatBytes, matchesAccept } from "../../core/format.js";
import { translate } from "../../core/i18n.js";

/**
 * Generates a drag-and-drop area. Files dropped on it (or picked with the browser dialog after a click / Enter / Space)
 * are checked against `accept`, `maxSize` and `maxFiles`; the valid ones are passed to `onDrop`, the rest to `onReject`.
 * Nothing is read or sent: what to do with the files is up to the caller (generateFileUpload builds on this).
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.id]
 * @param {string} [options.class]
 * @param {*} [options.content] text, Node, array or function; the default is the localized "Drop files here" text
 * @param {string} [options.accept] like ".png,image/*"
 * @param {boolean} [options.multiple=true]
 * @param {number} [options.maxSize] bytes per file
 * @param {number} [options.maxFiles] files accepted per drop
 * @param {boolean} [options.clickable=true] click / Enter / Space opens the file dialog
 * @param {boolean} [options.disabled=false]
 * @param {(files: File[]) => void} [options.onDrop] valid files
 * @param {(rejected: {file: File, reason: string}[]) => void} [options.onReject]
 * @param {(over: boolean) => void} [options.onDragChange] a drag entered / left the area
 * @returns {{element: HTMLElement, input: HTMLInputElement, handleFiles: (files: Iterable<File>) => void,
 *            setDisabled: (disabled: boolean) => void, open: () => void}}
 */
export function createDropZone(options = {}) {
    const { accept, multiple = true, maxSize, maxFiles, clickable = true } = options;
    const hintId = uid("dropzone-hint");
    const input = el("input", { class: "dropzone-input", attrs: { type: "file", accept, multiple, tabindex: "-1", "aria-hidden": "true" } });
    const hint = el("div", { class: "dropzone-content", id: hintId });
    setContent(hint, options.content ?? translate("dropFiles"));
    const element = el("div", {
        id: options.id,
        class: cx("dropzone", options.class),
        attrs: { role: clickable ? "button" : "group", tabindex: clickable ? "0" : null, "aria-describedby": hintId }
    }, hint, input);
    let depth = 0;
    let disabled = false;

    const setOver = over => {
        element.classList.toggle("dropzone-over", over);
        options.onDragChange?.(over);
    };
    const hasFiles = event => [...(event.dataTransfer?.types ?? [])].includes("Files");

    function handleFiles(files) {
        const valid = [];
        const rejected = [];
        let list = [...files];
        if (!multiple) list = list.slice(0, 1);
        for (const file of list) {
            if (!matchesAccept(file, accept)) rejected.push({ file, reason: `${translate("validation.pattern")} (${file.name})` });
            else if (maxSize != null && file.size > maxSize) rejected.push({ file, reason: translate("validation.fileSize", { name: file.name, max: formatBytes(maxSize) }) });
            else if (maxFiles != null && valid.length >= maxFiles) rejected.push({ file, reason: translate("validation.maxFiles", { max: maxFiles, count: maxFiles }) });
            else valid.push(file);
        }
        if (valid.length) options.onDrop?.(valid);
        if (rejected.length) options.onReject?.(rejected);
    }
    const open = () => { if (!disabled) input.click(); };
    function setDisabled(value) {
        disabled = Boolean(value);
        element.classList.toggle("dropzone-disabled", disabled);
        element.setAttribute("aria-disabled", String(disabled));
        if (clickable) element.tabIndex = disabled ? -1 : 0;
    }

    if (clickable) {
        element.addEventListener("click", open);
        element.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                open();
            }
        });
    }
    input.addEventListener("change", () => {
        handleFiles(input.files);
        input.value = "";
    });
    // The enter / leave pair fires for every child element, so the nesting depth is counted to avoid flicker.
    element.addEventListener("dragenter", event => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        if (++depth === 1) setOver(true);
    });
    element.addEventListener("dragover", event => {
        if (disabled || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    });
    element.addEventListener("dragleave", () => {
        if (depth > 0 && --depth === 0) setOver(false);
    });
    element.addEventListener("drop", event => {
        event.preventDefault();
        const wasOver = depth > 0;
        depth = 0;
        if (wasOver) setOver(false);
        if (!disabled && hasFiles(event)) handleFiles(event.dataTransfer.files);
    });

    setDisabled(options.disabled);
    return { element, input, handleFiles, setDisabled, open };
}

/** Generates a drag-and-drop area into `parent`, see createDropZone. */
export function generateDropZone(options = {}) {
    const zone = createDropZone(options);
    mount(options.parent, zone.element);
    return asHandle(zone);
}
