//Code editor of Athena UI: a real <textarea> (native input, selection, mobile keyboards and IME keep working, screen readers read it) with the
//highlighted code behind it. The textarea shows nothing but the caret and the selection, the highlighted <pre> shows the text, and both sit in one scroller.
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { asHandle, cx, el, resolveElement, uid } from "../../core/dom.js";
import { translate } from "../../core/i18n.js";
import { getLanguage, tokenize } from "../../core/codeLanguages.js";
import { lineNodes, tokensToLines } from "./codeGenerator.js";

const HIGHLIGHTS = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function" ? CSS.highlights : null;
const IDENTIFIER = /[\w$]/;
const OPEN_TO_CLOSE = { "(": ")", "[": "]", "{": "}" };
const CLOSE_TO_OPEN = { ")": "(", "]": "[", "}": "{" };
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A code editor.
 *
 * @param {object} options
 * @param {string|HTMLElement} options.element the container
 * @param {string} [options.value]
 * @param {string|object} [options.language] "js", "json", ... or a language object (see registerLanguage)
 * @param {boolean} [options.readOnly=false]
 * @param {boolean} [options.lineNumbers=true]
 * @param {boolean} [options.wrap=false] soft wrap
 * @param {number} [options.tabSize=4]
 * @param {boolean} [options.insertSpaces=true] Tab inserts spaces (false: a tab character)
 * @param {boolean} [options.statusBar=true] line and column, and the message of a marker
 * @param {string} [options.label] accessible name of the editor
 * @param {number} [options.maxHighlightLength=300000] longer texts are shown without highlighting (and without line numbers) to stay fast
 * @param {{line: number, message: string, level?: "error"|"warning"|"info"}[]} [options.markers] lint markers (lines count from 1)
 * @param {{from: number, to: number}[]} [options.readOnlyRanges] lines (1-based, inclusive) that cannot be changed
 * @param {(context: {value: string, position: number, line: number, lineText: string, prefix: string, explicit: boolean, language: string}) => (Array<{label: string, insert?: string, detail?: string}>|Promise<Array>)} [options.provideCompletions]
 * @param {boolean} [options.autoComplete=true] with provideCompletions: suggest while typing (otherwise only with Ctrl+Space)
 * @param {(value: string, reason: string) => void} [options.onChange] after every change made by typing, undo, redo, replace ... (not after setValue)
 * @returns the handle: { element, textarea, getValue, setValue, focus, getSelection, setSelection, insertText, setLanguage, setReadOnly, setWrap, setMarkers,
 *          setReadOnlyRanges, undo, redo, canUndo, canRedo, openFind, closeFind, toggleComment, destroy }
 */
export function createCodeEditor(options = {}) {
    const container = resolveElement(options.element);
    if (!container) throw new TypeError("Athena UI: createCodeEditor needs an element");
    let language = options.language;
    let readOnly = Boolean(options.readOnly);
    let wrap = Boolean(options.wrap);
    const lineNumbers = options.lineNumbers !== false;
    const tabSize = Math.min(Math.max(Math.round(options.tabSize) || 4, 1), 16);
    const insertSpaces = options.insertSpaces !== false;
    const maxHighlight = options.maxHighlightLength ?? 300000;
    const indentUnit = insertSpaces ? " ".repeat(tabSize) : "\t";
    const id = uid("code-editor");
    let destroyed = false;

    /* ---- DOM ---- */

    const code = el("code", {});
    const pre = el("pre", { class: "athena-code code-editor-highlight", attrs: { "aria-hidden": "true" } }, code);
    const textarea = el("textarea", {
        class: "code-editor-input",
        attrs: {
            spellcheck: "false", autocapitalize: "off", autocomplete: "off", autocorrect: "off", wrap: "off", "aria-label": options.label ?? translate("code.editorLabel"),
            "aria-describedby": `${id}-hint`, "aria-multiline": "true"
        }
    });
    const scroller = el("div", { class: "code-editor-scroll" }, pre, textarea);
    const hint = el("span", { class: "athena-visually-hidden", attrs: { id: `${id}-hint` } }, translate("code.escapeHint"));
    const position = el("span", { class: "code-editor-position" });
    const note = el("span", { class: "code-editor-note", attrs: { role: "status", "aria-live": "polite" } });
    const status = el("div", { class: "code-editor-status" }, position, note);
    const root = container;
    root.classList.add("code-editor", `code-tab-${tabSize}`);
    root.replaceChildren(scroller, status, hint);
    status.hidden = options.statusBar === false;
    textarea.value = String(options.value ?? "").replace(/\r\n?/g, "\n");

    /* ---- the text and its lines ---- */

    let starts = [0];                       // offset of the first character of every line (of the text now)
    let nodes = [];                         // the span of every line
    let lineTokens = [];                    // the tokens of every line, as last drawn
    let insideAtStart = [];                 // does the line start inside a token that began on an earlier line (a block comment)?
    let renderedText = "";                  // the text that was drawn last
    let renderedStarts = [0];               // and where its lines start
    let renderedLanguage;
    let renderTimer = 0;
    let plain = false;

    function measure() {
        const text = textarea.value;
        starts = [0];
        for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
    }

    const lineIn = (table, offset) => {
        let low = 0;
        let high = table.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (table[middle] <= offset) low = middle;
            else high = middle - 1;
        }
        return low;
    };
    const lineOf = offset => lineIn(starts, offset);
    const lineText = index => textarea.value.slice(starts[index], index + 1 < starts.length ? starts[index + 1] - 1 : undefined);

    /** The tokens of a text, line by line, and for every line whether it starts inside a token of an earlier line. */
    function tokenLines(text) {
        const lines = [[]];
        const inside = [false];
        for (const token of tokenize(text, language)) {
            const parts = token.text.split("\n");
            parts.forEach((part, index) => {
                if (index > 0) {
                    lines.push([]);
                    inside.push(token.type !== null && (part.length > 0 || index < parts.length - 1));
                }
                if (part) lines.at(-1).push({ type: token.type, text: part });
            });
        }
        return { lines, inside };
    }

    /** Replaces the lines [from, to) (as drawn) by new ones: the nodes and the tokens. */
    function replaceLines(from, to, fresh) {
        const before = nodes[to] ?? null;
        for (let i = from; i < to; i++) nodes[i]?.remove();
        const fragment = document.createDocumentFragment();
        const created = fresh.lines.map(tokens => {
            const line = el("span", { class: "code-line" });
            line.append(...lineNodes(tokens));
            fragment.append(line);
            return line;
        });
        code.insertBefore(fragment, before);
        const tail = { nodes: nodes.slice(to), tokens: lineTokens.slice(to), inside: insideAtStart.slice(to) };
        nodes = [...nodes.slice(0, from), ...created, ...tail.nodes];
        lineTokens = [...lineTokens.slice(0, from), ...fresh.lines, ...tail.tokens];
        insideAtStart = [...insideAtStart.slice(0, from), ...fresh.inside, ...tail.inside];
    }

    function render() {
        clearTimeout(renderTimer);
        renderTimer = 0;
        const text = textarea.value;
        measure();
        plain = text.length > maxHighlight;
        pre.classList.toggle("is-plain", plain);
        pre.classList.toggle("has-line-numbers", lineNumbers && !plain);
        pre.classList.toggle("code-wrap", wrap);
        pre.className = pre.className.replace(/\bcode-digits-\d\b/g, "").trim();
        pre.classList.add(`code-digits-${Math.min(7, String(starts.length).length)}`);
        const found = getLanguage(language);
        code.className = found ? `language-${found.name}` : "";
        const before = { text: renderedText, starts: renderedStarts, language: renderedLanguage };
        renderedText = text;
        renderedStarts = starts;
        renderedLanguage = language;
        if (plain) {
            nodes = [];
            lineTokens = [];
            insideAtStart = [];
            renderedText = "";
            code.replaceChildren(document.createTextNode(`${text}\n`));
            return;
        }
        if (!nodes.length || before.language !== language) {
            // everything
            code.replaceChildren();
            const old = nodes.length;
            nodes = [];
            lineTokens = [];
            insideAtStart = [];
            void old;
            replaceLines(0, 0, tokenLines(text));
            decorate();
            return;
        }
        // Only the lines around the change are tokenized again: from the nearest line that does not start inside a block comment or a string
        // before the change, to the nearest such line after it (and a comment or string that runs to the end of that part is followed further).
        const limit = Math.min(before.text.length, text.length);
        let head = 0;
        while (head < limit && before.text.charCodeAt(head) === text.charCodeAt(head)) head++;
        let tail = 0;
        while (tail < limit - head && before.text.charCodeAt(before.text.length - 1 - tail) === text.charCodeAt(text.length - 1 - tail)) tail++;
        const count = starts.length;
        const delta = count - before.starts.length;
        let first = lineOf(head);
        while (first > 0 && insideAtStart[first]) first--;
        let last = lineOf(text.length - tail) + 1;
        let step = 1;
        for (;;) {
            while (last < count && insideAtStart[last - delta]) last++;
            const end = last < count ? starts[last] - 1 : text.length;
            const fresh = tokenLines(text.slice(starts[first], end));
            const lastToken = fresh.lines.at(-1).at(-1);
            if (last < count && lastToken && (lastToken.type === "comment" || lastToken.type === "string" || lastToken.type === "meta")) {
                last = Math.min(count, last + step);      // it may run on: look further (doubling, so a long comment does not cost much more)
                step *= 2;
                continue;
            }
            replaceLines(first, last - delta, fresh);
            break;
        }
        decorate();
    }

    function scheduleRender() {
        if (textarea.value.length <= 60000) return render();
        if (!renderTimer) renderTimer = setTimeout(() => !destroyed && render(), 120);
    }

    /* ---- decorations: caret line, markers, locked lines ---- */

    let markers = [];
    let locked = [];
    let currentNode = null;
    let decorated = [];                     // [node, classes] of the lines that carry a marker or are locked

    function decorate() {
        if (plain) return;
        for (const [node, classes] of decorated) node.classList.remove(...classes);
        decorated = [];
        const wanted = new Map();
        const add = (index, ...classes) => wanted.set(index, [...(wanted.get(index) ?? []), ...classes]);
        const seen = new Set();
        for (const marker of [...markers.filter(item => item.level === "error"), ...markers.filter(item => item.level !== "error")]) {
            if (seen.has(marker.line)) continue;
            seen.add(marker.line);
            add(marker.line - 1, "has-marker", `marker-${marker.level ?? "error"}`);
        }
        for (const range of locked) for (let line = Math.max(1, range.from); line <= Math.min(range.to, nodes.length); line++) add(line - 1, "is-locked-line");
        for (const [index, classes] of wanted) {
            const node = nodes[index];
            if (!node) continue;
            node.classList.add(...classes);
            decorated.push([node, classes]);
        }
        markCurrentLine();
    }

    function caretInfo() {
        const offset = textarea.selectionStart;
        const line = lineOf(offset);
        return { offset, line, column: offset - starts[line] };
    }

    function markCurrentLine() {
        const { line, column } = caretInfo();
        currentNode?.classList.remove("is-current");
        currentNode = textarea.selectionStart === textarea.selectionEnd ? (nodes[line] ?? null) : null;
        currentNode?.classList.add("is-current");
        position.textContent = translate("code.position", { line: line + 1, column: column + 1 });
        const marker = markers.find(entry => entry.line === line + 1);
        const message = marker ? translate("code.marker", { line: line + 1, message: marker.message }) : "";
        if (note.textContent !== message) note.textContent = message;
    }

    /* ---- caret geometry, brackets, highlights ---- */

    function locate(offset) {
        const index = lineOf(offset);
        let remaining = offset - starts[index];
        const line = nodes[index];
        if (!line) return null;
        for (const child of line.childNodes) {
            const text = child.nodeType === Node.TEXT_NODE ? child : child.firstChild;
            const length = text?.length ?? 0;
            if (remaining <= length) return { node: text ?? line, offset: remaining };
            remaining -= length;
        }
        return { node: line, offset: line.childNodes.length };
    }

    function rangeBetween(from, to) {
        const a = locate(from);
        const b = locate(to);
        if (!a || !b) return null;
        const range = new Range();
        range.setStart(a.node, a.offset);
        range.setEnd(b.node, b.offset);
        return range;
    }

    function caretRect(offset = textarea.selectionEnd) {
        const range = rangeBetween(offset, offset);
        let rect = range?.getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) rect = nodes[lineOf(offset)]?.getBoundingClientRect() ?? scroller.getBoundingClientRect();
        return rect;
    }

    function revealCaret() {
        if (plain) return;
        const rect = caretRect();
        const box = scroller.getBoundingClientRect();
        const gutter = lineNumbers ? 64 : 12;
        if (rect.bottom > box.bottom - 4) scroller.scrollTop += rect.bottom - box.bottom + 8;
        else if (rect.top < box.top + 4) scroller.scrollTop -= box.top - rect.top + 8;
        if (rect.right > box.right - 12) scroller.scrollLeft += rect.right - box.right + 24;
        else if (rect.left < box.left + gutter) scroller.scrollLeft -= box.left + gutter - rect.left + 24;
    }

    function setHighlight(name, ranges) {
        if (!HIGHLIGHTS) return;
        if (ranges.length) HIGHLIGHTS.set(name, new Highlight(...ranges));
        else HIGHLIGHTS.delete(name);
    }

    function matchBracket() {
        const text = textarea.value;
        const caret = textarea.selectionStart;
        if (plain || caret !== textarea.selectionEnd) return setHighlight("athena-code-bracket", []);
        for (const at of [caret - 1, caret]) {
            const char = text[at];
            const forward = OPEN_TO_CLOSE[char];
            const backward = CLOSE_TO_OPEN[char];
            if (!forward && !backward) continue;
            let depth = 0;
            for (let i = at; forward ? i < text.length : i >= 0; i += forward ? 1 : -1) {
                if (text[i] === char) depth++;
                else if (text[i] === (forward ?? backward)) depth--;
                if (depth === 0) {
                    const ranges = [rangeBetween(at, at + 1), rangeBetween(i, i + 1)].filter(Boolean);
                    return setHighlight("athena-code-bracket", ranges);
                }
            }
        }
        setHighlight("athena-code-bracket", []);
    }

    /* ---- history ---- */

    const history = [];
    let historyIndex = -1;
    let lastType = null;
    let lastTime = 0;

    function snapshot() {
        return { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd };
    }

    function remember(type) {
        const now = performance.now();
        const joins = (type === "insertText" || type === "deleteContentBackward" || type === "deleteContentForward") && type === lastType && now - lastTime < 700 && historyIndex === history.length - 1 && historyIndex > 0;
        if (joins) history[historyIndex] = snapshot();
        else {
            history.length = historyIndex + 1;
            history.push(snapshot());
            if (history.length > 300) history.shift();
            historyIndex = history.length - 1;
        }
        lastType = type;
        lastTime = now;
    }

    function restore(entry, reason) {
        textarea.value = entry.value;
        textarea.setSelectionRange(entry.start, entry.end);
        lastType = null;
        afterChange(reason, { remembered: true });
    }

    function undo() {
        if (readOnly || historyIndex <= 0) return false;
        historyIndex--;
        restore(history[historyIndex], "undo");
        return true;
    }

    function redo() {
        if (readOnly || historyIndex >= history.length - 1) return false;
        historyIndex++;
        restore(history[historyIndex], "redo");
        return true;
    }

    /* ---- changes ---- */

    function lockedSpans() {
        return locked.map(range => {
            const first = Math.max(0, range.from - 1);
            const last = Math.min(starts.length - 1, range.to - 1);
            return first < starts.length ? [starts[first], starts[last] + lineText(last).length] : null;
        }).filter(Boolean);
    }

    /** Would a change of [from, to) touch a locked line? An insertion is from === to. */
    const blocked = (from, to) => lockedSpans().some(([start, end]) => from <= end && to >= start);

    function afterChange(reason, { remembered = false, native = false } = {}) {
        scheduleRender();
        if (!remembered) remember(reason);
        measure();
        decorate();
        refreshFind();
        matchBracket();
        // The browser scrolls to the caret by itself while the person types; our own edits (Tab, Enter, replace, undo ...) do it here, once per frame
        // (measuring the caret makes the browser lay the whole text out, which is the expensive part of a big file)
        if (!native) requestAnimationFrame(() => !destroyed && revealCaret());
        options.onChange?.(textarea.value, reason);
        maybeComplete(reason);
    }

    /** Replaces [from, to) by text and puts the selection where it says (default: after the text). */
    function applyEdit(from, to, text, { select = [from + text.length, from + text.length], reason = "edit" } = {}) {
        if (readOnly || blocked(from, to)) return false;
        const value = textarea.value;
        textarea.value = value.slice(0, from) + text + value.slice(to);
        textarea.setSelectionRange(select[0], select[1]);
        afterChange(reason);
        return true;
    }

    /* ---- editing helpers ---- */

    const selectedLines = () => {
        measure();
        const first = lineOf(textarea.selectionStart);
        let last = lineOf(textarea.selectionEnd);
        if (last > first && textarea.selectionEnd === starts[last]) last--;      // a selection that ends at the start of a line does not include it
        return [first, last];
    };

    /** Applies f to every line of the selection (one edit, one undo step); keeps the selection on the same text. */
    function changeLines(change, reason) {
        const [first, last] = selectedLines();
        const from = starts[first];
        const to = starts[last] + lineText(last).length;
        const original = textarea.value.slice(from, to).split("\n");
        const changed = original.map((line, index) => change(line, index));
        const text = changed.join("\n");
        if (text === original.join("\n")) return false;
        // where a position of the old block is in the new one: the line moved by the lengths of the lines before it, the column by what this line grew
        const mapped = offset => {
            const index = lineOf(offset) - first;
            const column = offset - starts[index + first];
            const before = changed.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
            const grown = changed[index].length - original[index].length;
            return from + before + (column === 0 ? 0 : Math.max(0, Math.min(column + grown, changed[index].length)));
        };
        const start = mapped(textarea.selectionStart);
        const end = mapped(textarea.selectionEnd);
        return applyEdit(from, to, text, { select: [start, end], reason });
    }

    function indentSelection() {
        const [first, last] = selectedLines();
        if (first === last && textarea.selectionStart === textarea.selectionEnd) {
            const column = textarea.selectionStart - starts[first];
            const text = insertSpaces ? " ".repeat(tabSize - (column % tabSize)) : "\t";
            return applyEdit(textarea.selectionStart, textarea.selectionEnd, text, { reason: "indent" });
        }
        return changeLines(line => (line.length ? indentUnit + line : line), "indent");
    }

    function outdentSelection() {
        const strip = line => (line.startsWith("\t") ? line.slice(1) : line.replace(new RegExp(`^ {1,${tabSize}}`), ""));
        return changeLines(strip, "outdent");
    }

    function toggleComment() {
        const found = getLanguage(language);
        if (readOnly || !found) return false;
        if (found.lineComment) {
            const marker = found.lineComment;
            const [first, last] = selectedLines();
            const lines = [];
            for (let i = first; i <= last; i++) lines.push(lineText(i));
            const filled = lines.filter(line => line.trim());
            const commented = filled.length > 0 && filled.every(line => line.trimStart().startsWith(marker));
            const indent = Math.min(...filled.map(line => line.match(/^[ \t]*/)[0].length), Infinity);
            return changeLines(line => {
                if (!line.trim()) return line;
                if (commented) return line.replace(new RegExp(`^([ \\t]*)${escapeRegExp(marker)} ?`), "$1");
                return `${line.slice(0, indent)}${marker} ${line.slice(indent)}`;
            }, "comment");
        }
        if (found.blockComment) {
            const [open, close] = found.blockComment;
            const [first, last] = selectedLines();
            const from = starts[first];
            const to = starts[last] + lineText(last).length;
            const body = textarea.value.slice(from, to);
            const text = body.trimStart().startsWith(open) && body.trimEnd().endsWith(close)
                ? body.replace(open, "").replace(new RegExp(`${escapeRegExp(close)}(?![\\s\\S]*${escapeRegExp(close)})`), "").replace(/^ /, "").replace(/ $/, "")
                : `${open} ${body} ${close}`;
            return applyEdit(from, to, text, { select: [from, from + text.length], reason: "comment" });
        }
        return false;
    }

    function moveLines(direction) {
        const [first, last] = selectedLines();
        if ((direction < 0 && first === 0) || (direction > 0 && last === starts.length - 1)) return false;
        const block = [];
        for (let i = first; i <= last; i++) block.push(lineText(i));
        const neighbour = lineText(direction < 0 ? first - 1 : last + 1);
        const from = starts[direction < 0 ? first - 1 : first];
        const to = starts[direction < 0 ? last : last + 1] + lineText(direction < 0 ? last : last + 1).length;
        const text = direction < 0 ? [...block, neighbour].join("\n") : [neighbour, ...block].join("\n");
        const shift = direction < 0 ? -(neighbour.length + 1) : neighbour.length + 1;
        return applyEdit(from, to, text, { select: [textarea.selectionStart + shift, textarea.selectionEnd + shift], reason: "move-lines" });
    }

    function newLine() {
        const caret = textarea.selectionStart;
        const end = textarea.selectionEnd;
        measure();
        const index = lineOf(caret);
        const before = textarea.value.slice(starts[index], caret);
        const after = textarea.value.slice(end, end + 1);
        const indent = before.match(/^[ \t]*/)[0];
        const found = getLanguage(language);
        const deeper = found?.indentAfter?.test(before) ? indentUnit : "";
        const closes = Boolean(after) && OPEN_TO_CLOSE[before.trimEnd().slice(-1)] === after;
        if (closes) {
            const middle = `\n${indent}${deeper || indentUnit}`;
            return applyEdit(caret, end, `${middle}\n${indent}`, { select: [caret + middle.length, caret + middle.length], reason: "newline" });
        }
        const text = `\n${indent}${deeper}`;
        return applyEdit(caret, end, text, { reason: "newline" });
    }

    /** Typing an opening bracket or quote closes it; typing a closing one that is already there steps over it. Returns true when it handled the character. */
    function typeCharacter(char) {
        const found = getLanguage(language);
        const pairs = found?.pairs ?? [];
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const pair = pairs.find(item => item[0] === char);
        const closing = pairs.find(item => item[1] === char);
        if (start === end && closing && text[start] === char) {
            textarea.setSelectionRange(start + 1, start + 1);
            afterSelection();
            return true;
        }
        if (!pair) return false;
        if (start !== end) return applyEdit(start, end, `${pair[0]}${text.slice(start, end)}${pair[1]}`, { select: [start + 1, end + 1], reason: "surround" });
        const next = text[start] ?? "";
        const previous = text[start - 1] ?? "";
        const quote = pair[0] === pair[1];
        if (quote && (IDENTIFIER.test(previous) || IDENTIFIER.test(next))) return false;
        if (next && !/[\s)\]}>,;:]/.test(next)) return false;
        return applyEdit(start, end, pair, { select: [start + 1, start + 1], reason: "pair" });
    }

    function deletePair() {
        const found = getLanguage(language);
        const start = textarea.selectionStart;
        if (start !== textarea.selectionEnd || !found?.pairs) return false;
        const pair = textarea.value.slice(start - 1, start + 1);
        if (!found.pairs.includes(pair)) return false;
        return applyEdit(start - 1, start + 1, "", { reason: "deleteContentBackward" });
    }

    /* ---- find and replace ---- */

    const find = { open: false, query: "", replacement: "", matchCase: false, regex: false, matches: [], current: -1, invalid: false };
    let findBar = null;
    let findInput;
    let replaceInput;
    let findCount;

    function computeMatches() {
        find.matches = [];
        find.invalid = false;
        if (!find.query) return;
        let expression;
        try {
            expression = new RegExp(find.regex ? find.query : escapeRegExp(find.query), `gm${find.matchCase ? "" : "i"}`);
        } catch {
            find.invalid = true;
            return;
        }
        const text = textarea.value;
        for (let match = expression.exec(text); match && find.matches.length < 10000; match = expression.exec(text)) {
            if (match[0] === "") {
                expression.lastIndex++;
                continue;
            }
            find.matches.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
        }
    }

    function paintFind() {
        if (!findBar) return;
        const selected = find.matches.findIndex(match => match.start === textarea.selectionStart && match.end === textarea.selectionEnd);
        if (selected !== -1) find.current = selected;
        findCount.textContent = find.invalid ? translate("code.invalidPattern") : !find.query ? "" : !find.matches.length ? translate("code.noMatches") : translate("code.matches", { current: Math.max(find.current, -1) + 1 || "–", total: find.matches.length });
        findInput.setAttribute("aria-invalid", String(find.invalid));
        if (!plain) {
            setHighlight("athena-code-find", find.matches.slice(0, 2000).map(match => rangeBetween(match.start, match.end)).filter(Boolean));
            setHighlight("athena-code-find-current", find.current >= 0 && find.matches[find.current] ? [rangeBetween(find.matches[find.current].start, find.matches[find.current].end)].filter(Boolean) : []);
        }
    }

    function refreshFind() {
        if (!find.open) return;
        computeMatches();
        find.current = Math.min(find.current, find.matches.length - 1);
        paintFind();
    }

    function goToMatch(step) {
        computeMatches();
        if (!find.matches.length) return paintFind();
        const from = step > 0 ? textarea.selectionEnd : textarea.selectionStart;
        let index = step > 0 ? find.matches.findIndex(match => match.start >= from) : find.matches.findLastIndex(match => match.end <= from);
        if (index === -1) index = step > 0 ? 0 : find.matches.length - 1;
        find.current = index;
        const match = find.matches[index];
        textarea.setSelectionRange(match.start, match.end);
        markCurrentLine();
        revealCaret();
        paintFind();
    }

    function replaceCurrent() {
        if (readOnly) return;
        computeMatches();
        const selected = find.matches.find(match => match.start === textarea.selectionStart && match.end === textarea.selectionEnd);
        if (!selected) return goToMatch(1);
        const text = find.regex ? selected.text.replace(new RegExp(find.query, find.matchCase ? "" : "i"), find.replacement) : find.replacement;
        if (applyEdit(selected.start, selected.end, text, { reason: "replace" })) goToMatch(1);
    }

    function replaceAll() {
        if (readOnly) return;
        computeMatches();
        if (!find.matches.length) return;
        const value = textarea.value;
        let result = "";
        let at = 0;
        for (const match of find.matches) {
            if (blocked(match.start, match.end)) continue;
            result += value.slice(at, match.start) + (find.regex ? match.text.replace(new RegExp(find.query, find.matchCase ? "" : "i"), find.replacement) : find.replacement);
            at = match.end;
        }
        result += value.slice(at);
        if (result !== value) applyEdit(0, value.length, result, { select: [0, 0], reason: "replace-all" });
    }

    function buildFindBar() {
        const field = (name, label, onInput) => {
            const input = el("input", { class: "code-find-input", attrs: { type: "text", "aria-label": label, placeholder: label, spellcheck: "false", autocomplete: "off", name } });
            input.addEventListener("input", () => onInput(input.value));
            return input;
        };
        const button = (text, label, handler, pressed) => {
            const node = el("button", { class: "code-find-button", attrs: { type: "button", "aria-label": label, title: label, ...(pressed === undefined ? {} : { "aria-pressed": String(pressed) }) } }, text);
            node.addEventListener("click", handler);
            return node;
        };
        findInput = field("find", translate("code.find"), value => { find.query = value; find.current = -1; computeMatches(); goToMatch(1); });
        replaceInput = field("replace", translate("code.replaceWith"), value => { find.replacement = value; });
        findCount = el("span", { class: "code-find-count", attrs: { role: "status", "aria-live": "polite" } });
        const toggle = (key, node) => () => { find[key] = !find[key]; node.setAttribute("aria-pressed", String(find[key])); refreshFind(); goToMatch(1); };
        const caseButton = button("Aa", translate("code.matchCase"), () => {}, false);
        caseButton.addEventListener("click", toggle("matchCase", caseButton));
        const regexButton = button(".*", translate("code.useRegex"), () => {}, false);
        regexButton.addEventListener("click", toggle("regex", regexButton));
        const row = el("div", { class: "code-find-row" }, findInput, button("↑", translate("code.previous"), () => goToMatch(-1)), button("↓", translate("code.next"), () => goToMatch(1)), caseButton, regexButton, findCount, button("✕", translate("code.close"), closeFind));
        const replaceRow = el("div", { class: "code-find-row code-find-replace" }, replaceInput, button(translate("code.replaceOne"), translate("code.replaceOne"), replaceCurrent), button(translate("code.replaceAll"), translate("code.replaceAll"), replaceAll));
        replaceRow.hidden = readOnly;
        findBar = el("div", { class: "code-find", attrs: { role: "search" } }, row, replaceRow);
        findBar.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeFind();
            } else if (event.key === "Enter" && event.target === findInput) {
                event.preventDefault();
                goToMatch(event.shiftKey ? -1 : 1);
            } else if (event.key === "Enter" && event.target === replaceInput) {
                event.preventDefault();
                replaceCurrent();
            }
        });
        root.insertBefore(findBar, scroller);
    }

    function openFind({ replace = false } = {}) {
        if (!findBar) buildFindBar();
        find.open = true;
        findBar.hidden = false;
        findBar.querySelector(".code-find-replace").hidden = readOnly;
        const selection = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
        if (selection && !selection.includes("\n")) {
            findInput.value = selection;
            find.query = selection;
        }
        computeMatches();
        paintFind();
        (replace && !readOnly ? replaceInput : findInput).focus();
        findInput.select?.();
    }

    function closeFind() {
        if (!findBar) return;
        find.open = false;
        findBar.hidden = true;
        setHighlight("athena-code-find", []);
        setHighlight("athena-code-find-current", []);
        textarea.focus();
    }

    /* ---- completions ---- */

    let list = null;
    let items = [];
    let activeItem = -1;
    let completionToken = 0;
    let completionTimer = 0;

    function prefixAt(offset) {
        let from = offset;
        while (from > 0 && IDENTIFIER.test(textarea.value[from - 1])) from--;
        return { from, prefix: textarea.value.slice(from, offset) };
    }

    function closeCompletions() {
        completionToken++;
        clearTimeout(completionTimer);
        if (list) list.hidden = true;
        items = [];
        activeItem = -1;
        textarea.removeAttribute("aria-activedescendant");
    }

    function paintCompletions() {
        if (!list) {
            list = el("ul", { class: "code-completions", attrs: { role: "listbox", id: `${id}-list`, "aria-label": translate("code.suggestions") } });
            list.addEventListener("mousedown", event => event.preventDefault());       // the textarea keeps the focus
            list.addEventListener("click", event => {
                const option = event.target.closest("[role=option]");
                if (option) acceptCompletion([...list.children].indexOf(option));
            });
            root.append(list);
            textarea.setAttribute("aria-controls", list.id);
            textarea.setAttribute("aria-autocomplete", "list");
        }
        list.replaceChildren(...items.map((item, index) => el("li", { class: cx("code-completion", index === activeItem && "is-active"), attrs: { role: "option", id: `${id}-option-${index}`, "aria-selected": String(index === activeItem) } },
            el("span", { class: "code-completion-label" }, item.label), item.detail ? el("span", { class: "code-completion-detail" }, item.detail) : "")));
        list.hidden = !items.length;
        if (activeItem >= 0) textarea.setAttribute("aria-activedescendant", `${id}-option-${activeItem}`);
        else textarea.removeAttribute("aria-activedescendant");
        if (items.length) {
            // under the caret, inside the editor: two CSS variables (set through the CSSOM, which a strict Content-Security-Policy allows)
            const rect = caretRect();
            const box = root.getBoundingClientRect();
            list.style.setProperty("--code-completion-top", `${Math.round(rect.bottom - box.top + 2)}px`);
            list.style.setProperty("--code-completion-left", `${Math.max(0, Math.round(rect.left - box.left))}px`);
            list.children[activeItem]?.scrollIntoView?.({ block: "nearest" });
        }
    }

    async function showCompletions(explicit) {
        if (!options.provideCompletions || readOnly || destroyed) return;
        const token = ++completionToken;
        const offset = textarea.selectionStart;
        if (offset !== textarea.selectionEnd) return closeCompletions();
        const { prefix } = prefixAt(offset);
        if (!explicit && !prefix) return closeCompletions();
        const line = lineOf(offset);
        let result;
        try {
            result = await options.provideCompletions({ value: textarea.value, position: offset, line: line + 1, lineText: lineText(line), prefix, explicit, language: getLanguage(language)?.name ?? "" });
        } catch (error) {
            console.error("Athena UI: provideCompletions failed", error);
            return closeCompletions();
        }
        if (token !== completionToken || destroyed) return;
        items = (Array.isArray(result) ? result : []).filter(item => item && typeof item.label === "string").slice(0, 50);
        activeItem = items.length ? 0 : -1;
        paintCompletions();
    }

    function maybeComplete(reason) {
        if (!options.provideCompletions || options.autoComplete === false) return;
        if (reason !== "insertText" && reason !== "deleteContentBackward") return closeCompletions();
        clearTimeout(completionTimer);
        completionTimer = setTimeout(() => showCompletions(false), 120);
    }

    function acceptCompletion(index = activeItem) {
        const item = items[index];
        if (!item) return false;
        const offset = textarea.selectionStart;
        const { from } = prefixAt(offset);
        closeCompletions();
        return applyEdit(from, offset, item.insert ?? item.label, { reason: "completion" });
    }

    /* ---- events ---- */

    let escaped = false;
    const mod = event => event.ctrlKey || event.metaKey;

    function onKeyDown(event) {
        if (event.isComposing) return;
        if (list && !list.hidden && items.length) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                activeItem = (activeItem + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
                return paintCompletions();
            }
            if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                return void acceptCompletion();
            }
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                return closeCompletions();
            }
        }
        if (event.key === "Escape") {
            if (find.open) {
                event.preventDefault();
                return closeFind();
            }
            escaped = true;
            note.textContent = translate("code.tabLeaves");
            return;
        }
        if (event.key === "Tab" && !mod(event) && !event.altKey) {
            if (escaped) {
                escaped = false;
                return;                                  // the browser moves the focus
            }
            event.preventDefault();
            if (!readOnly) (event.shiftKey ? outdentSelection() : indentSelection());
            return;
        }
        escaped = false;
        if (mod(event) && !event.altKey) {
            const key = event.key.toLowerCase();
            if (key === "z") {
                event.preventDefault();
                return void (event.shiftKey ? redo() : undo());
            }
            if (key === "y") {
                event.preventDefault();
                return void redo();
            }
            if (key === "/" || key === "÷") {
                event.preventDefault();
                return void toggleComment();
            }
            if (key === "f" || key === "h") {
                event.preventDefault();
                return openFind({ replace: key === "h" });
            }
            if (key === " ") {
                event.preventDefault();
                return void showCompletions(true);
            }
        }
        if (event.altKey && !mod(event) && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            return void moveLines(event.key === "ArrowUp" ? -1 : 1);
        }
        if (event.key === "Enter" && !mod(event) && !event.altKey && !event.shiftKey) {
            event.preventDefault();
            if (!readOnly) newLine();
        }
    }

    function onBeforeInput(event) {
        if (event.isComposing) return;
        const type = event.inputType;
        if (type === "historyUndo" || type === "historyRedo") {
            event.preventDefault();
            return void (type === "historyUndo" ? undo() : redo());
        }
        if (readOnly) return;
        if (type === "insertLineBreak" || type === "insertParagraph") {
            event.preventDefault();
            return void newLine();
        }
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        let from = start;
        let to = end;
        if (start === end) {
            if (type === "deleteContentBackward") from = Math.max(0, start - 1);
            else if (type === "deleteContentForward") to = Math.min(textarea.value.length, start + 1);
            else if (/^delete/.test(type)) {
                measure();
                from = starts[lineOf(start)];
                to = from + lineText(lineOf(start)).length + 1;
            }
        }
        if (blocked(from, to)) {
            event.preventDefault();
            return;
        }
        if (type === "insertText" && event.data?.length === 1 && typeCharacter(event.data)) return void event.preventDefault();
        if (type === "deleteContentBackward" && deletePair()) event.preventDefault();
    }

    function onInput(event) {
        if (event.inputType === "historyUndo" || event.inputType === "historyRedo") return;
        afterChange(event.inputType ?? "input", { native: true });
    }

    function afterSelection() {
        if (destroyed) return;
        markCurrentLine();
        matchBracket();
        if (find.open) paintFind();
        const offset = textarea.selectionStart;
        if (list && !list.hidden && (offset !== textarea.selectionEnd || (!prefixAt(offset).prefix && !items.length))) closeCompletions();
    }

    const onPointer = () => requestAnimationFrame(afterSelection);
    const onSelectionChange = () => {
        if (document.activeElement === textarea) afterSelection();
    };
    const onFocus = () => {
        escaped = false;
        afterSelection();
    };
    const onBlur = () => {
        escaped = false;
        setHighlight("athena-code-bracket", []);
        setTimeout(() => !destroyed && document.activeElement !== textarea && !list?.contains(document.activeElement) && closeCompletions(), 0);
    };
    const onRootClick = event => {
        // a click on the empty part under the text puts the caret at the end
        if (event.target === scroller && !readOnly) {
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            afterSelection();
        }
    };

    textarea.addEventListener("keydown", onKeyDown);
    textarea.addEventListener("beforeinput", onBeforeInput);
    textarea.addEventListener("input", onInput);
    textarea.addEventListener("keyup", onPointer);
    textarea.addEventListener("pointerup", onPointer);
    textarea.addEventListener("focus", onFocus);
    textarea.addEventListener("blur", onBlur);
    scroller.addEventListener("click", onRootClick);
    document.addEventListener("selectionchange", onSelectionChange);

    /* ---- start and the handle ---- */

    function applyModes() {
        root.classList.toggle("is-readonly", readOnly);
        root.classList.toggle("code-wrap", wrap);
        textarea.readOnly = readOnly;
        textarea.setAttribute("wrap", wrap ? "soft" : "off");
        textarea.setAttribute("aria-readonly", String(readOnly));
    }

    applyModes();
    markers = (options.markers ?? []).map(marker => ({ ...marker }));
    locked = (options.readOnlyRanges ?? []).map(range => ({ ...range }));
    render();
    remember("initial");

    const handle = asHandle({
        element: root,
        textarea,
        getValue: () => textarea.value,
        setValue(value) {
            textarea.value = String(value ?? "").replace(/\r\n?/g, "\n");
            textarea.setSelectionRange(0, 0);
            history.length = 0;
            historyIndex = -1;
            render();
            remember("initial");
            refreshFind();
            matchBracket();
            return handle;
        },
        focus: () => textarea.focus(),
        getSelection() {
            measure();
            const { line, column } = caretInfo();
            return { start: textarea.selectionStart, end: textarea.selectionEnd, line: line + 1, column: column + 1 };
        },
        setSelection(start, end = start) {
            textarea.setSelectionRange(start, end);
            afterSelection();
            revealCaret();
        },
        insertText: text => applyEdit(textarea.selectionStart, textarea.selectionEnd, String(text), { reason: "insertText" }),
        setLanguage(next) {
            language = next;
            render();
            return handle;
        },
        setReadOnly(flag = true) {
            readOnly = Boolean(flag);
            applyModes();
            if (findBar) findBar.querySelector(".code-find-replace").hidden = readOnly;
            return handle;
        },
        setWrap(flag = true) {
            wrap = Boolean(flag);
            applyModes();
            render();
            return handle;
        },
        setMarkers(next = []) {
            markers = next.filter(marker => Number.isInteger(marker?.line) && typeof marker.message === "string").map(marker => ({ level: "error", ...marker }));
            decorate();
            return handle;
        },
        setReadOnlyRanges(next = []) {
            locked = next.map(range => ({ ...range }));
            decorate();
            return handle;
        },
        undo, redo,
        canUndo: () => !readOnly && historyIndex > 0,
        canRedo: () => !readOnly && historyIndex < history.length - 1,
        openFind, closeFind, toggleComment,
        destroy() {
            if (destroyed) return;
            destroyed = true;
            clearTimeout(renderTimer);
            clearTimeout(completionTimer);
            document.removeEventListener("selectionchange", onSelectionChange);
            setHighlight("athena-code-bracket", []);
            setHighlight("athena-code-find", []);
            setHighlight("athena-code-find-current", []);
            root.classList.remove("code-editor", "is-readonly", "code-wrap", `code-tab-${tabSize}`);
            root.replaceChildren();
        }
    }, { element: root });
    return handle;
}
