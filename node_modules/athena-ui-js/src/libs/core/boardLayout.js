// The maths of the board (a Kanban board of columns and cards): where a dragged card would land, where the keyboard moves it, how fast the board scrolls.
// No DOM here: plain numbers in, plain numbers out, so it is tested without a browser.
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

export const clamp = (number, low, high) => Math.min(Math.max(number, low), high);

/**
 * The column that a horizontal position belongs to: the one whose box contains it, else the nearest one. Returns -1 when there are no columns.
 * @param {{left: number, right: number}[]} rects the boxes of the columns, in the order of the columns
 * @param {number} x
 */
export function columnAt(rects, x) {
    let best = -1;
    let bestDistance = Infinity;
    rects.forEach((rect, index) => {
        const distance = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
        if (distance < bestDistance) {
            best = index;
            bestDistance = distance;
        }
    });
    return best;
}

/**
 * The place a card would take in a column at a vertical position: before the first card whose middle is below it, else at the end.
 * @param {{top: number, bottom: number}[]} rects the boxes of the cards of the column (without the card that is moved), top to bottom
 * @param {number} y
 */
export function indexAt(rects, y) {
    for (let index = 0; index < rects.length; index++) {
        if (y < (rects[index].top + rects[index].bottom) / 2) return index;
    }
    return rects.length;
}

/**
 * One step of the keyboard for a card that is picked up. `lengths` are the numbers of cards of the columns WITHOUT the moved card, so an index equal to the length
 * means "at the end". Returns the new place, or null when the card can not go that way.
 * @param {{column: number, index: number}} position
 * @param {string} key ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home or End
 * @param {number[]} lengths
 * @returns {{column: number, index: number} | null}
 */
export function stepOf(position, key, lengths) {
    const { column, index } = position;
    switch (key) {
        case "ArrowUp": return index > 0 ? { column, index: index - 1 } : null;
        case "ArrowDown": return index < lengths[column] ? { column, index: index + 1 } : null;
        case "Home": return index > 0 ? { column, index: 0 } : null;
        case "End": return index < lengths[column] ? { column, index: lengths[column] } : null;
        case "ArrowLeft":
        case "ArrowRight": {
            const to = column + (key === "ArrowLeft" ? -1 : 1);
            if (to < 0 || to >= lengths.length) return null;
            return { column: to, index: Math.min(index, lengths[to]) };
        }
        default: return null;
    }
}

/**
 * Where the keyboard focus goes from a card that is NOT picked up: up and down within the column, left and right to the nearest card of the next column that has
 * cards (the same height, as far as there is one), Home and End to the first and the last of the column. Returns { column, index } or null.
 * @param {{column: number, index: number}} position
 * @param {string} key
 * @param {number[]} lengths the numbers of cards of the columns
 */
export function focusStep(position, key, lengths) {
    const { column, index } = position;
    switch (key) {
        case "ArrowUp": return index > 0 ? { column, index: index - 1 } : null;
        case "ArrowDown": return index < lengths[column] - 1 ? { column, index: index + 1 } : null;
        case "Home": return index > 0 ? { column, index: 0 } : null;
        case "End": return index < lengths[column] - 1 ? { column, index: lengths[column] - 1 } : null;
        case "ArrowLeft":
        case "ArrowRight": {
            const direction = key === "ArrowLeft" ? -1 : 1;
            for (let to = column + direction; to >= 0 && to < lengths.length; to += direction) {
                if (lengths[to] > 0) return { column: to, index: Math.min(index, lengths[to] - 1) };
            }
            return null;
        }
        default: return null;
    }
}

/**
 * The scroll speed (pixels per frame; negative: backwards) for a pointer that is near the edges of a box; 0 in the middle or when the box is too small.
 * @param {number} position the pointer along the axis
 * @param {number} start the start of the box along the axis
 * @param {number} end the end of the box
 * @param {{edge?: number, max?: number}} [options] the width of the zone at each edge (56) and the fastest speed (18)
 */
export function scrollSpeed(position, start, end, { edge = 56, max = 18 } = {}) {
    if (end - start < edge * 2) return 0;
    if (position < start + edge) return -Math.ceil(max * clamp((start + edge - position) / edge, 0, 1));
    if (position > end - edge) return Math.ceil(max * clamp((position - (end - edge)) / edge, 0, 1));
    return 0;
}
