/**
 * Which rows of a long list have to be in the DOM for the current scroll position.
 * The rows before and after the window are replaced by spacers of `offsetTop` / `offsetBottom` pixels,
 * so the scroll bar keeps the size of the whole list.
 *
 * @param {object} options
 * @param {number} options.scrollTop
 * @param {number} options.viewportHeight
 * @param {number} options.rowHeight
 * @param {number} options.total number of rows
 * @param {number} [options.overscan=5] extra rows above and below, so fast scrolling does not show gaps
 * @returns {{start: number, end: number, offsetTop: number, offsetBottom: number}} rows start..end-1 are rendered
 */
export function virtualWindow({ scrollTop, viewportHeight, rowHeight, total, overscan }: {
    scrollTop: number;
    viewportHeight: number;
    rowHeight: number;
    total: number;
    overscan?: number;
}): {
    start: number;
    end: number;
    offsetTop: number;
    offsetBottom: number;
};
/**
 * Like virtualWindow, but rows can carry extra height (open detail rows): `extras` maps a row index
 * to the pixels it adds. scrollTop and the spacers follow the real content, not index * rowHeight.
 */
export function expandedWindow({ scrollTop, viewportHeight, rowHeight, total, overscan, extras }: {
    scrollTop: any;
    viewportHeight: any;
    rowHeight: any;
    total: any;
    overscan?: number;
    extras?: {};
}): {
    start: number;
    end: number;
    offsetTop: number;
    offsetBottom: number;
};
export function clampWidth(width: any, min?: number, max?: number): number;
