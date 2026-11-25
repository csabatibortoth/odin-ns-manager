/**
 * The column that a horizontal position belongs to: the one whose box contains it, else the nearest one. Returns -1 when there are no columns.
 * @param {{left: number, right: number}[]} rects the boxes of the columns, in the order of the columns
 * @param {number} x
 */
export function columnAt(rects: {
    left: number;
    right: number;
}[], x: number): number;
/**
 * The place a card would take in a column at a vertical position: before the first card whose middle is below it, else at the end.
 * @param {{top: number, bottom: number}[]} rects the boxes of the cards of the column (without the card that is moved), top to bottom
 * @param {number} y
 */
export function indexAt(rects: {
    top: number;
    bottom: number;
}[], y: number): number;
/**
 * One step of the keyboard for a card that is picked up. `lengths` are the numbers of cards of the columns WITHOUT the moved card, so an index equal to the length
 * means "at the end". Returns the new place, or null when the card can not go that way.
 * @param {{column: number, index: number}} position
 * @param {string} key ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home or End
 * @param {number[]} lengths
 * @returns {{column: number, index: number} | null}
 */
export function stepOf(position: {
    column: number;
    index: number;
}, key: string, lengths: number[]): {
    column: number;
    index: number;
} | null;
/**
 * Where the keyboard focus goes from a card that is NOT picked up: up and down within the column, left and right to the nearest card of the next column that has
 * cards (the same height, as far as there is one), Home and End to the first and the last of the column. Returns { column, index } or null.
 * @param {{column: number, index: number}} position
 * @param {string} key
 * @param {number[]} lengths the numbers of cards of the columns
 */
export function focusStep(position: {
    column: number;
    index: number;
}, key: string, lengths: number[]): {
    column: number;
    index: number;
};
/**
 * The scroll speed (pixels per frame; negative: backwards) for a pointer that is near the edges of a box; 0 in the middle or when the box is too small.
 * @param {number} position the pointer along the axis
 * @param {number} start the start of the box along the axis
 * @param {number} end the end of the box
 * @param {{edge?: number, max?: number}} [options] the width of the zone at each edge (56) and the fastest speed (18)
 */
export function scrollSpeed(position: number, start: number, end: number, { edge, max }?: {
    edge?: number;
    max?: number;
}): number;
export function clamp(number: any, low: any, high: any): number;
