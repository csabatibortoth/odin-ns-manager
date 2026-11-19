//richTextGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { asHandle, cx, el, mount, uid } from "../../core/dom.js";
import { translate } from "../../core/i18n.js";
import { htmlToText, isSafeUrl, sanitizeHtml } from "../../core/sanitize.js";

// Toolbar buttons. `run` executes the command, `active` tells whether the caret is inside such formatting.
const exec = (command, value) => document.execCommand(command, false, value);
const blockIs = tag => {
    let node = window.getSelection()?.anchorNode;
    node = node?.nodeType === 3 ? node.parentElement : node;
    return Boolean(node?.closest(tag));
};
const toggleBlock = tag => exec("formatBlock", blockIs(tag) ? "p" : tag);

const BUTTONS = {
    bold: { label: "rt.bold", text: "B", run: () => exec("bold"), active: () => document.queryCommandState("bold"), class: "rt-bold" },
    italic: { label: "rt.italic", text: "I", run: () => exec("italic"), active: () => document.queryCommandState("italic"), class: "rt-italic" },
    underline: { label: "rt.underline", text: "U", run: () => exec("underline"), active: () => document.queryCommandState("underline"), class: "rt-underline" },
    strike: { label: "rt.strike", text: "S", run: () => exec("strikeThrough"), active: () => document.queryCommandState("strikeThrough"), class: "rt-strike" },
    h2: { label: "rt.heading2", text: "H2", run: () => toggleBlock("h2"), active: () => blockIs("h2") },
    h3: { label: "rt.heading3", text: "H3", run: () => toggleBlock("h3"), active: () => blockIs("h3") },
    quote: { label: "rt.quote", text: "❝", run: () => toggleBlock("blockquote"), active: () => blockIs("blockquote") },
    ul: { label: "rt.bulletList", text: "•", run: () => exec("insertUnorderedList"), active: () => document.queryCommandState("insertUnorderedList") },
    ol: { label: "rt.numberList", text: "1.", run: () => exec("insertOrderedList"), active: () => document.queryCommandState("insertOrderedList") },
    link: { label: "rt.link", text: "🔗", run: "link", active: () => blockIs("a") },
    unlink: { label: "rt.unlink", text: "⛓", run: () => exec("unlink") },
    clear: { label: "rt.clear", text: "⌫", run: () => { exec("removeFormat"); exec("formatBlock", "p"); } },
    undo: { label: "rt.undo", text: "↶", run: () => exec("undo") },
    redo: { label: "rt.redo", text: "↷", run: () => exec("redo") },
    source: { label: "rt.source", text: "</>", run: "source", active: () => false, class: "rt-source" }
};
const DEFAULT_TOOLBAR = ["bold", "italic", "underline", "strike", "|", "h2", "h3", "quote", "|", "ul", "ol", "|", "link", "unlink", "|", "clear", "undo", "redo"];
const WYSIWYG_TOOLBAR = [...DEFAULT_TOOLBAR, "|", "source"];

/**
 * Generates a rich text editor. The content is HTML restricted to a safe set of tags (paragraphs, headings,
 * bold / italic / underline / strike, lists, quotes, code, links); everything else, including scripts, styles,
 * event attributes and `javascript:` links, is removed when the content is set, pasted and read.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.id]
 * @param {string} [options.label]
 * @param {string} [options.value] initial HTML
 * @param {string} [options.placeholder]
 * @param {string[]} [options.toolbar] button names (bold, italic, underline, strike, h2, h3, quote, ul, ol, link,
 *        unlink, clear, undo, redo, source) and "|" separators. `source` switches between the visual editor and
 *        the sanitized HTML source.
 * @param {number} [options.minHeight=140] px
 * @param {boolean} [options.disabled]
 * @param {(html: string) => void} [options.onChange]
 * @returns {{element: HTMLElement, editor: HTMLElement, getValue: () => string, setValue: (html: string) => void,
 *            getText: () => string, focus: Function}}
 */
export function createRichText(options = {}) {
    const editorId = options.id ?? uid("richtext");
    const names = (options.toolbar ?? DEFAULT_TOOLBAR).filter(name => name === "|" || BUTTONS[name]);
    const toolbar = el("div", { class: "rt-toolbar", attrs: { role: "toolbar", "aria-label": translate("rt.toolbar") } });
    const editor = el("div", {
        id: editorId,
        class: "rt-editor",
        attrs: {
            contenteditable: options.disabled ? "false" : "true", role: "textbox", "aria-multiline": "true",
            "data-placeholder": options.placeholder ?? "", spellcheck: "true"
        }
    });
    editor.style.minHeight = `${options.minHeight ?? 140}px`;
    const source = el("textarea", { class: "rt-source-view", attrs: { hidden: true, spellcheck: "false", "aria-label": translate("rt.source") } });
    const root = el("div", { class: cx("richtext", options.disabled && "rt-disabled", options.class) }, toolbar, editor, source);
    const buttons = [];
    let savedRange = null;

    const getText = () => htmlToText(editor.innerHTML).replace(/ /g, " ");
    const isEmpty = () => getText().trim() === "";
    const syncEmpty = () => editor.classList.toggle("rt-empty", isEmpty());
    const getValue = () => (isEmpty() ? "" : sanitizeHtml(editor.innerHTML));
    const changed = () => {
        syncEmpty();
        options.onChange?.(getValue());
    };

    function saveRange() {
        const selection = window.getSelection();
        if (selection?.rangeCount && editor.contains(selection.anchorNode)) savedRange = selection.getRangeAt(0).cloneRange();
    }
    function restoreRange() {
        editor.focus();
        if (!savedRange) return;
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedRange);
    }

    async function addLink() {
        saveRange();
        // Loaded on demand: the dialog module imports the form builder, which imports this editor.
        const { promptDialog } = await import("../dialogGenerator/dialogGenerator.js");
        const url = await promptDialog(translate("rt.linkPrompt"), {
            title: translate("rt.link"), value: "https://", type: "url",
            validate: value => (isSafeUrl(value) && value.trim() !== "https://" ? "" : translate("validation.url"))
        });
        restoreRange();
        if (url === null) return;
        const selection = window.getSelection();
        if (selection.isCollapsed) {
            // Nothing selected: insert the address as the link text.
            exec("insertHTML", `<a href="${url.replace(/"/g, "&quot;")}">${url.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</a>`);
        } else {
            exec("createLink", url.trim());
        }
        editor.innerHTML = sanitizeHtml(editor.innerHTML);
        changed();
    }

    // Source view: the textarea shows the sanitized HTML; leaving it sanitizes what was typed.
    function toggleSource() {
        const open = source.hidden;
        if (open) {
            source.value = getValue();
            source.style.minHeight = editor.style.minHeight;
        } else {
            setValue(source.value);
            changed();
        }
        source.hidden = !open;
        editor.hidden = open;
        root.classList.toggle("rt-source-open", open);
        for (const { button, spec } of buttons) {
            if (spec.run === "source") button.setAttribute("aria-pressed", String(open));
            else button.disabled = open || Boolean(options.disabled);
        }
        (open ? source : editor).focus();
    }

    names.forEach(name => {
        if (name === "|") {
            toolbar.append(el("span", { class: "rt-separator", attrs: { role: "separator", "aria-hidden": "true" } }));
            return;
        }
        const spec = BUTTONS[name];
        const button = el("button", {
            class: cx("rt-button", spec.class),
            text: spec.text,
            attrs: { type: "button", title: translate(spec.label), "aria-label": translate(spec.label), tabindex: buttons.length ? "-1" : "0", "aria-pressed": spec.active ? "false" : null, disabled: options.disabled }
        });
        // mousedown would move the caret out of the text before the command runs
        button.addEventListener("mousedown", event => event.preventDefault());
        button.addEventListener("click", async () => {
            if (spec.run === "link") await addLink();
            else if (spec.run === "source") toggleSource();
            else {
                editor.focus();
                spec.run();
                changed();
            }
            refresh();
        });
        buttons.push({ button, spec });
        toolbar.append(button);
    });

    // Roving tab stop: Tab enters the toolbar once, the arrow keys move inside it.
    toolbar.addEventListener("keydown", event => {
        const nodes = buttons.map(item => item.button).filter(button => !button.disabled);
        const index = nodes.indexOf(document.activeElement);
        const target = { ArrowRight: nodes[(index + 1) % nodes.length], ArrowLeft: nodes[(index - 1 + nodes.length) % nodes.length], Home: nodes[0], End: nodes[nodes.length - 1] }[event.key];
        if (!target) return;
        event.preventDefault();
        nodes.forEach(node => { node.tabIndex = node === target ? 0 : -1; });
        target.focus();
    });

    function refresh() {
        for (const { button, spec } of buttons) {
            if (spec.active && spec.run !== "source") button.setAttribute("aria-pressed", String(Boolean(spec.active())));
        }
    }
    const onSelection = () => {
        if (!root.isConnected) {
            document.removeEventListener("selectionchange", onSelection);
            return;
        }
        if (editor.contains(window.getSelection()?.anchorNode)) refresh();
    };
    document.addEventListener("selectionchange", onSelection);

    editor.addEventListener("input", changed);
    editor.addEventListener("blur", saveRange);
    // Paste and drop go through the sanitizer, so no foreign markup, style or script gets in.
    const insertClean = (html, text) => {
        const clean = html ? sanitizeHtml(html) : "";
        if (clean) {
            exec("insertHTML", clean);
        } else {
            exec("insertText", text);
        }
    };
    editor.addEventListener("paste", event => {
        event.preventDefault();
        insertClean(event.clipboardData?.getData("text/html"), event.clipboardData?.getData("text/plain") ?? "");
    });
    editor.addEventListener("drop", event => {
        event.preventDefault();
        insertClean(event.dataTransfer?.getData("text/html"), event.dataTransfer?.getData("text/plain") ?? "");
    });

    function setValue(html) {
        editor.innerHTML = sanitizeHtml(html);
        syncEmpty();
        if (!source.hidden) source.value = getValue();
    }
    // <p> instead of <div> for new lines
    try {
        document.execCommand("defaultParagraphSeparator", false, "p");
        document.execCommand("styleWithCSS", false, false);
    } catch { /* not every browser knows these */ }
    setValue(options.value);

    const api = {
        element: root,
        editor,
        getValue,
        setValue,
        getText: () => getText().trim(),
        focus: () => editor.focus()
    };
    return api;
}

/** Generates a labelled rich text editor, see createRichText. */
export function generateRichText(options = {}) {
    const id = options.id ?? uid("richtext");
    const rich = createRichText({ ...options, id });
    const wrapper = el("div", { class: "field" });
    if (options.label) {
        const label = el("label", { class: "field-label", id: `${id}-label`, text: options.label });
        label.addEventListener("click", () => rich.focus());
        wrapper.append(label);
        rich.editor.setAttribute("aria-labelledby", `${id}-label`);
    }
    wrapper.append(rich.element);
    mount(options.parent, wrapper);
    return asHandle(rich, { also: wrapper });
}

/**
 * Generates a WYSIWYG editor: the rich text editor with the full toolbar plus a `source` button that switches to
 * the (sanitized) HTML source. Takes the same options as createRichText.
 */
export const createWysiwyg = (options = {}) => createRichText({ ...options, toolbar: options.toolbar ?? WYSIWYG_TOOLBAR });

/** Generates a labelled WYSIWYG editor, see createWysiwyg. */
export const generateWysiwyg = (options = {}) => generateRichText({ ...options, toolbar: options.toolbar ?? WYSIWYG_TOOLBAR });
