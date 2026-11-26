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

/**
 * Like virtualWindow, but rows can carry extra height (open detail rows): `extras` maps a row index
 * to the pixels it adds. scrollTop and the spacers follow the real content, not index * rowHeight.
 */
export function expandedWindow({ scrollTop, viewportHeight, rowHeight, total, overscan = 5, extras = {} }) {
    if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0, offsetTop: 0, offsetBottom: 0 };
    const entries = Object.entries(extras).map(([index, height]) => [Number(index), Math.max(0, height)]).sort((a, b) => a[0] - b[0]);
    const extraBefore = index => entries.reduce((sum, [at, height]) => sum + (at < index ? height : 0), 0);
    const totalHeight = total * rowHeight + entries.reduce((sum, [, height]) => sum + height, 0);
    const offsetOf = index => index * rowHeight + extraBefore(index);
    const indexAt = offset => {
        let index = Math.min(Math.max(0, Math.floor(offset / rowHeight)), total - 1);
        while (index > 0 && offsetOf(index) > offset) index--;
        while (index < total - 1 && offsetOf(index + 1) <= offset) index++;
        return index;
    };
    const top = Math.max(scrollTop, 0);
    const first = indexAt(top);
    const last = indexAt(top + Math.max(viewportHeight, 0));
    const start = Math.min(Math.max(first - overscan, 0), total - 1);
    const end = Math.min(Math.max(last + overscan, start + 1), total);
    return { start, end, offsetTop: offsetOf(start), offsetBottom: Math.max(0, totalHeight - offsetOf(end)) };
}

// Keeps a column width between the minimum and the maximum.
export function clampWidth(width, min = 40, max = 1200) {
    return Math.min(Math.max(Math.round(width), min), Math.max(min, max));
}
