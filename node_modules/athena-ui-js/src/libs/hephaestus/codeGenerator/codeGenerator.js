//Code display of Athena UI: highlightCode (a <pre><code> with tokens), generateCodeBlock (label, copy button) and createDiffView.
//Everything is built with el(): text stays text, nothing is parsed as markup.
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { asHandle, cx, el, resolveElement } from "../../core/dom.js";
import { translate } from "../../core/i18n.js";
import { getLanguage, tokenize } from "../../core/codeLanguages.js";
import { diffLines, hunksOf, splitLines } from "../../core/codeDiff.js";

/* ------------------TOKENS TO LINES------------------- */

/** Splits tokens at the line breaks: an array (one entry per line) of arrays of { type, text }. */
export function tokensToLines(tokens) {
    const lines = [[]];
    for (const token of tokens) {
        const parts = token.text.split("\n");
        parts.forEach((part, index) => {
            if (index > 0) lines.push([]);
            if (part) lines.at(-1).push({ type: token.type, text: part });
        });
    }
    return lines;
}

/** The nodes of one line: text nodes and <span class="tok-..."> (a span has one class and one text node). */
export function lineNodes(tokens) {
    return tokens.map(token => (token.type ? el("span", { class: `tok-${token.type}` }, token.text) : document.createTextNode(token.text)));
}

/** "3", 3 or "5-8" (and a list of them) to a Set of line numbers. */
function lineSet(spec) {
    const set = new Set();
    for (const item of [].concat(spec ?? [])) {
        const range = /^(\d+)\s*-\s*(\d+)$/.exec(String(item));
        if (range) for (let n = Number(range[1]); n <= Math.min(Number(range[2]), Number(range[1]) + 100000); n++) set.add(n);
        else if (Number.isInteger(Number(item))) set.add(Number(item));
    }
    return set;
}

const digitsOf = count => Math.min(7, Math.max(1, String(count).length));

/**
 * Writes the highlighted lines of a text into a <code> element (replacing what is there). The editor uses it too.
 *
 * @param {HTMLElement} code
 * @param {string} text
 * @param {string|object} [language] a name or alias ("js"), or a language object; unknown: plain text
 * @param {object} [options]
 * @param {Array<number|string>} [options.highlightLines] line numbers (1-based) or ranges ("5-8") that get a background
 * @returns {number} the number of lines
 */
export function renderCode(code, text, language, { highlightLines } = {}) {
    const marked = lineSet(highlightLines);
    const lines = tokensToLines(tokenize(text, language));
    const fragment = document.createDocumentFragment();
    lines.forEach((tokens, index) => {
        const line = el("span", { class: cx("code-line", marked.has(index + 1) && "is-highlighted") });
        line.append(...lineNodes(tokens));
        fragment.append(line);
    });
    code.replaceChildren(fragment);
    return lines.length;
}

/**
 * Highlights read-only code: a `<pre class="athena-code"><code>` element.
 *
 * @param {string} text
 * @param {string|object} [language] "js", "ts", "json", "html", "css", "sql", "sh", "yaml", "c#", "python" or a language you registered
 * @param {object} [options]
 * @param {boolean} [options.lineNumbers=false]
 * @param {Array<number|string>} [options.highlightLines]
 * @param {boolean} [options.wrap=false] long lines wrap instead of scrolling
 * @param {string} [options.label] accessible name of the code
 * @returns {HTMLPreElement}
 */
export function highlightCode(text, language, { lineNumbers = false, highlightLines, wrap = false, label } = {}) {
    const found = getLanguage(language);
    const code = el("code", { class: found ? `language-${found.name}` : "" });
    const count = renderCode(code, text, language, { highlightLines });
    return el("pre", {
        class: cx("athena-code", lineNumbers && "has-line-numbers", lineNumbers && `code-digits-${digitsOf(count)}`, wrap && "code-wrap"),
        attrs: { tabindex: "0", ...(label ? { "aria-label": label, role: "region" } : {}) }
    }, code);
}

/* ------------------CODE BLOCK------------------- */

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const area = el("textarea", { class: "athena-visually-hidden", attrs: { "aria-hidden": "true", tabindex: "-1", readonly: "" } });
        area.value = text;
        document.body.append(area);
        area.select();
        let done = false;
        try {
            done = document.execCommand("copy");
        } catch {
            done = false;
        }
        area.remove();
        return done;
    }
}

/**
 * A code block: a label with the language, a copy button and the highlighted code.
 *
 * @param {object} options
 * @param {string|HTMLElement} [options.parent]
 * @param {string} options.code
 * @param {string|object} [options.language]
 * @param {string} [options.title] shown in the header instead of the language
 * @param {boolean} [options.lineNumbers=false]
 * @param {Array<number|string>} [options.highlightLines]
 * @param {boolean} [options.copy=true] the copy button
 * @param {boolean} [options.wrap=false]
 * @param {string} [options.id]
 * @returns {{element: HTMLElement, getCode: () => string, setCode: (code: string, language?: string|object) => void, copy: () => Promise<boolean>, destroy: Function}}
 */
export function generateCodeBlock({ parent, code = "", language, title, lineNumbers = false, highlightLines, copy = true, wrap = false, id } = {}) {
    let text = String(code);
    let current = language;
    const label = () => title ?? getLanguage(current)?.label ?? getLanguage(current)?.name ?? "";
    const status = el("span", { class: "athena-visually-hidden", attrs: { role: "status" } });
    const name = el("span", { class: "code-block-language" }, label());
    const header = el("figcaption", { class: "code-block-header" }, name);
    const figure = el("figure", { class: "code-block", attrs: id ? { id } : {} }, header);
    let pre = null;
    let timer = 0;

    const draw = () => {
        const next = highlightCode(text, current, { lineNumbers, highlightLines, wrap, label: label() || undefined });
        if (pre) pre.replaceWith(next);
        else figure.append(next);
        pre = next;
        name.textContent = label();
    };

    const doCopy = async () => {
        const done = await copyText(text);
        status.textContent = translate(done ? "code.copied" : "code.copyFailed");
        if (button) {
            button.textContent = translate(done ? "code.copied" : "code.copyFailed");
            clearTimeout(timer);
            timer = setTimeout(() => { button.textContent = translate("code.copy"); status.textContent = ""; }, 1800);
        }
        return done;
    };

    let button = null;
    if (copy) {
        button = el("button", { class: "code-block-copy", attrs: { type: "button" } }, translate("code.copy"));
        button.addEventListener("click", doCopy);
        header.append(button);
    }
    figure.append(status);
    draw();
    resolveElement(parent)?.append(figure);

    return asHandle({
        element: figure,
        getCode: () => text,
        setCode(next, nextLanguage) {
            text = String(next ?? "");
            if (nextLanguage !== undefined) current = nextLanguage;
            draw();
        },
        copy: doCopy,
        destroy() {
            clearTimeout(timer);
            figure.remove();
        }
    });
}

/* ------------------DIFF VIEW------------------- */

/**
 * A view of the difference between two texts, with highlighted code on both sides.
 *
 * @param {object} options
 * @param {string|HTMLElement} [options.parent]
 * @param {string} [options.original]
 * @param {string} [options.modified]
 * @param {string|object} [options.language]
 * @param {"unified"|"split"} [options.mode="unified"]
 * @param {number} [options.context=3] unchanged lines kept around a change (Infinity: all of them); a button shows the rest
 * @param {string} [options.originalLabel]
 * @param {string} [options.modifiedLabel]
 * @returns {{element: HTMLElement, setTexts: (original: string, modified: string) => void, setMode: (mode: string) => void, getStats: () => {added: number, removed: number}}}
 */
export function createDiffView({ parent, original = "", modified = "", language, mode = "unified", context = 3, originalLabel, modifiedLabel } = {}) {
    const root = el("div", { class: "code-diff", attrs: { role: "group", "aria-label": translate("code.diff") } });
    let texts = [String(original), String(modified)];
    let view = mode === "split" ? "split" : "unified";
    let expanded = false;
    let stats = { added: 0, removed: 0 };

    const mark = (symbol, word) => el("span", { class: "code-diff-mark" }, el("span", { class: "athena-visually-hidden" }, `${word} `), el("span", { attrs: { "aria-hidden": "true" } }, symbol));

    const cell = (kind, tokens, symbol, word, number) => {
        const line = el("span", { class: "code-line" });
        if (tokens) line.append(...lineNodes(tokens));
        return el("span", { class: cx("code-diff-cell", `is-${kind}`) },
            el("span", { class: "code-diff-number", attrs: { "aria-hidden": "true" } }, number ?? ""), symbol ? mark(symbol, word) : el("span", { class: "code-diff-mark" }), line);
    };

    function draw() {
        const oldLines = splitLines(texts[0]);
        const newLines = splitLines(texts[1]);
        const oldTokens = tokensToLines(tokenize(oldLines.join("\n"), language));
        const newTokens = tokensToLines(tokenize(newLines.join("\n"), language));
        const ops = diffLines(oldLines, newLines);
        stats = { added: ops.filter(op => op.type === "add").length, removed: ops.filter(op => op.type === "remove").length };
        const hunks = hunksOf(ops, expanded ? Infinity : context);
        const body = el("div", { class: cx("code-diff-body", `is-${view}`) });
        const header = el("div", { class: "code-diff-header" }, el("span", { class: "code-diff-stat is-removed" }, `−${stats.removed}`), el("span", { class: "code-diff-stat is-added" }, `+${stats.added}`));
        if (view === "split") header.append(el("span", { class: "code-diff-side" }, originalLabel ?? translate("code.original")), el("span", { class: "code-diff-side" }, modifiedLabel ?? translate("code.modified")));
        const tail = oldLines.length - hunks.reduce((sum, hunk) => sum + hunk.skippedBefore + hunk.ops.filter(op => op.type !== "add").length, 0);

        const skipRow = count => {
            const button = el("button", { class: "code-diff-skip", attrs: { type: "button" } }, translate("code.unchanged", { count }));
            button.addEventListener("click", () => { expanded = true; draw(); });
            return el("div", { class: "code-diff-row is-skip" }, button);
        };

        for (const hunk of hunks) {
            if (hunk.skippedBefore) body.append(skipRow(hunk.skippedBefore));
            const pending = { removed: [], added: [] };
            const flush = () => {
                if (view === "split") {
                    const rows = Math.max(pending.removed.length, pending.added.length);
                    for (let i = 0; i < rows; i++) {
                        const left = pending.removed[i];
                        const right = pending.added[i];
                        body.append(el("div", { class: "code-diff-row" },
                            left !== undefined ? cell("removed", oldTokens[left], "−", translate("code.removed"), left + 1) : cell("empty"),
                            right !== undefined ? cell("added", newTokens[right], "+", translate("code.added"), right + 1) : cell("empty")));
                    }
                } else {
                    for (const index of pending.removed) body.append(el("div", { class: "code-diff-row" }, cell("removed", oldTokens[index], "−", translate("code.removed"), index + 1)));
                    for (const index of pending.added) body.append(el("div", { class: "code-diff-row" }, cell("added", newTokens[index], "+", translate("code.added"), index + 1)));
                }
                pending.removed = [];
                pending.added = [];
            };
            for (const op of hunk.ops) {
                if (op.type === "remove") pending.removed.push(op.a);
                else if (op.type === "add") pending.added.push(op.b);
                else {
                    flush();
                    body.append(el("div", { class: "code-diff-row" },
                        cell("equal", oldTokens[op.a], null, "", op.a + 1), ...(view === "split" ? [cell("equal", newTokens[op.b], null, "", op.b + 1)] : [])));
                }
            }
            flush();
        }
        if (tail > 0 && hunks.length) body.append(skipRow(tail));
        if (!hunks.length) body.append(el("p", { class: "code-diff-empty" }, translate("code.noChanges")));
        root.replaceChildren(header, el("pre", { class: cx("athena-code", "code-diff-code"), attrs: { tabindex: "0" } }, el("code", {}, body)));
        root.dataset.mode = view;
    }

    draw();
    resolveElement(parent)?.append(root);
    return asHandle({
        element: root,
        setTexts(a, b) {
            texts = [String(a ?? ""), String(b ?? "")];
            expanded = false;
            draw();
        },
        setMode(next) {
            view = next === "split" ? "split" : "unified";
            draw();
        },
        getStats: () => ({ ...stats })
    });
}

