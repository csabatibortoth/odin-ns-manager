//Code editor of Athena UI: a real <textarea> (native input, selection, mobile keyboards and IME keep working, screen readers read it) with the
//highlighted code behind it. The textarea shows nothing but the caret and the selection, the highlighted <pre> shows the text, and both sit in one scroller.
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { asHandle, cx, el, resolveElement, uid } from "../../core/dom.js";
import { translate } from "../../core/i18n.js";
import { getLanguage, tokenize } from "../../core/codeLanguages.js";
import { lineNodes, tokensToLines } from "./codeGenerator.js";
import { foldAt, foldRegions, fullLine, fullText, moveFolds, toFull, touchesFold, unfoldAt, visibleLine } from "../../core/codeFolding.js";
import { createMinimap } from "./minimap.js";
import { editAll, nextOccurrence, stepOver, wordAt } from "./multiCursor.js";

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
 * @param {Array<{from: number, to: number}|{text: string}>} [options.readOnlyRanges] what cannot be changed: lines (1-based, inclusive), or a piece of text (its first
 *        occurrence when it is set; it stays locked where it is while the text around it changes)
 * @param {(context: {value: string, position: number, line: number, lineText: string, prefix: string, explicit: boolean, language: string}) => (Array<{label: string, insert?: string, detail?: string}>|Promise<Array>)} [options.provideCompletions]
 * @param {boolean} [options.autoComplete=true] with provideCompletions: suggest while typing (otherwise only with Ctrl+Space)
 * @param {boolean} [options.folding=false] (needs lineNumbers) blocks can be folded by indentation: a click on the arrow beside the line number, Ctrl+Shift+[ and ].
 *        getValue() and onChange always give the whole text; an edit that would touch folded lines opens them first. Off while there are readOnlyRanges.
 * @param {boolean} [options.minimap=false] a small picture of the whole text beside it (hidden in a narrow editor)
 * @param {boolean} [options.multipleCursors=false] Ctrl+D selects the next occurrence, Ctrl+Alt+Up / Down or Alt+click adds a cursor, Escape goes back to one
 * @param {(value: string, reason: string) => void} [options.onChange] after every change made by typing, undo, redo, replace ... (not after setValue)
 * @returns the handle: { element, textarea, getValue, setValue, focus, getSelection, setSelection, insertText, setLanguage, setReadOnly, setWrap, setMarkers,
 *          setReadOnlyRanges, undo, redo, canUndo, canRedo, openFind, closeFind, toggleComment,
 *          fold, unfold, foldAll, unfoldAll, getCursorCount, destroy }
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
    const minimap = options.minimap ? createMinimap(scroller) : null;
    const body = el("div", { class: "code-editor-body" }, scroller, minimap?.element ?? null);
    root.classList.toggle("has-folding", Boolean(options.folding) && lineNumbers);
    root.classList.toggle("has-minimap", Boolean(options.minimap));
    root.replaceChildren(body, status, hint);
    status.hidden = options.statusBar === false;
    textarea.value = String(options.value ?? "").replace(/\r\n?/g, "\n");

    /* ---- folding: the textarea holds the visible text, every fold keeps the lines it took out ---- */

    let folds = [];
    let foldedVisible = "";          // the visible text the folds belong to
    let regions = new Map();
    const canFold = () => Boolean(options.folding) && lineNumbers && !plain && !locked.length;
    const whole = () => fullText(textarea.value, folds);

    function showVisible(next, selection) {
        const scroll = scroller.scrollTop;
        folds = next.folds;
        textarea.value = foldedVisible = next.visible;
        if (selection !== undefined) textarea.setSelectionRange(selection[0], selection[1]);
        relocate();       // the next edit by the browser is measured against this text
        render();
        scroller.scrollTop = scroll;
    }

    /** Opens every fold; the selection stays on the same text. */
    function unfoldAll() {
        if (!folds.length) return false;
        const start = toFull(textarea.value, folds, textarea.selectionStart);
        const end = toFull(textarea.value, folds, textarea.selectionEnd);
        showVisible({ visible: whole(), folds: [] }, [start, end]);
        return true;
    }

    function unfoldLine(line) {
        const next = unfoldAt(textarea.value, folds, line);
        if (!next) return false;
        const map = offset => toFull(textarea.value, folds.filter(fold => fold.line === line), offset);
        showVisible(next, [map(textarea.selectionStart), map(textarea.selectionEnd)]);
        note.textContent = translate("code.unfolded");
        return true;
    }

    function foldLine(line) {
        if (!canFold()) return false;
        clearCursors();
        if (find.open) closeFind();
        const next = foldAt(textarea.value, folds, line);
        if (!next) return false;
        const header = next.visible.split("\n").slice(0, line + 1).join("\n").length;
        const caret = Math.min(textarea.selectionStart, header);
        showVisible(next, [caret, caret]);
        note.textContent = translate("code.folded", { count: folds.find(fold => fold.line === line).hidden.split("\n").length - 1 });
        return true;
    }

    /** The folds follow a change of the visible text; one whose place was changed is opened where it was. */
    function followFolds() {
        if (!folds.length) {
            foldedVisible = textarea.value;
            return;
        }
        if (textarea.value === foldedVisible) return;
        const moved = moveFolds(foldedVisible, textarea.value, folds, edit?.length === textarea.value.length ? edit : null);
        folds = moved.folds;
        if (moved.broken.length) {
            // one of them was disturbed: ALL are opened, in one step
            const caret = toFull(textarea.value, moved.all, textarea.selectionStart);
            textarea.value = fullText(textarea.value, moved.all);
            textarea.setSelectionRange(caret, caret);
            folds = [];
        }
        foldedVisible = textarea.value;
    }

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
        const spans = [];
        for (const token of tokenize(text, language, spans)) {
            token.text.split("\n").forEach((part, index) => {
                if (index > 0) lines.push([]);
                if (part) lines.at(-1).push({ type: token.type, text: part });
            });
        }
        const inside = [];
        let at = 0;
        let span = 0;
        for (const line of text.split("\n")) {
            // a match that ends exactly where the text ends has taken the last newline: the empty last line is still inside it
            while (span < spans.length && spans[span].end <= at && !(spans[span].end === at && at === text.length)) span++;
            inside.push(span < spans.length && spans[span].start < at);
            at += line.length + 1;
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
        const digits = `code-digits-${Math.min(7, String(fullLine(folds, starts.length - 1) + 1).length)}`;
        pre.classList.add(digits);
        // the textarea starts its text where the highlighted text starts: it needs the width of the numbers too
        textarea.className = `code-editor-input ${digits}`;
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
            minimap?.draw([]);
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
        // Rules look around: is this "/" a division (what stands before it), is this name a function (what follows it)? So the line with text
        // before the change and the one after it are drawn again too, and the tokenizer gets one more line before them, only to read.
        const restart = line => {
            while (line > 0 && insideAtStart[line]) line--;
            return line;
        };
        const previous = line => {
            let at = line - 1;
            while (at > 0 && !lineText(at).trim()) at--;
            return restart(Math.max(at, 0));
        };
        let first = restart(lineOf(head));
        if (first > 0) first = previous(first);
        const context = first > 0 ? previous(first) : 0;
        let last = lineOf(text.length - tail) + 1;
        while (last < count && !lineText(last).trim()) last++;
        if (last < count) last++;
        let step = 1;
        for (;;) {
            while (last < count && insideAtStart[last - delta]) last++;
            // and past the end, up to the next line with text, again only to read: is the name at the end of this part followed by "("?
            let ahead = last;
            while (ahead < count && !lineText(ahead).trim()) ahead++;
            ahead = Math.min(count, ahead + 1);
            const read = tokenLines(text.slice(starts[context], ahead < count ? starts[ahead] - 1 : text.length));
            const fresh = { lines: read.lines.slice(first - context, last - context), inside: read.inside.slice(first - context, last - context) };
            const lastToken = fresh.lines.at(-1).at(-1);
            if (last < count && (read.inside[last - context] || lastToken && (lastToken.type === "comment" || lastToken.type === "string" || lastToken.type === "meta"))) {
                last = Math.min(count, last + step);      // it may run on: look further (doubling, so a long comment does not cost much more)
                step *= 2;
                continue;
            }
            let from = first;
            let to = last - delta;
            const same = (drawn, index) => insideAtStart[drawn] === fresh.inside[index] && lineTokens[drawn].length === fresh.lines[index].length
                && lineTokens[drawn].every((token, i) => token.type === fresh.lines[index][i].type && token.text === fresh.lines[index][i].text);
            let begin = 0;
            let stop = fresh.lines.length;
            while (begin < stop - 1 && from < to - 1 && same(from, begin)) { from++; begin++; }
            while (stop > begin + 1 && to > from + 1 && same(to - 1, stop - 1)) { to--; stop--; }
            replaceLines(from, to, { lines: fresh.lines.slice(begin, stop), inside: fresh.inside.slice(begin, stop) });
            break;
        }
        decorate();
    }

    function scheduleRender() {
        if (textarea.value.length <= 60000) return render();
        if (!renderTimer) renderTimer = setTimeout(() => {
            if (destroyed) return;
            render();
            matchBracket();
        }, 120);
    }

    /* ---- decorations: caret line, markers, locked lines ---- */

    let markers = [];
    let locked = [];
    let currentNode = null;
    let decorated = [];                     // [node, classes] of the lines that carry a marker or are locked

    function decorate() {
        if (locked.length) relocate();
        if (plain) return;
        for (const [node, classes] of decorated) node.classList.remove(...classes);
        decorated = [];
        const wanted = new Map();
        const add = (index, ...classes) => wanted.set(index, [...(wanted.get(index) ?? []), ...classes]);
        const seen = new Set();
        for (const marker of [...markers.filter(item => item.level === "error"), ...markers.filter(item => item.level !== "error")]) {
            if (seen.has(marker.line)) continue;
            seen.add(marker.line);
            add(visibleLine(folds, marker.line - 1), "has-marker", `marker-${marker.level ?? "error"}`);
        }
        if (canFold()) {
            regions = foldRegions(textarea.value);
            for (const line of regions.keys()) add(line, "is-foldable");
            for (const fold of folds) add(fold.line, "is-foldable", "is-folded");
        }
        for (const range of locked) {
            const at = anchors.get(range) ?? -1;
            if (at >= 0) for (let line = lineOf(at); line <= lineOf(at + range.text.length - 1); line++) add(line, "has-locked-text");
        }
        for (const range of locked.filter(item => typeof item.text !== "string")) for (let line = Math.max(1, range.from); line <= Math.min(range.to, nodes.length); line++) add(line - 1, "is-locked-line");
        for (const [index, classes] of wanted) {
            const node = nodes[index];
            if (!node) continue;
            node.classList.add(...classes);
            decorated.push([node, classes]);
        }
        // the line numbers go on after the folded lines: a custom property through the CSSOM, which a strict Content-Security-Policy allows
        for (const fold of folds) nodes[fold.line]?.style.setProperty("--code-hidden", String(fold.hidden.split("\n").length - 1));
        minimap?.draw(lineTokens);
        paintCursors();
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
        const shown = fullLine(folds, line) + 1;
        position.textContent = translate("code.position", { line: shown, column: column + 1 });
        const marker = markers.find(entry => entry.line === shown);
        const message = marker ? translate("code.marker", { line: shown, message: marker.message }) : "";
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
        if (plain || renderedText !== text || caret !== textarea.selectionEnd) return setHighlight("athena-code-bracket", []);
        // which characters are in a string or a comment, line by line, worked out when a line is first looked at
        const masks = new Map();
        const quoted = offset => {
            const index = lineOf(offset);
            let ranges = masks.get(index);
            if (!ranges) {
                ranges = [];
                let at = starts[index];
                for (const token of lineTokens[index] ?? []) {
                    if (token.type === "string" || token.type === "comment") ranges.push([at, at + token.text.length]);
                    at += token.text.length;
                }
                masks.set(index, ranges);
            }
            return ranges.find(([from, to]) => offset >= from && offset < to);
        };
        for (const at of [caret - 1, caret]) {
            const char = text[at];
            const forward = OPEN_TO_CLOSE[char];
            const backward = CLOSE_TO_OPEN[char];
            if (!forward && !backward) continue;
            let depth = 0;
            const home = quoted(at);      // a bracket in a string matches within that string, one in code only against code
            for (let i = at; forward ? i < text.length : i >= 0; i += forward ? 1 : -1) {
                if (text[i] !== char && text[i] !== (forward ?? backward)) continue;
                if (quoted(i)?.[0] !== home?.[0]) continue;
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
        relocate();
        return { value: whole(), start: toFull(textarea.value, folds, textarea.selectionStart), end: toFull(textarea.value, folds, textarea.selectionEnd), anchors: new Map(anchors) };
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
        // an undone or redone text is shown whole
        folds = [];
        clearCursors();
        textarea.value = foldedVisible = entry.value;
        // undo and redo put the locked texts back where they were in that state
        for (const [range, at] of entry.anchors) anchors.set(range, at);
        anchoredValue = entry.value;
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

    /* ---- multiple cursors: the textarea has the real one, the others are [from, to] here ---- */

    let extras = [];
    let cursorLayer = null;
    let altFrom = null;
    const multi = Boolean(options.multipleCursors);

    function paintCursors() {
        if (!multi) return;
        cursorLayer ??= scroller.appendChild(el("div", { class: "code-editor-cursors", attrs: { "aria-hidden": "true" } }));
        const box = cursorLayer.getBoundingClientRect();
        cursorLayer.replaceChildren(...(plain ? [] : extras).map(([, to]) => {
            const rect = caretRect(to);
            const caret = el("span", { class: "code-editor-cursor" });
            caret.style.setProperty("--code-cursor-top", `${rect.top - box.top}px`);
            caret.style.setProperty("--code-cursor-left", `${rect.left - box.left}px`);
            return caret;
        }));
        setHighlight("athena-code-cursors", plain ? [] : extras.filter(([from, to]) => to > from).map(([from, to]) => rangeBetween(from, to)).filter(Boolean));
    }

    function setCursors(next) {
        extras = next.slice(0, 500);
        paintCursors();
        note.textContent = extras.length ? translate("code.cursors", { count: extras.length + 1 }) : "";
    }

    function clearCursors() {
        if (extras.length) setCursors([]);
    }

    const primary = () => [textarea.selectionStart, textarea.selectionEnd];

    function addNextOccurrence() {
        unfoldAll();
        measure();
        const [from, to] = primary();
        if (from === to) {
            const [start, end] = wordAt(textarea.value, from);
            textarea.setSelectionRange(start, end);
            return afterSelection();
        }
        const found = nextOccurrence(textarea.value, textarea.value.slice(from, to), to, [primary(), ...extras]);
        if (!found) return;
        // the new one becomes the real selection, so it is the one in view
        setCursors([...extras, [from, to]]);
        textarea.setSelectionRange(found[0], found[1]);
        revealCaret();
        markCurrentLine();
    }

    function addCursorOnLine(direction) {
        unfoldAll();
        measure();
        const offset = textarea.selectionStart;
        const line = lineOf(offset);
        const target = line + direction;
        if (target < 0 || target >= starts.length) return;
        let at = starts[target] + Math.min(offset - starts[line], lineText(target).length);
        if (/[\uDC00-\uDFFF]/.test(textarea.value[at] ?? "")) at--;       // not into the middle of a character
        setCursors([...extras.filter(([from]) => from !== at), primary()]);
        textarea.setSelectionRange(at, at);
        revealCaret();
        markCurrentLine();
    }

    /** One edit at every cursor, one undo step. A cursor in something locked stops all of it. */
    function editCursors(kind, text, reason) {
        if (readOnly) return;
        // cursors exist only in an unfolded text (offsets are those of the textarea); should folds be there all the same, nothing is edited
        if (folds.length) {
            clearCursors();
            unfoldAll();
            return;
        }
        const ranges = [primary(), ...extras];
        const result = editAll(textarea.value, ranges, kind, text);
        if (result.spans.some(([from, to]) => blocked(from, to))) return;
        relocate();
        for (const [range, start] of anchors) {
            if (start >= 0) anchors.set(range, result.spans.reduce((moved, [from, to], i) => (to <= start ? moved + (Array.isArray(text) ? text[i] ?? "" : kind === "insert" ? text : "").length - (to - from) : moved), start));
        }
        textarea.value = result.value;
        anchoredValue = result.value;
        const [main, ...rest] = result.carets;
        textarea.setSelectionRange(main, main);
        extras = [...new Set(rest)].filter(at => at !== main).map(at => [at, at]);
        afterChange(reason);
        paintCursors();
    }

    /** Keys while there are several cursors, and the keys that make them. Returns true when the key was used. */
    function cursorKey(event) {
        if (!multi || plain) return false;
        if (mod(event) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "d") addNextOccurrence();
        else if (mod(event) && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) addCursorOnLine(event.key === "ArrowUp" ? -1 : 1);
        else if (!extras.length) return false;
        else if (event.key === "Escape") clearCursors();
        else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !mod(event) && !event.shiftKey && !event.altKey) {
            const step = event.key === "ArrowLeft" ? -1 : 1;
            const move = ([from, to]) => {
                const at = from !== to ? (step < 0 ? from : to) : stepOver(textarea.value, to, step);
                return [at, at];
            };
            textarea.setSelectionRange(...move(primary()));
            setCursors(extras.map(move));
        } else if (event.key === "Enter" && !mod(event)) editCursors("insert", "\n", "newline");
        else if (event.key === "Backspace" || event.key === "Delete") editCursors(event.key === "Backspace" ? "backward" : "forward", "", "delete");
        else {
            // anything that moves or does something else goes back to one cursor
            if (!["Shift", "Control", "Alt", "Meta"].includes(event.key) && (event.key.length > 1 || mod(event)) && !(mod(event) && "cx".includes(event.key.toLowerCase()))) clearCursors();
            return false;
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    function onPaste(event) {
        if (!extras.length || readOnly) return;
        const text = event.clipboardData?.getData("text/plain")?.replace(/\r\n?/g, "\n");
        if (text === undefined) return;
        event.preventDefault();
        const lines = text.split("\n");
        editCursors("insert", lines.length === extras.length + 1 ? lines : text, "paste");       // one line each, when there are as many
    }

    /* ---- changes ---- */

    let anchors = new Map();               // the place of every { text } range
    let anchoredValue = "";
    let selectionBefore = null;            // where the selection was before the browser changed the text
    let edit = null;                       // the change that was just made: [from, to) of the old text, and the new length

    /** What the browser replaced, from the selection before and the caret after. Null when that does not explain the new text. */
    function nativeEdit() {
        const value = textarea.value;
        const caret = textarea.selectionStart;
        if (selectionBefore === null) return null;
        const from = Math.min(selectionBefore, caret);
        const to = caret - (value.length - anchoredValue.length);
        const fits = to >= from && value.slice(0, from) === anchoredValue.slice(0, from) && value.slice(caret) === anchoredValue.slice(to);
        return fits ? { from, to, length: value.length } : null;
    }

    /** Keeps the { text } ranges where they are: a change before one moves it by as much as the text grew or shrank. */
    function relocate(fresh = false) {
        const value = textarea.value;
        if (fresh) anchors = new Map();
        else if (value === anchoredValue) return;
        // the edit says where the text changed; comparing the two texts cannot (a copy typed in front of a locked text looks like text added after it)
        const known = edit?.length === value.length ? edit : null;
        edit = null;
        let head = 0;
        while (head < value.length && head < anchoredValue.length && value[head] === anchoredValue[head]) head++;
        const delta = value.length - anchoredValue.length;
        for (const range of locked) {
            if (typeof range.text !== "string" || !range.text) continue;
            let at = anchors.get(range) ?? -1;
            if (at < 0) at = value.indexOf(range.text);
            else {
                if (known ? known.to <= at : head < at + range.text.length) at += delta;
                if (!value.startsWith(range.text, at)) at = value.indexOf(range.text);
            }
            anchors.set(range, at);
        }
        anchoredValue = value;
    }

    /** [start, end, isText] of everything that is locked. */
    function lockedSpans() {
        measure();
        relocate();
        return locked.map(range => {
            if (typeof range.text === "string") {
                const at = anchors.get(range) ?? -1;
                return at < 0 ? null : [at, at + range.text.length, true];
            }
            const first = Math.max(0, range.from - 1);
            const last = Math.min(starts.length - 1, range.to - 1);
            return first < starts.length ? [starts[first], starts[last] + lineText(last).length] : null;
        }).filter(Boolean);
    }

    /** Would a change of [from, to) touch something locked? An insertion is from === to. Next to a locked text one may type; at the end of a locked line one may not. */
    const blocked = (from, to) => lockedSpans().some(([start, end, isText]) => (isText ? from < end && to > start : from <= end && to >= start));

    function afterChange(reason, { remembered = false, native = false } = {}) {
        followFolds();
        scheduleRender();
        if (!remembered) remember(reason);
        measure();
        decorate();
        refreshFind();
        matchBracket();
        // The browser scrolls to the caret by itself while the person types; our own edits (Tab, Enter, replace, undo ...) do it here, once per frame
        // (measuring the caret makes the browser lay the whole text out, which is the expensive part of a big file)
        if (!native) requestAnimationFrame(() => !destroyed && revealCaret());
        options.onChange?.(whole(), reason);
        maybeComplete(reason);
    }

    /** Replaces [from, to) by text and puts the selection where it says (default: after the text). */
    function applyEdit(from, to, text, { select = [from + text.length, from + text.length], reason = "edit" } = {}) {
        if (readOnly) return false;
        const folded = folds.length && touchesFold(textarea.value, folds, from, to, text);
        if (folded) {
            // text that nobody sees is never deleted: a replacement only opens the fold, an insertion goes where it was meant
            if (to > from) {
                unfoldLine(folded.line);
                return false;
            }
            const at = toFull(textarea.value, folds, from);
            unfoldAll();
            select = [select[0] + at - from, select[1] + at - from];
            from = to = at;
        }
        if (blocked(from, to)) return false;
        const value = textarea.value;
        relocate();
        textarea.value = value.slice(0, from) + text + value.slice(to);
        edit = { from, to, length: textarea.value.length };
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
        const changes = [];
        for (const match of find.matches) {
            if (blocked(match.start, match.end)) continue;
            const replacement = find.regex ? match.text.replace(new RegExp(find.query, find.matchCase ? "" : "i"), find.replacement) : find.replacement;
            result += value.slice(at, match.start) + replacement;
            at = match.end;
            changes.push({ end: match.end, delta: replacement.length - (match.end - match.start) });
        }
        result += value.slice(at);
        if (result === value) return;
        // Not applyEdit: this is many changes in one undo step, none of them in something locked. Every locked text moves by what changed before it.
        relocate();
        for (const [range, start] of anchors) {
            if (start >= 0) anchors.set(range, changes.reduce((to, change) => (change.end <= start ? to + change.delta : to), start));
        }
        textarea.value = result;
        anchoredValue = result;
        textarea.setSelectionRange(0, 0);
        afterChange("replace-all");
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
        root.insertBefore(findBar, body);
    }

    function openFind({ replace = false } = {}) {
        unfoldAll();
        clearCursors();
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
        if (cursorKey(event)) return;
        if (options.folding && mod(event) && event.shiftKey && (event.code === "BracketLeft" || event.code === "BracketRight")) {
            event.preventDefault();
            measure();
            let line = lineOf(textarea.selectionStart);
            if (event.code === "BracketRight") return void unfoldLine(line);
            while (line >= 0 && !(regions.get(line) >= lineOf(textarea.selectionStart))) line--;      // the innermost block around the caret
            if (line >= 0) foldLine(line);
            return;
        }
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
        selectionBefore = textarea.selectionStart;
        // an edit that cannot be stopped happens to the text as it is: nothing may change that text now, or the edit lands somewhere else
        // (opening a fold here would let it overwrite lines that were hidden). followFolds puts the folds right afterwards.
        if (event.isComposing || !event.cancelable) return clearCursors();
        const type = event.inputType;
        if (type === "historyUndo" || type === "historyRedo") {
            event.preventDefault();
            return void (type === "historyUndo" ? undo() : redo());
        }
        if (readOnly) return;
        if (extras.length) {
            const kind = type === "deleteContentBackward" ? "backward" : type === "deleteContentForward" ? "forward" : type === "insertText" || type === "insertLineBreak" ? "insert" : null;
            if (kind) {
                event.preventDefault();
                return editCursors(kind, type === "insertLineBreak" ? "\n" : event.data ?? "", type);
            }
            clearCursors();
        }
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
        const folded = folds.length && touchesFold(textarea.value, folds, from, to, event.data ?? "");
        if (folded) {
            event.preventDefault();
            return void unfoldLine(folded.line);
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
        edit = nativeEdit();
        selectionBefore = null;
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

    const onPointerDown = event => {
        if (event.button !== 0) return;
        if (canFold() && event.clientX - textarea.getBoundingClientRect().left < Number.parseFloat(getComputedStyle(textarea).paddingLeft)) {
            const line = nodes.findIndex(node => {
                const rect = node.getBoundingClientRect();
                return event.clientY >= rect.top && event.clientY < rect.bottom;
            });
            if (line >= 0 && (regions.has(line) || folds.some(fold => fold.line === line))) {
                event.preventDefault();
                if (!unfoldLine(line)) foldLine(line);
                return;
            }
        }
        // where the cursor is now, as a place in the whole text: the next one is only possible with everything open
        if (multi && event.altKey) altFrom = primary().map(offset => toFull(textarea.value, folds, offset));
        else clearCursors();
    };
    const onPointerUp = () => {
        const before = altFrom;
        altFrom = null;
        if (before) {
            requestAnimationFrame(() => {
                if (destroyed) return;
                unfoldAll();      // keeps the new cursor on the same text
                setCursors([...extras, before]);
            });
        }
    };
    textarea.addEventListener("pointerdown", onPointerDown);
    textarea.addEventListener("pointerup", onPointerUp);
    textarea.addEventListener("paste", onPaste);
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
    relocate(true);
    render();
    remember("initial");

    const handle = asHandle({
        element: root,
        textarea,
        getValue: whole,
        setValue(value) {
            folds = [];
            clearCursors();
            textarea.value = String(value ?? "").replace(/\r\n?/g, "\n");
            textarea.setSelectionRange(0, 0);
            foldedVisible = textarea.value;
            history.length = 0;
            historyIndex = -1;
            relocate(true);
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
            return { start: toFull(textarea.value, folds, textarea.selectionStart), end: toFull(textarea.value, folds, textarea.selectionEnd), line: fullLine(folds, line) + 1, column: column + 1 };
        },
        setSelection(start, end = start) {
            unfoldAll();      // offsets are those of the whole text
            clearCursors();
            textarea.setSelectionRange(start, end);
            afterSelection();
            revealCaret();
        },
        insertText: text => (clearCursors(), applyEdit(textarea.selectionStart, textarea.selectionEnd, String(text), { reason: "insertText" })),
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
            if (next.length) unfoldAll();
            locked = next.map(range => ({ ...range }));
            relocate(true);
            decorate();
            return handle;
        },
        undo, redo,
        canUndo: () => !readOnly && historyIndex > 0,
        canRedo: () => !readOnly && historyIndex < history.length - 1,
        openFind, closeFind, toggleComment,
        /** Folds the block that starts at a line of the whole text (from 1). */
        fold: line => foldLine(visibleLine(folds, line - 1)),
        unfold: line => unfoldLine(visibleLine(folds, line - 1)),
        /** Folds every outermost block. */
        foldAll() {
            unfoldAll();
            if (!canFold()) return false;
            const outer = [];
            let covered = -1;
            for (const [first, last] of [...foldRegions(textarea.value)].sort((a, b) => a[0] - b[0])) {
                if (first <= covered) continue;
                outer.push(first);
                covered = last;
            }
            for (const line of outer.reverse()) foldLine(line);
            return outer.length > 0;
        },
        unfoldAll,
        getCursorCount: () => extras.length + 1,
        destroy() {
            minimap?.destroy();
            setHighlight("athena-code-cursors", []);
            if (destroyed) return;
            destroyed = true;
            clearTimeout(renderTimer);
            clearTimeout(completionTimer);
            document.removeEventListener("selectionchange", onSelectionChange);
            setHighlight("athena-code-bracket", []);
            setHighlight("athena-code-find", []);
            setHighlight("athena-code-find-current", []);
            root.classList.remove("code-editor", "is-readonly", "code-wrap", "has-folding", "has-minimap", `code-tab-${tabSize}`);
            root.replaceChildren();
        }
    }, { element: root });
    return handle;
}
