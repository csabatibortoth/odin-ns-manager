//tableGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { downloadFile, toCsv } from "../../core/csv.js";
import { translate } from "../../core/i18n.js";
import { clampWidth, virtualWindow } from "../../core/tableMath.js";

const el = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
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
 * @param {{key: string, label?: string, width?: number, sortable?: boolean, editable?: boolean, format?: (value, row) => string}[]} options.columns
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
 * @returns {{element: HTMLElement, setRows: Function, getSelected: () => object[], clearSelection: Function,
 *            getColumnWidths: () => Object<string, number>, toCsv: () => string, exportCsv: (filename?: string) => void}}
 */
export function generateTable(options = {}) {
    const {
        parent = "wrapper", id = "table", columns = [], sortable = true,
        filter = false, selectable = false, resizableColumns = false, onRowClick, onSelectionChange
    } = options;
    const virtual = options.virtual
        ? { height: 400, rowHeight: 36, overscan: 5, ...(options.virtual === true ? {} : options.virtual) }
        : null;
    const pageSize = virtual ? 0 : (options.pageSize ?? 0);
    const host = (typeof parent === "string" ? document.getElementById(parent) : parent) ?? document.body;
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
        filterInput.addEventListener("input", () => {
            state.query = filterInput.value.toLowerCase();
            state.page = 0;
            if (scroller) scroller.scrollTop = 0;
            render();
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
                    render();
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
        td.colSpan = columns.length + (selectable ? 1 : 0);
        tr.append(td);
        return tr;
    }

    function renderRow(row, index) {
        const tr = el("tr");
        if (virtual) tr.setAttribute("aria-rowindex", String(index + 2));
        if (onRowClick) {
            tr.classList.add("clickable");
            tr.addEventListener("click", () => onRowClick(row));
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
            const td = el("td", null, col.format ? col.format(value, row) : (value ?? ""));
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
        return tr;
    }

    function renderBody() {
        const tbody = el("tbody");
        if (!current.length) {
            const td = el("td", "athena-table-empty", options.emptyText ?? translate("noData"));
            td.colSpan = Math.max(columns.length + (selectable ? 1 : 0), 1);
            const tr = el("tr");
            tr.append(td);
            tbody.append(tr);
            return tbody;
        }
        if (virtual) {
            const win = virtualWindow({
                scrollTop: scroller.scrollTop, viewportHeight: scroller.clientHeight || virtual.height,
                rowHeight: virtual.rowHeight, total: current.length, overscan: virtual.overscan
            });
            windowKey = `${win.start}:${win.end}`;
            if (win.offsetTop) tbody.append(spacer(win.offsetTop));
            for (let i = win.start; i < win.end; i++) tbody.append(renderRow(current[i], i));
            if (win.offsetBottom) tbody.append(spacer(win.offsetBottom));
            return tbody;
        }
        const pageRows = pageSize > 0 ? current.slice(state.page * pageSize, (state.page + 1) * pageSize) : current;
        for (const row of pageRows) tbody.append(renderRow(row));
        return tbody;
    }

    function renderPager(total) {
        if (!pager) return;
        const pages = Math.max(1, Math.ceil(total / pageSize));
        state.page = Math.min(state.page, pages - 1);
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
        renderPager(current.length);
        if (virtual) table.setAttribute("aria-rowcount", String(current.length + 1));
        const parts = [renderHead(current), renderBody()];
        if (resizableColumns || Object.keys(widths).length) parts.unshift(renderColgroup());
        if (options.caption) parts.unshift(el("caption", null, options.caption));
        table.replaceChildren(...parts);
        if (Object.keys(widths).length) applyWidths();
        if (scroller) scroller.scrollTop = scrollTop;
    }

    // Scrolling only swaps the body, and only when the window of rows really changed.
    if (scroller) {
        let queued = false;
        scroller.addEventListener("scroll", () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                const win = virtualWindow({
                    scrollTop: scroller.scrollTop, viewportHeight: scroller.clientHeight || virtual.height,
                    rowHeight: virtual.rowHeight, total: current.length, overscan: virtual.overscan
                });
                if (`${win.start}:${win.end}` === windowKey) return;
                const focused = document.activeElement;
                const keepFocus = focused && table.tBodies[0]?.contains(focused);
                table.tBodies[0].replaceWith(renderBody());
                if (keepFocus) scroller.focus({ preventScroll: true });
            });
        });
    }

    render();
    return {
        element: root,
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
        toCsv: () => toCsv(columns, current),
        exportCsv(filename = "table.csv") {
            downloadFile(filename, toCsv(columns, current));
        }
    };
}
