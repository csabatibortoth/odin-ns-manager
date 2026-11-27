//Multiple cursors of the code editor. The textarea keeps its one real selection; the others are kept here, drawn beside it, and every edit is
//made at all of them in one step. Offsets are those of the textarea.
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

const WORD = /[\p{L}\p{N}_$]/u;

/** The word around an offset: [from, to]. */
export function wordAt(text, offset) {
    let from = offset;
    let to = offset;
    while (from > 0 && WORD.test(text[from - 1])) from--;
    while (to < text.length && WORD.test(text[to])) to++;
    return [from, to];
}

/** The next occurrence of `needle` after `start` that none of the ranges has already, going round to the top: [from, to] or null. */
export function nextOccurrence(text, needle, start, ranges) {
    if (!needle) return null;
    const taken = at => ranges.some(([from, to]) => at < to && at + needle.length > from);
    for (const [begin, end] of [[start, text.length], [0, start]]) {
        for (let at = text.indexOf(needle, begin); at !== -1 && at < end; at = text.indexOf(needle, at + 1)) if (!taken(at)) return [at, at + needle.length];
    }
    return null;
}

const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter() : null;
// whole characters as a person sees them (an emoji, a letter with its accent); without Intl.Segmenter whole code points
const characters = text => (segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text));

/** The offset one character before (step -1) or after (step 1) an offset. */
export function stepOver(value, offset, step) {
    if (step < 0) {
        if (offset <= 0) return 0;
        const line = offset < 2 ? 0 : value.lastIndexOf("\n", offset - 2) + 1;      // lastIndexOf takes -1 as 0
        return offset - characters(value.slice(line, offset)).at(-1).length;
    }
    if (offset >= value.length) return value.length;
    const end = value.indexOf("\n", offset + 1);
    return offset + characters(value.slice(offset, end === -1 ? value.length : end))[0].length;
}

/**
 * One edit at every range. `kind` is "insert" (with `text`, or a list with one text per range), "backward" or "forward".
 * @returns {{value: string, carets: number[], spans: [number, number][]}} the new text, the caret after every range (in the order of the argument),
 *          and the spans of the old text that were replaced
 */
export function editAll(value, ranges, kind, text = "") {
    const order = ranges.map(([from, to], index) => {
        if (from === to && kind === "backward") from = stepOver(value, from, -1);
        if (from === to && kind === "forward") to = stepOver(value, to, 1);
        return { from, to, index };
    }).sort((a, b) => a.from - b.from || a.to - b.to);
    let result = "";
    let at = 0;
    const carets = [];
    const spans = [];
    order.forEach((range, place) => {
        const from = Math.max(range.from, at);
        const to = Math.max(range.to, from);
        const insert = kind === "insert" ? (Array.isArray(text) ? text[place] ?? "" : text) : "";
        result += value.slice(at, from) + insert;
        carets[range.index] = result.length;
        spans.push([from, to]);
        at = to;
    });
    return { value: result + value.slice(at), carets, spans };
}
