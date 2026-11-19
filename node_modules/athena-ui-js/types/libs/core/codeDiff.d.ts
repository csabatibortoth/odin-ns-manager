/**
 * The difference between two lists of lines, as operations in order. `a` and `b` are indexes into the two lists.
 * When the two lists differ by more than `maxEdits` lines the result is coarse (everything removed, then everything added) instead of slow.
 *
 * @param {string[]} oldLines
 * @param {string[]} newLines
 * @param {{maxEdits?: number}} [options]
 * @returns {DiffOp[]}
 */
export function diffLines(oldLines: string[], newLines: string[], { maxEdits }?: {
    maxEdits?: number;
}): DiffOp[];
/**
 * Groups the operations into hunks that show `context` unchanged lines around each change (Infinity: everything is one hunk).
 * @returns {{ops: DiffOp[], skippedBefore: number}[]} `skippedBefore` is the number of unchanged lines left out before the hunk
 */
export function hunksOf(ops: any, context?: number): {
    ops: DiffOp[];
    skippedBefore: number;
}[];
export function splitLines(text: any): string[];
export type DiffOp = {
    type: "equal";
    a: number;
    b: number;
} | {
    type: "remove";
    a: number;
} | {
    type: "add";
    b: number;
};
