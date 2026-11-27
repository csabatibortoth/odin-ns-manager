/** The word around an offset: [from, to]. */
export function wordAt(text: any, offset: any): any[];
/** The next occurrence of `needle` after `start` that none of the ranges has already, going round to the top: [from, to] or null. */
export function nextOccurrence(text: any, needle: any, start: any, ranges: any): any[];
/** The offset one character before (step -1) or after (step 1) an offset. */
export function stepOver(value: any, offset: any, step: any): any;
/**
 * One edit at every range. `kind` is "insert" (with `text`, or a list with one text per range), "backward" or "forward".
 * @returns {{value: string, carets: number[], spans: [number, number][]}} the new text, the caret after every range (in the order of the argument),
 *          and the spans of the old text that were replaced
 */
export function editAll(value: any, ranges: any, kind: any, text?: string): {
    value: string;
    carets: number[];
    spans: [number, number][];
};
