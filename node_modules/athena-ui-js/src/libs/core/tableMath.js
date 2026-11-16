//tableMath for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

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
export function virtualWindow({ scrollTop, viewportHeight, rowHeight, total, overscan = 5 }) {
    if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0, offsetTop: 0, offsetBottom: 0 };
    const first = Math.floor(Math.max(scrollTop, 0) / rowHeight);
    const last = Math.ceil((Math.max(scrollTop, 0) + viewportHeight) / rowHeight);
    const start = Math.min(Math.max(first - overscan, 0), total - 1);
    const end = Math.min(Math.max(last + overscan, start + 1), total);
    return { start, end, offsetTop: start * rowHeight, offsetBottom: (total - end) * rowHeight };
}

// Keeps a column width between the minimum and the maximum.
export function clampWidth(width, min = 40, max = 1200) {
    return Math.min(Math.max(Math.round(width), min), Math.max(min, max));
}
