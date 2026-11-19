//Grid layout maths of Athena UI (no DOM): where widgets sit on a grid of columns, what moves when one is dragged or resized.
//An item is { id, x, y, w, h, locked? } in grid cells, x and y counted from 0. Every function returns new items; the argument is not changed.
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

/** Do two items cover a common cell? */
export const collides = (a, b) => a.id !== b.id && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const copy = items => items.map(item => ({ ...item }));
const byPlace = (a, b) => a.y - b.y || a.x - b.x;

/** Puts an item inside the columns and inside its size limits ({ min: {w, h}, max: {w, h} }). */
export function clampItem(item, columns, { min = {}, max = {} } = {}) {
    const minW = Math.max(1, Math.min(min.w ?? 1, columns));
    const minH = Math.max(1, min.h ?? 1);
    const w = Math.min(Math.max(Math.round(item.w) || minW, minW), Math.min(max.w ?? columns, columns));
    const h = Math.min(Math.max(Math.round(item.h) || minH, minH), max.h ?? Infinity);
    const x = Math.min(Math.max(Math.round(item.x) || 0, 0), columns - w);
    const y = Math.max(Math.round(item.y) || 0, 0);
    return { ...item, x, y, w, h };
}

/**
 * Gravity: every item that is not locked moves up as far as it can (locked items stay where they are).
 * @returns {object[]} new items, in the order of the argument
 */
export function compact(items) {
    const result = copy(items);
    const placed = result.filter(item => item.locked);
    for (const item of result.filter(item => !item.locked).sort(byPlace)) {
        while (item.y > 0) {
            item.y--;
            if (placed.some(other => collides(item, other))) {
                item.y++;
                break;
            }
        }
        placed.push(item);
    }
    return result;
}

/** Pushes what the item `moved` covers downwards, and what that covers in turn. Returns false when a locked item is in the way. */
function resolve(layout, moved, depth = 0) {
    if (depth > layout.length + 2) return false;
    for (const other of layout.filter(item => collides(moved, item)).sort(byPlace)) {
        if (other.locked) return false;
        other.y = moved.y + moved.h;
        if (!resolve(layout, other, depth + 1)) return false;
    }
    return true;
}

/**
 * Sets the place of one item (clamped), pushes the others out of its way and, unless `compactItems` is false, lets everything fall upwards.
 * @param {object[]} items
 * @param {string} id
 * @param {{x?: number, y?: number, w?: number, h?: number}} place the new place; missing values stay as they are
 * @param {number} columns
 * @param {object} [options]
 * @param {{min?: object, max?: object}} [options.limits] size limits of this item
 * @param {boolean} [options.compactItems=true]
 * @returns {object[]|null} the new layout, or null when it is not possible (a locked item is in the way, or the item is locked)
 */
export function placeItem(items, id, place, columns, { limits, compactItems = true } = {}) {
    const layout = copy(items);
    const item = layout.find(entry => entry.id === id);
    if (!item || item.locked) return null;
    Object.assign(item, clampItem({ ...item, ...place }, columns, limits));
    if (layout.some(other => other.locked && collides(item, other))) return null;
    if (!resolve(layout, item)) return null;
    return compactItems ? compact(layout) : layout;
}

/** The first free place of the size w x h (rows grow without end). */
export function findFreeSpot(items, w, h, columns) {
    const width = Math.min(Math.max(1, w), columns);
    for (let y = 0; ; y++) {
        for (let x = 0; x + width <= columns; x++) {
            const probe = { id: "\0probe", x, y, w: width, h };
            if (!items.some(item => collides(probe, item))) return { x, y };
        }
    }
}

/**
 * Makes any list of items a valid layout for `columns`: inside the columns, without overlaps, compact. Items keep their order of reading
 * (top to bottom, left to right). Used for loaded layouts and for a breakpoint that has no layout of its own.
 */
export function normalize(items, columns, limitsOf = () => ({})) {
    const placed = [];
    for (const raw of copy(items).sort(byPlace)) {
        const item = clampItem(raw, columns, limitsOf(raw));
        while (placed.some(other => collides(item, other))) item.y++;
        placed.push(item);
    }
    const order = new Map(items.map((item, index) => [item.id, index]));
    return compact(placed).sort((a, b) => order.get(a.id) - order.get(b.id));
}

/** The height of the layout in rows. */
export const rowsOf = items => items.reduce((rows, item) => Math.max(rows, item.y + item.h), 0);
