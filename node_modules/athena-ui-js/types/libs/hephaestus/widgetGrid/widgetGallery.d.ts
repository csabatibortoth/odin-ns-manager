/**
 * A list of widget types for a grid. Every type is a button (click, Enter or Space adds it), so dragging is never the only way.
 * A mouse or pen can drag the whole button; a finger drags by the grip, so that swiping over the list still scrolls the page.
 *
 * @param {object} options
 * @param {string|HTMLElement} options.element the container
 * @param {object} options.grid the handle of createWidgetGrid
 * @param {string[]} [options.types] which types, in this order (default: every registered type)
 * @param {boolean} [options.withSettings=false] open the settings of a new widget; dismissing them adds nothing
 * @param {string} [options.label] accessible name of the list
 * @param {(id: string, type: string) => void} [options.onAdd] called after a widget was added
 * @returns the handle: { element, update() (draw the list again, after new types were registered), destroy() }
 */
export function createWidgetGallery(options?: {
    element: string | HTMLElement;
    grid: object;
    types?: string[];
    withSettings?: boolean;
    label?: string;
    onAdd?: (id: string, type: string) => void;
}): any;
