/** What can be folded, by indentation: Map(first line -> last line), both from 0. A closing line at the outer level stays visible. */
export function foldRegions(text: any): Map<any, any>;
/** The whole text again. */
export function fullText(visible: any, folds: any): any;
/** The visible offset of the end of a line: where a fold of that line hangs. */
export function endOfLine(visible: any, line: any): any;
/** A line of the whole text -> the visible line that shows it (a folded line: the line of its fold). Lines from 0. */
export function visibleLine(folds: any, line: any): any;
/** Takes the region that starts at the visible line `line` out. Folds inside it go into its hidden text. Returns { visible, folds } or null. */
export function foldAt(visible: any, folds: any, line: any): {
    visible: string;
    folds: any[];
};
/** Puts the lines of one fold back. */
export function unfoldAt(visible: any, folds: any, line: any): {
    visible: any;
    folds: any;
};
/**
 * Where the folds are after the visible text changed from `before` to `after`: `folds` are the ones that were not touched, `broken` the ones
 * whose place was changed, and `all` both, in their order, with lines of `after`. When any is broken, put ALL of them back with one
 * fullText(after, all): putting some back first would move the lines of the others. Nothing is ever dropped.
 * `edit` ({ from, to }: the part of `before` that was replaced) should be given when it is known: comparing the texts cannot tell where
 * a line was inserted among equal lines.
 */
export function moveFolds(before: any, after: any, folds: any, edit?: any): {
    folds: any[];
    broken: any[];
    all: any;
};
export function toFull(visible: any, folds: any, offset: any): any;
export function fullLine(folds: any, line: any): any;
export function touchesFold(visible: any, folds: any, from: any, to: any, text: any): any;
