//tableGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { downloadFile, toCsv } from "../../core/csv.js";
import { asHandle, resolveElement } from "../../core/dom.js";
import { translate } from "../../core/i18n.js";
import { animate, fadeIn, prefersReducedMotion } from "../../core/motion.js";
import { clampWidth, virtualWindow } from "../../core/tableMath.js";

const el = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
};

const addClasses = (node, classes) => {
    for (const name of [classes].flat()) if (name) node.classList.add(...String(name).split(/\s+/).filter(Boolean));
};

const compare = (a, b) =>
    typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true });

/**
 * Generates a table (optional filter box, sortable headers, pagination, row selection, inline
 * editing, resizable columns, virtual scrolling, CSV export) and appends it to its parent.
 *
 * @param {object} options
 * @param {string|Element} [options.parent] id or element, defaults to "wrapper"
 * @param {string} [options.id] id of the table wrapper (default: "table")
 * @param {string} [options.class] extra CSS class of the table
 * @param {string} [options.caption]
 * @param {{key: string, label?: string, width?: number, sortable?: boolean, editable?: boolean, align?: "left"|"center"|"right", title?: boolean,
 *          format?: (value, row) => string, render?: (row: object, value) => (string|Node)}[]} options.columns
 *        `format` writes the text of a cell; `render` builds its content instead (a badge, a link, buttons: an element, or text). Every cell carries its column
 *        label in `data-label`, so a stylesheet can show a row as a block on a narrow screen, with the label next to the value.
 * @param {object[]} [options.rows] row objects, read by column key
 * @param {boolean} [options.sortable=true] click on a header sorts by it
 * @param {boolean} [options.filter=false] show a text filter above the table
 * @param {number} [options.pageSize=0] rows per page, 0 disables pagination
 * @param {boolean} [options.selectable=false] checkbox column; the header checkbox selects every filtered row
 * @param {boolean} [options.resizableColumns=false] drag the edge of a header (or use the arrow keys on it) to resize;
 *        double click resets the width
 * @param {{height?: number, rowHeight?: number, overscan?: number}|boolean} [options.virtual] render only the rows
 *        in view, for lists of thousands of rows. Rows have a fixed height (default 36 px) and the table scrolls
 *        inside `height` (default 400 px). Replaces pagination.
 * @param {(key: string, width: number) => void} [options.onColumnResize]
 * @param {(rows: object[]) => void} [options.onSelectionChange]
 * @param {(row: object, key: string, value, oldValue) => (boolean|void)} [options.onEdit] called after an edit
 *        of an `editable` column (double click, or Enter / F2 on the focused cell). Return false to reject it.
 * @param {(row: object) => void} [options.onRowClick]
 * @param {string} [options.emptyText]
 * @param {(row: object, column: object) => (string|string[]|null|undefined)} [options.cellClass] CSS class(es) for a cell
 * @param {(row: object) => (string|string[]|null|undefined)} [options.rowClass] CSS class(es) for a row
 * @param {boolean} [options.focusableRows=false] rows are reachable with Tab and, with `onRowClick`, opened with Enter and Space
 * @param {(row: object) => string} [options.rowLabel] aria-label of a focusable row
 * @param {"normal"|"compact"} [options.density="normal"]
 * @param {boolean} [options.wrap] true lets long text wrap, false keeps one line with an ellipsis (default: wrap, except in virtual tables)
 * @param {(query: {page: number, pageSize: number, cursor: *, sort: ({key: string, descending: boolean}|null), filter: string}) =>
 *        Promise<{rows: object[], total?: number, nextCursor?: *}>} [options.dataSource] load the rows from a server instead of
 *        keeping them all in the browser. Sorting, the filter box and the pager call it again. Answer with `total` for numbered pages
 *        (`page` is 0-based), or with `nextCursor` for a "Load more" button (`cursor` is what the last answer gave, undefined for the
 *        first request; the rows are appended). A failed request shows the error with a Retry button.
 *        Together with `virtual` the list scrolls like one of `total` rows (every answer must carry `total`): the rows in view are asked for
 *        in chunks of `chunkSize` (`page` is the chunk number), rows that have not arrived yet show a placeholder, and sorting or the filter
 *        start again from the top.
 * @param {number} [options.chunkSize=50] rows per request of a data source with `virtual`
 * @param {boolean} [options.animateRows=false] rows slide to their new place when the table is sorted, filtered or changes page, and new rows fade in
 *        (at most 60 rows are animated, none under reduced motion, none in a virtual table)
 * @param {number} [options.filterDelay=300] ms to wait after typing before the data source is asked
 * @param {{label: string, onclick: (row: object) => void, danger?: boolean, hidden?: (row: object) => boolean, ariaLabel?: (row: object) => string}[]} [options.rowActions]
 *        a column of buttons at the end of every row
 * Column extras: `render(row, value)` returns text or a Node (built by the caller, so safe by construction), `align`
 * ("left" | "center" | "right"), `title` (false switches the tooltip with the full text off).
 * @returns {{element: HTMLElement, update: Function, destroy: Function, setRows: Function, getSelected: () => object[], clearSelection: Function,
 *            getColumnWidths: () => Object<string, number>, toCsv: () => string, exportCsv: (filename?: string) => void}}
 */
export function generateTable(options = {}) {
    const {
        parent = "wrapper", id = "table", columns = [], sortable = true,
        filter = false, selectable = false, resizableColumns = false, onRowClick, onSelectionChange
    } = options;
    const remote = typeof options.dataSource === "function";
    const rowActions = options.rowActions?.length ? options.rowActions : null;
    const virtual = options.virtual
        ? { height: 400, rowHeight: 36, overscan: 5, ...(options.virtual === true ? {} : options.virtual) }
        : null;
    const remoteVirtual = remote && Boolean(virtual);
    const chunkSize = Math.max(1, options.chunkSize ?? 50);
    const chunks = new Map();               // chunk number -> "loading" | "done" | "failed" (remote virtual)
    let flushTimer = 0;
    const pageSize = virtual ? 0 : (options.pageSize ?? (remote ? 25 : 0));
    // What the data source told us: { loading, error, total, nextCursor, cursorMode }
    const server = { loading: false, error: null, total: null, nextCursor: undefined, cursorMode: false, request: 0 };
    const colCount = () => columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0);
    const host = resolveElement(parent) ?? document.body;
    let rows = [...(options.rows ?? [])];
    let current = rows;                     // filtered and sorted rows
    const selected = new Set();
    const widths = {};                      // column key -> px, set by the user (or by options)
    for (const col of columns) if (col.width) widths[col.key] = col.width;
    const state = { sortKey: null, descending: false, page: 0, query: "" };
    let windowKey = "";

    const root = el("div", "athena-table-wrapper");
    root.id = id;
    const table = el("table", `athena-table ${options.class ?? ""}`.trim());
    if (resizableColumns) table.classList.add("athena-table-resizable");
    if (options.density === "compact") table.classList.add("athena-table-compact");
    if (options.wrap === true) table.classList.add("athena-table-wrap");
    else if (options.wrap === false) table.classList.add("athena-table-nowrap");
    let scroller = null;
    if (virtual) {
        table.classList.add("athena-table-virtual");
        scroller = el("div", "athena-table-scroll");
        scroller.style.maxHeight = `${virtual.height}px`;
        scroller.style.setProperty("--row-height", `${virtual.rowHeight}px`);
        scroller.tabIndex = 0;
        scroller.setAttribute("role", "region");
        scroller.setAttribute("aria-label", options.caption ?? id);
    }
    if (filter) {
        const filterInput = el("input", "athena-table-filter");
        filterInput.type = "search";
        filterInput.placeholder = translate("filter");
        filterInput.setAttribute("aria-label", translate("filter"));
        let filterTimer = 0;
        filterInput.addEventListener("input", () => {
            state.query = remote ? filterInput.value.trim() : filterInput.value.toLowerCase();
            state.page = 0;
            if (scroller) scroller.scrollTop = 0;
            if (!remote) return render();
            clearTimeout(filterTimer);
            filterTimer = setTimeout(() => load({ reset: true }), options.filterDelay ?? 300);
        });
        root.append(filterInput);
    }
    if (scroller) {
        scroller.append(table);
        root.append(scroller);
    } else {
        root.append(table);
    }
    const pager = pageSize > 0 ? el("div", "athena-table-pager") : null;
    if (pager) root.append(pager);
    host.append(root);

    function visibleRows() {
        if (remote) return rows;   // the server filtered, sorted and paged them
        let result = rows;
        if (state.query) {
            result = result.filter(row =>
                columns.some(col => String(row[col.key] ?? "").toLowerCase().includes(state.query)));
        }
        if (state.sortKey) {
            const dir = state.descending ? -1 : 1;
            result = [...result].sort((a, b) => dir * compare(a[state.sortKey], b[state.sortKey]));
        }
        return result;
    }

    const selectionChanged = () => onSelectionChange?.([...selected]);

    /* ------------------COLUMN WIDTHS------------------- */

    const totalWidth = () => Object.keys(widths).length === columns.length
        ? columns.reduce((sum, col) => sum + widths[col.key], 0) + (selectable ? 40 : 0)
        : 0;

    function renderColgroup() {
        const group = el("colgroup");
        if (selectable) {
            const col = el("col");
            col.style.width = "40px";
            group.append(col);
        }
        for (const column of columns) {
            const col = el("col");
            if (widths[column.key]) col.style.width = `${widths[column.key]}px`;
            group.append(col);
        }
        return group;
    }

    // Freezes the current widths, so dragging one edge does not move the others.
    function freezeWidths() {
        if (Object.keys(widths).length === columns.length) return;
        const heads = table.querySelectorAll("thead th:not(.athena-table-select)");
        columns.forEach((col, i) => { widths[col.key] ??= clampWidth(heads[i]?.offsetWidth ?? 120); });
    }

    function applyWidths() {
        const group = table.querySelector("colgroup");
        if (!group) return;
        const cols = [...group.children].slice(selectable ? 1 : 0);
        columns.forEach((col, i) => { if (widths[col.key]) cols[i].style.width = `${widths[col.key]}px`; });
        // With every width known the table is laid out by them, so dragging one edge moves nothing else.
        const total = totalWidth();
        table.style.tableLayout = total ? "fixed" : "";
        table.style.width = total ? `${total}px` : "";
    }

    function setWidth(col, width) {
        freezeWidths();
        widths[col.key] = clampWidth(width, col.minWidth ?? 40, col.maxWidth ?? 1200);
        applyWidths();
        options.onColumnResize?.(col.key, widths[col.key]);
    }

    function makeResizer(th, col) {
        const handle = el("span", "athena-col-resizer");
        handle.setAttribute("role", "separator");
        handle.setAttribute("aria-orientation", "vertical");
        handle.setAttribute("aria-label", `${translate("resizeColumn")}: ${col.label ?? col.key}`);
        handle.tabIndex = 0;
        // The handle sits inside a sortable header, so it must not trigger the sort.
        handle.addEventListener("click", e => e.stopPropagation());
        handle.addEventListener("keydown", e => {
            e.stopPropagation();
            const step = e.shiftKey ? 50 : 10;
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                freezeWidths();
                setWidth(col, widths[col.key] + (e.key === "ArrowRight" ? step : -step));
            }
        });
        handle.addEventListener("dblclick", e => {
            e.stopPropagation();
            delete widths[col.key];
            if (col.width) widths[col.key] = col.width;
            if (!Object.keys(widths).length) {
                table.style.tableLayout = "";
                table.style.width = "";
            }
            render();
        });
        handle.addEventListener("pointerdown", e => {
            e.preventDefault();
            e.stopPropagation();
            freezeWidths();
            const startX = e.clientX;
            const startWidth = widths[col.key];
            try {
                handle.setPointerCapture(e.pointerId);
            } catch { /* the pointer is gone already */ }
            handle.classList.add("resizing");
            const move = ev => setWidth(col, startWidth + (ev.clientX - startX));
            const stop = () => {
                handle.classList.remove("resizing");
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", stop);
                handle.removeEventListener("pointercancel", stop);
            };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", stop);
            handle.addEventListener("pointercancel", stop);
        });
        th.append(handle);
    }

    /* ------------------RENDER------------------- */

    function renderHead(all) {
        const tr = el("tr");
        if (selectable) {
            const th = el("th", "athena-table-select");
            const box = el("input");
            box.type = "checkbox";
            box.setAttribute("aria-label", translate("selectAll"));
            const chosen = all.filter(row => selected.has(row)).length;
            box.checked = all.length > 0 && chosen === all.length;
            box.indeterminate = chosen > 0 && chosen < all.length;
            box.addEventListener("change", () => {
                all.forEach(row => (box.checked ? selected.add(row) : selected.delete(row)));
                selectionChanged();
                render();
            });
            th.append(box);
            tr.append(th);
        }
        for (const col of columns) {
            const th = el("th", null, col.label ?? col.key);
            th.scope = "col";
            if (sortable && col.sortable !== false) {
                th.classList.add("sortable");
                th.tabIndex = 0;
                const sort = () => {
                    state.descending = state.sortKey === col.key && !state.descending;
                    state.sortKey = col.key;
                    if (remote) load({ reset: true });
                    else render();
                };
                th.addEventListener("click", sort);
                th.addEventListener("keydown", e => {
                    if (e.target === th && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        sort();
                    }
                });
                if (state.sortKey === col.key) {
                    th.append(el("span", "sort-indicator", state.descending ? " ▼" : " ▲"));
                    th.setAttribute("aria-sort", state.descending ? "descending" : "ascending");
                }
            }
            if (resizableColumns) makeResizer(th, col);
            tr.append(th);
        }
        if (rowActions) {
            const th = el("th", "athena-table-actions");
            th.scope = "col";
            th.append(el("span", "athena-visually-hidden", translate("actions")));
            tr.append(th);
        }
        const thead = el("thead");
        thead.append(tr);
        return thead;
    }

    // Replaces the cell content with an input until the edit is confirmed (Enter, blur) or cancelled (Esc).
    function startEdit(td, row, col) {
        if (td.querySelector("input")) return;
        const oldValue = row[col.key];
        const input = el("input", "athena-table-edit");
        input.type = typeof oldValue === "number" ? "number" : "text";
        input.value = oldValue ?? "";
        let finished = false;
        const finish = commit => {
            if (finished) return;
            finished = true;
            if (commit && input.value !== String(oldValue ?? "")) {
                const value = typeof oldValue === "number" && input.value !== "" ? Number(input.value) : input.value;
                row[col.key] = value;
                if (options.onEdit?.(row, col.key, value, oldValue) === false) row[col.key] = oldValue;
            }
            render();
        };
        input.addEventListener("keydown", e => {
            if (e.key === "Enter") finish(true);
            else if (e.key === "Escape") {
                e.stopPropagation();
                finish(false);
            }
        });
        input.addEventListener("blur", () => finish(true));
        td.replaceChildren(input);
        input.focus();
        input.select();
    }

    function spacer(height) {
        const tr = el("tr", "athena-table-spacer");
        tr.setAttribute("aria-hidden", "true");
        tr.style.height = `${height}px`;
        const td = el("td");
        td.colSpan = colCount();
        tr.append(td);
        return tr;
    }

    const rowOf = new WeakMap();     // the element of a row -> its row object, to find the same row again after a redraw (animateRows)
    let rendered = false;

    function renderRow(row, index) {
        const tr = el("tr");
        if (row !== undefined) rowOf.set(tr, row);
        if (virtual) tr.setAttribute("aria-rowindex", String(index + 2));
        if (row === undefined) {
            // A row of a data source that has not arrived yet
            tr.className = "athena-table-placeholder";
            tr.setAttribute("aria-busy", "true");
            const td = el("td", null, "…");
            td.colSpan = colCount();
            tr.append(td);
            return tr;
        }
        addClasses(tr, options.rowClass?.(row));
        if (onRowClick) {
            tr.classList.add("clickable");
            tr.addEventListener("click", () => onRowClick(row));
        }
        if (options.focusableRows) {
            tr.tabIndex = 0;
            if (options.rowLabel) tr.setAttribute("aria-label", options.rowLabel(row));
            if (onRowClick) {
                tr.addEventListener("keydown", e => {
                    if (e.target === tr && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        onRowClick(row);
                    }
                });
            }
        }
        if (selectable) {
            const td = el("td", "athena-table-select");
            const box = el("input");
            box.type = "checkbox";
            box.checked = selected.has(row);
            tr.classList.toggle("selected", box.checked);
            box.addEventListener("click", e => e.stopPropagation());
            box.addEventListener("change", () => {
                if (box.checked) selected.add(row);
                else selected.delete(row);
                selectionChanged();
                render();
            });
            td.append(box);
            tr.append(td);
        }
        for (const col of columns) {
            const value = row[col.key];
            const content = col.render ? col.render(row, value) : (col.format ? col.format(value, row) : (value ?? ""));
            const td = el("td");
            td.dataset.label = col.label ?? col.key;
            if (content instanceof Node) td.append(content);
            else {
                td.textContent = content;
                // Text that may be cut off gets its full text as a tooltip.
                if (col.title !== false && String(content).length > 24) td.title = String(content);
            }
            if (col.align) td.classList.add(`athena-align-${col.align}`);
            addClasses(td, options.cellClass?.(row, col));
            if (col.editable) {
                td.classList.add("editable");
                td.tabIndex = 0;
                td.addEventListener("dblclick", () => startEdit(td, row, col));
                td.addEventListener("keydown", e => {
                    if ((e.key === "Enter" || e.key === "F2") && e.target === td) {
                        e.preventDefault();
                        startEdit(td, row, col);
                    }
                });
            }
            tr.append(td);
        }
        if (rowActions) {
            const td = el("td", "athena-table-actions");
            for (const action of rowActions) {
                if (action.hidden?.(row)) continue;
                const button = el("button", `athena-button button-${action.danger ? "danger" : "secondary"} button-small`, action.label);
                button.type = "button";
                if (action.ariaLabel) button.setAttribute("aria-label", action.ariaLabel(row));
                button.addEventListener("click", event => {
                    event.stopPropagation();
                    action.onclick(row);
                });
                td.append(button);
            }
            tr.append(td);
        }
        return tr;
    }

    function messageRow(className, text, retry) {
        const td = el("td", className, text);
        td.colSpan = Math.max(colCount(), 1);
        if (retry) {
            const button = el("button", "athena-button button-secondary button-small", translate("retry"));
            button.type = "button";
            button.addEventListener("click", () => load({}));
            td.append(" ", button);
        }
        const tr = el("tr");
        tr.append(td);
        return tr;
    }

    function renderBody() {
        const tbody = el("tbody");
        if (remote && server.error && !current.length) {
            const row = messageRow("athena-table-error", server.error, true);
            row.firstChild.setAttribute("role", "alert");
            tbody.append(row);
            return tbody;
        }
        if (remote && server.loading && !current.length) {
            tbody.append(messageRow("athena-table-loading", translate("loading")));
            return tbody;
        }
        if (!current.length) {
            tbody.append(messageRow("athena-table-empty", options.emptyText ?? translate("noData")));
            return tbody;
        }
        if (virtual) {
            const win = virtualWindow({
                scrollTop: scroller.scrollTop, viewportHeight: viewportHeight(),
                rowHeight: virtual.rowHeight, total: current.length, overscan: virtual.overscan
            });
            windowKey = `${win.start}:${win.end}`;
            if (remoteVirtual) ensureChunks();
            if (win.offsetTop) tbody.append(spacer(win.offsetTop));
            for (let i = win.start; i < win.end; i++) tbody.append(renderRow(current[i], i));
            if (win.offsetBottom) tbody.append(spacer(win.offsetBottom));
            return tbody;
        }
        const pageRows = remote ? current : pageSize > 0 ? current.slice(state.page * pageSize, (state.page + 1) * pageSize) : current;
        for (const row of pageRows) tbody.append(renderRow(row));
        return tbody;
    }

    function renderRemotePager() {
        if (server.cursorMode) {
            pager.hidden = !server.nextCursor && !server.error;
            const more = el("button", "athena-button button-secondary", translate("loadMore"));
            more.type = "button";
            more.disabled = server.loading;
            more.addEventListener("click", () => load({ more: true }));
            pager.replaceChildren(more);
            showPagerError();
            return;
        }
        const pages = server.total == null ? state.page + 2 : Math.max(1, Math.ceil(server.total / pageSize));
        pager.hidden = pages === 1;
        const go = delta => () => {
            state.page += delta;
            load({});
        };
        const prev = el("button", null, `‹ ${translate("previous")}`);
        prev.type = "button";
        prev.disabled = state.page === 0 || server.loading;
        prev.addEventListener("click", go(-1));
        const next = el("button", null, `${translate("next")} ›`);
        next.type = "button";
        next.disabled = state.page >= pages - 1 || server.loading;
        next.addEventListener("click", go(1));
        pager.replaceChildren(prev, el("span", null, ` ${translate("page", { page: state.page + 1, pages: server.total == null ? "?" : pages })} `), next);
        showPagerError();
    }

    // A failed request while rows are on the screen (the next page, "Load more"): say so next to the buttons.
    function showPagerError() {
        if (!server.error || !current.length) return;
        pager.hidden = false;
        const message = el("span", "athena-table-error", server.error);
        message.setAttribute("role", "alert");
        pager.append(" ", message);
    }

    function renderPager(total) {
        if (!pager) return;
        if (remote) return renderRemotePager();
        const pages = Math.max(1, Math.ceil(total / pageSize));
        state.page = Math.min(state.page, pages - 1);
        pager.hidden = pages === 1;
        const button = (text, disabled, delta) => {
            const b = el("button", null, text);
            b.type = "button";
            b.disabled = disabled;
            b.addEventListener("click", () => {
                state.page += delta;
                render();
            });
            return b;
        };
        pager.replaceChildren(
            button(`‹ ${translate("previous")}`, state.page === 0, -1),
            el("span", null, ` ${translate("page", { page: state.page + 1, pages })} `),
            button(`${translate("next")} ›`, state.page >= pages - 1, 1)
        );
    }

    function render() {
        const scrollTop = scroller?.scrollTop ?? 0;
        current = visibleRows();
        root.toggleAttribute("aria-busy", remote && server.loading);
        root.classList.toggle("athena-table-is-loading", remote && server.loading);
        renderPager(current.length);
        if (virtual) table.setAttribute("aria-rowcount", String(current.length + 1));
        // Where the rows were before (FLIP): the same row object is the same row
        const before = options.animateRows && rendered && !virtual && !prefersReducedMotion()
            ? new Map([...(table.tBodies[0]?.rows ?? [])].slice(0, 60).map(tr => [rowOf.get(tr), tr.getBoundingClientRect()]).filter(([row]) => row !== undefined))
            : null;
        const parts = [renderHead(current), renderBody()];
        if (resizableColumns || Object.keys(widths).length) parts.unshift(renderColgroup());
        if (options.caption) parts.unshift(el("caption", null, options.caption));
        table.replaceChildren(...parts);
        if (before?.size) {
            for (const tr of [...table.tBodies[0].rows].slice(0, 60)) {
                const row = rowOf.get(tr);
                if (row === undefined) continue;
                const old = before.get(row);
                if (!old) {
                    fadeIn(tr);
                    continue;
                }
                const now = tr.getBoundingClientRect();
                if (Math.abs(old.top - now.top) > 1) animate(tr, [{ translate: `0 ${old.top - now.top}px` }, { translate: "0 0" }], { easing: "cubic-bezier(0.2, 0, 0, 1)" });
            }
        }
        rendered = true;
        if (Object.keys(widths).length) applyWidths();
        if (scroller) scroller.scrollTop = scrollTop;
    }

    // Scrolling only swaps the body, and only when the window of rows really changed.
    // The scroll area is as high as the rows, up to `virtual.height`. That is also the least it can show, so a list that
    // starts empty (a tiny scroll area when the rows are set) still draws a full window.
    const viewportHeight = () => Math.max(scroller.clientHeight, Math.min(virtual.height, current.length * virtual.rowHeight));

    function refreshWindow(force = false) {
        if (remoteVirtual) ensureChunks();
        const win = virtualWindow({
            scrollTop: scroller.scrollTop, viewportHeight: viewportHeight(),
            rowHeight: virtual.rowHeight, total: current.length, overscan: virtual.overscan
        });
        if (!force && `${win.start}:${win.end}` === windowKey) return;
        const focused = document.activeElement;
        const keepFocus = focused && table.tBodies[0]?.contains(focused);
        table.tBodies[0].replaceWith(renderBody());
        if (keepFocus) scroller.focus({ preventScroll: true });
    }

    if (scroller) {
        let queued = false;
        scroller.addEventListener("scroll", () => {
            if (queued) return;
            queued = true;
            // Once per frame; the timer is for pages where frames are paused or late (a hidden tab, a busy page).
            let timer = 0;
            const run = () => {
                if (!queued) return;
                queued = false;
                clearTimeout(timer);
                refreshWindow();
            };
            requestAnimationFrame(run);
            timer = setTimeout(run, 100);
        });
    }

    /**
     * Asks the data source. { reset } starts again from the first page, { more } appends the next cursor page.
     * An answer that arrives after a newer request was made is ignored.
     */
    async function load({ reset = false, more = false } = {}) {
        if (remoteVirtual) return loadVirtual();
        if (reset) {
            state.page = 0;
            server.nextCursor = undefined;
        }
        const request = ++server.request;
        server.loading = true;
        server.error = null;
        render();
        try {
            const answer = await options.dataSource({
                page: state.page,
                pageSize,
                cursor: more ? server.nextCursor : undefined,
                sort: state.sortKey ? { key: state.sortKey, descending: state.descending } : null,
                filter: state.query
            });
            if (request !== server.request) return;
            const loaded = answer?.rows ?? [];
            server.cursorMode = answer?.nextCursor !== undefined || (more && server.cursorMode);
            server.nextCursor = answer?.nextCursor ?? undefined;
            server.total = answer?.total ?? null;
            rows = more ? [...rows, ...loaded] : [...loaded];
            if (!more) selected.clear();
        } catch (error) {
            if (request !== server.request) return;
            server.error = error?.message ?? String(error);
            if (!more) rows = [];
        } finally {
            if (request === server.request) {
                server.loading = false;
                render();
                if (!more) selectionChanged();
            }
        }
    }

    /* ------------------REMOTE + VIRTUAL------------------- */

    const status = remoteVirtual ? el("div", "athena-table-status") : null;
    if (status) {
        status.setAttribute("role", "status");
        root.append(status);
    }

    function updateStatus() {
        if (!status) return;
        const failed = [...chunks.values()].includes("failed");
        status.replaceChildren();
        status.hidden = !failed;
        if (!failed) return;
        status.append(el("span", "athena-table-error", server.error ?? translate("noData")), " ");
        const retry = el("button", "athena-button button-secondary button-small", translate("retry"));
        retry.type = "button";
        retry.addEventListener("click", () => {
            for (const [chunk, value] of chunks) if (value === "failed") chunks.delete(chunk);
            server.error = null;
            updateStatus();
            ensureChunks();
        });
        status.append(retry);
    }

    const query = () => ({ pageSize: chunkSize, cursor: undefined, sort: state.sortKey ? { key: state.sortKey, descending: state.descending } : null, filter: state.query });

    function place(chunk, list) {
        list.forEach((row, i) => {
            const index = chunk * chunkSize + i;
            if (index < rows.length) rows[index] = row;
        });
    }

    // Starts again: the first chunk tells how many rows there are, the others come while the person scrolls.
    async function loadVirtual() {
        const generation = ++server.request;
        clearTimeout(flushTimer);
        chunks.clear();
        rows = [];
        selected.clear();
        if (scroller) scroller.scrollTop = 0;
        server.loading = true;
        server.error = null;
        render();
        try {
            const answer = await options.dataSource({ page: 0, ...query() });
            if (generation !== server.request) return;
            if (!Number.isInteger(answer?.total) || answer.total < 0) throw new Error("A data source with virtual scrolling has to answer with total");
            rows = new Array(answer.total);
            place(0, answer.rows ?? []);
            chunks.set(0, "done");
            server.total = answer.total;
        } catch (error) {
            if (generation !== server.request) return;
            server.error = error?.message ?? String(error);
            rows = [];
        } finally {
            if (generation === server.request) {
                server.loading = false;
                render();
                selectionChanged();
                updateStatus();
                if (!server.error) ensureChunks();
            }
        }
    }

    async function loadChunk(chunk, generation) {
        chunks.set(chunk, "loading");
        try {
            const answer = await options.dataSource({ page: chunk, ...query() });
            if (generation !== server.request) return;
            place(chunk, answer?.rows ?? []);
            chunks.set(chunk, "done");
        } catch (error) {
            if (generation !== server.request) return;
            chunks.set(chunk, "failed");
            server.error = error?.message ?? String(error);
        } finally {
            if (generation === server.request) {
                refreshWindow(true);
                updateStatus();
            }
        }
    }

    // Asks for the chunks under the rows in view (and the rows around them). Waits a moment, so scrolling past does not ask for everything.
    function ensureChunks() {
        clearTimeout(flushTimer);
        const generation = server.request;
        flushTimer = setTimeout(() => {
            if (generation !== server.request || !rows.length) return;
            const win = virtualWindow({
                scrollTop: scroller.scrollTop, viewportHeight: viewportHeight(),
                rowHeight: virtual.rowHeight, total: rows.length, overscan: virtual.overscan
            });
            const first = Math.floor(win.start / chunkSize);
            const last = Math.floor((win.end - 1) / chunkSize);
            for (let chunk = first; chunk <= last; chunk++) if (!chunks.has(chunk)) loadChunk(chunk, generation);
        }, 40);
    }

    // The window of rows depends on the height of the scroll area, which is unknown while the list is empty or
    // not on screen yet: measure again whenever it changes size.
    if (scroller && typeof ResizeObserver !== "undefined") {
        let lastHeight = 0;
        new ResizeObserver(() => {
            const height = scroller.clientHeight;
            if (height === lastHeight) return;
            lastHeight = height;
            refreshWindow();
        }).observe(scroller);
    }

    render();
    if (remote) load({ reset: true });
    return asHandle({
        element: root,
        /** Asks the data source again (the first page, keeping sort and filter). Resolves when the answer is shown. */
        reload: () => (remote ? load({ reset: true }) : Promise.resolve()),
        // update() draws the table again; update({ rows }) also replaces the rows.
        update(next) {
            if (next?.rows) this.setRows(next.rows);
            else render();
            return this;
        },
        setRows(newRows) {
            rows = [...newRows];
            selected.clear();
            state.page = 0;
            if (scroller) scroller.scrollTop = 0;
            render();
            selectionChanged();
        },
        getSelected: () => [...selected],
        clearSelection() {
            selected.clear();
            render();
            selectionChanged();
        },
        getColumnWidths: () => ({ ...widths }),
        // The filtered and sorted rows as CSV text
        toCsv: () => toCsv(columns, current.filter(row => row !== undefined)),
        exportCsv(filename = "table.csv") {
            downloadFile(filename, toCsv(columns, current.filter(row => row !== undefined)));
        }
    });
}
