/** Puts an item inside the columns and inside its size limits ({ min: {w, h}, max: {w, h} }). */
export function clampItem(item: any, columns: any, { min, max }?: {
    min?: {};
    max?: {};
}): any;
/**
 * Gravity: every item that is not locked moves up as far as it can (locked items stay where they are).
 * @returns {object[]} new items, in the order of the argument
 */
export function compact(items: any): object[];
/**
 * Sets the place of one item (clamped), pushes the others out of its way and, unless `compactItems` is false, lets everything fall upwards.
 * @param {object[]} items
 * @param {string} id
 * @param {{x?: number, y?: number, w?: number, h?: number}} place the new place; missing values stay as they are
 * @param {number} columns
 * @param {object} [options]
 * @param {{min?: object, max?: object}} [options.limits] size limits of this item
 * @param {boolean} [options.compactItems=true]
 * @param {"push"|"swap"} [options.collision="push"] "swap": an item moved (not resized) onto one other exchanges places with it, when that fits
 * @param {number} [options.swapCover=0] how much of the smaller of the two has to be covered before they swap, 0 to 1 (the grid asks for 0.5 under a pointer)
 * @returns {object[]|null} the new layout, or null when it is not possible (a locked item is in the way, or the item is locked)
 */
export function placeItem(items: object[], id: string, place: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
}, columns: number, { limits, compactItems, collision, swapCover }?: {
    limits?: {
        min?: object;
        max?: object;
    };
    compactItems?: boolean;
    collision?: "push" | "swap";
    swapCover?: number;
}): object[] | null;
/**
 * The first free place of the size w x h: row-first (the first row that fits, leftmost in that
 * row), as a person reads a grid. A widget wider than half the grid is the exception: it has to
 * start in column 0, or it ends up flush against the right edge with no room to move right.
 */
export function findFreeSpot(items: any, w: any, h: any, columns: any): {
    x: number;
    y: number;
};
/**
 * Makes any list of items a valid layout for `columns`: inside the columns, without overlaps, compact. Items keep their order of reading
 * (top to bottom, left to right). Used for loaded layouts and for a breakpoint that has no layout of its own.
 */
export function normalize(items: any, columns: any, limitsOf?: () => {}): any[];
export function collides(a: any, b: any): boolean;
export function rowsOf(items: any): any;
