//Line diff of Athena UI (no DOM): the shortest edit script between two lists of lines (Myers), after the common start and end are cut off.
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

/**
 * @typedef {{type: "equal", a: number, b: number} | {type: "remove", a: number} | {type: "add", b: number}} DiffOp
 */

/** Splits text into lines the way an editor counts them (a text that ends with a newline has a last empty line). */
export const splitLines = text => String(text ?? "").replace(/\r\n?/g, "\n").split("\n");

/**
 * The difference between two lists of lines, as operations in order. `a` and `b` are indexes into the two lists.
 * When the two lists differ by more than `maxEdits` lines the result is coarse (everything removed, then everything added) instead of slow.
 *
 * @param {string[]} oldLines
 * @param {string[]} newLines
 * @param {{maxEdits?: number}} [options]
 * @returns {DiffOp[]}
 */
export function diffLines(oldLines, newLines, { maxEdits = 3000 } = {}) {
    let start = 0;
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
    let endOld = oldLines.length;
    let endNew = newLines.length;
    while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
        endOld--;
        endNew--;
    }
    const ops = [];
    for (let i = 0; i < start; i++) ops.push({ type: "equal", a: i, b: i });
    for (const op of myers(oldLines.slice(start, endOld), newLines.slice(start, endNew), maxEdits)) {
        ops.push(op.type === "equal" ? { type: "equal", a: op.a + start, b: op.b + start } : op.type === "remove" ? { type: "remove", a: op.a + start } : { type: "add", b: op.b + start });
    }
    for (let i = 0; i < oldLines.length - endOld; i++) ops.push({ type: "equal", a: endOld + i, b: endNew + i });
    return ops;
}

function myers(A, B, maxEdits) {
    const N = A.length;
    const M = B.length;
    if (!N || !M || N + M === 0) return [...A.map((_, a) => ({ type: "remove", a })), ...B.map((_, b) => ({ type: "add", b }))];
    const max = N + M;
    const offset = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    let found = -1;
    search: for (let d = 0; d <= max; d++) {
        if (d > maxEdits) return [...A.map((_, a) => ({ type: "remove", a })), ...B.map((_, b) => ({ type: "add", b }))];
        trace.push(v.slice(offset - d - 1, offset + d + 2));
        for (let k = -d; k <= d; k += 2) {
            let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
            let y = x - k;
            while (x < N && y < M && A[x] === B[y]) {
                x++;
                y++;
            }
            v[offset + k] = x;
            if (x >= N && y >= M) {
                found = d;
                break search;
            }
        }
    }
    const ops = [];
    let x = N;
    let y = M;
    for (let d = found; d > 0; d--) {
        const before = k => trace[d][k + d + 1];
        const k = x - y;
        const previousK = k === -d || (k !== d && before(k - 1) < before(k + 1)) ? k + 1 : k - 1;
        const previousX = before(previousK);
        const previousY = previousX - previousK;
        while (x > previousX && y > previousY) {
            ops.push({ type: "equal", a: x - 1, b: y - 1 });
            x--;
            y--;
        }
        ops.push(x === previousX ? { type: "add", b: y - 1 } : { type: "remove", a: x - 1 });
        x = previousX;
        y = previousY;
    }
    while (x > 0 && y > 0) {
        ops.push({ type: "equal", a: x - 1, b: y - 1 });
        x--;
        y--;
    }
    return ops.reverse();
}

/**
 * Groups the operations into hunks that show `context` unchanged lines around each change (Infinity: everything is one hunk).
 * @returns {{ops: DiffOp[], skippedBefore: number}[]} `skippedBefore` is the number of unchanged lines left out before the hunk
 */
export function hunksOf(ops, context = 3) {
    if (!Number.isFinite(context)) return [{ ops, skippedBefore: 0 }];
    const keep = new Array(ops.length).fill(false);
    ops.forEach((op, index) => {
        if (op.type === "equal") return;
        for (let i = Math.max(0, index - context); i <= Math.min(ops.length - 1, index + context); i++) keep[i] = true;
    });
    const hunks = [];
    let skipped = 0;
    let current = null;
    ops.forEach((op, index) => {
        if (!keep[index]) {
            skipped++;
            current = null;
            return;
        }
        if (!current) {
            current = { ops: [], skippedBefore: skipped };
            hunks.push(current);
            skipped = 0;
        }
        current.ops.push(op);
    });
    return hunks;
}
