//Code folding maths of Athena UI (no DOM). The editor shows a "visible" text; every fold keeps the lines it took out of it.
//A fold is { line, hidden }: `line` is the visible line (from 0) the fold hangs under, `hidden` the text taken out, starting with "\n".
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

const indentOf = line => {
    const found = /^[ \t]*/.exec(line)[0];
    return found.length === line.length ? -1 : found.replace(/\t/g, "    ").length;      // -1: a blank line
};

/** What can be folded, by indentation: Map(first line -> last line), both from 0. A closing line at the outer level stays visible. */
export function foldRegions(text) {
    const lines = text.split("\n");
    const regions = new Map();
    const open = [];                 // [line, indent] of the lines that may still start a region
    let last = -1;                   // the last line with text
    const close = indent => {
        while (open.length && open.at(-1)[1] >= indent) {
            const [line] = open.pop();
            if (last > line) regions.set(line, last);
        }
    };
    lines.forEach((content, index) => {
        const indent = indentOf(content);
        if (indent < 0) return;
        close(indent);
        open.push([index, indent]);
        last = index;
    });
    close(0);
    return regions;
}

/** The whole text again. */
export function fullText(visible, folds) {
    if (!folds.length) return visible;
    const lines = visible.split("\n");
    for (const fold of folds) lines[fold.line] += fold.hidden;
    return lines.join("\n");
}

/** The visible offset of the end of a line: where a fold of that line hangs. */
export function endOfLine(visible, line) {
    let at = -1;
    for (let i = 0; i <= line; i++) {
        at = visible.indexOf("\n", at + 1);
        if (at === -1) return visible.length;
    }
    return at;
}

/** A visible offset in the whole text. */
export const toFull = (visible, folds, offset) => folds.reduce((at, fold) => (offset > endOfLine(visible, fold.line) ? at + fold.hidden.length : at), offset);

/** A line of the whole text -> the visible line that shows it (a folded line: the line of its fold). Lines from 0. */
export function visibleLine(folds, line) {
    let hiddenBefore = 0;
    for (const fold of folds) {
        const start = fold.line + hiddenBefore;                   // the full line of the fold
        const count = fold.hidden.split("\n").length - 1;
        if (line <= start) break;
        if (line <= start + count) return fold.line;
        hiddenBefore += count;
    }
    return line - hiddenBefore;
}

/** A visible line -> its line in the whole text. */
export const fullLine = (folds, line) => folds.reduce((at, fold) => (fold.line < line ? at + fold.hidden.split("\n").length - 1 : at), line);

/** Takes the region that starts at the visible line `line` out. Folds inside it go into its hidden text. Returns { visible, folds } or null. */
export function foldAt(visible, folds, line) {
    if (folds.some(fold => fold.line === line)) return null;
    const lines = visible.split("\n");
    const merged = lines.map((content, index) => content + (folds.find(fold => fold.line === index)?.hidden ?? ""));
    const whole = merged.join("\n");
    const first = fullLine(folds, line);
    const last = foldRegions(whole).get(first);
    if (last === undefined) return null;
    const lastVisible = visibleLine(folds, last);
    const taken = merged.slice(line + 1, lastVisible + 1);
    const hidden = (folds.find(fold => fold.line === line)?.hidden ?? "") + `\n${taken.join("\n")}`;
    const removed = lastVisible - line;
    const rest = folds.filter(fold => fold.line < line || fold.line > lastVisible).map(fold => (fold.line > line ? { ...fold, line: fold.line - removed } : fold));
    return {
        visible: [...lines.slice(0, line + 1), ...lines.slice(lastVisible + 1)].join("\n"),
        folds: [...rest, { line, hidden }].sort((a, b) => a.line - b.line)
    };
}

/** Puts the lines of one fold back. */
export function unfoldAt(visible, folds, line) {
    const fold = folds.find(item => item.line === line);
    if (!fold) return null;
    const lines = visible.split("\n");
    const added = fold.hidden.split("\n").length - 1;
    lines[line] += fold.hidden;
    return { visible: lines.join("\n"), folds: folds.filter(item => item !== fold).map(item => (item.line > line ? { ...item, line: item.line + added } : item)) };
}

/**
 * Where the folds are after the visible text changed from `before` to `after`: `folds` are the ones that were not touched, `broken` the ones
 * whose place was changed, and `all` both, in their order, with lines of `after`. When any is broken, put ALL of them back with one
 * fullText(after, all): putting some back first would move the lines of the others. Nothing is ever dropped.
 * `edit` ({ from, to }: the part of `before` that was replaced) should be given when it is known: comparing the texts cannot tell where
 * a line was inserted among equal lines.
 */
export function moveFolds(before, after, folds, edit = null) {
    const limit = Math.min(before.length, after.length);
    let head = edit?.from ?? 0;
    let tail = edit ? before.length - edit.to : 0;
    if (!edit) {
        while (head < limit && before[head] === after[head]) head++;
        while (tail < limit - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
    }
    const count = text => text.split("\n").length;
    const delta = count(after) - count(before);
    const changedLine = count(after.slice(0, head)) - 1;       // the line of `after` where the change begins
    const kept = [];
    const broken = [];
    const all = folds.map(fold => {
        const end = endOfLine(before, fold.line);
        if (end >= before.length - tail) {
            kept.push({ ...fold, line: fold.line + delta });
            return kept.at(-1);
        }
        if (end < head) {
            kept.push(fold);
            return fold;
        }
        // its line break was changed: under what is left of its line (the line where the change begins, when the start of its line went too)
        broken.push({ ...fold, line: Math.min(fold.line, changedLine) });
        return broken.at(-1);
    });
    return { folds: kept, broken, all };
}

/** Would replacing [from, to) of the visible text by `text` delete or split a fold? Then the fold has to be opened first. */
export const touchesFold = (visible, folds, from, to, text) => folds.find(fold => {
    const end = endOfLine(visible, fold.line);
    if (to > from) return from <= end && to > end;
    return text.includes("\n") && from === end;
});
