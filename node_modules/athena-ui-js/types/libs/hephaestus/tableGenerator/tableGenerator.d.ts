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
export function generateTable(options?: {
    parent?: string | Element;
    id?: string;
    class?: string;
    caption?: string;
    columns: {
        key: string;
        label?: string;
        width?: number;
        sortable?: boolean;
        editable?: boolean;
        format?: (value: any, row: any) => string;
    }[];
    rows?: object[];
    sortable?: boolean;
    filter?: boolean;
    pageSize?: number;
    selectable?: boolean;
    resizableColumns?: boolean;
    virtual?: {
        height?: number;
        rowHeight?: number;
        overscan?: number;
    } | boolean;
    onColumnResize?: (key: string, width: number) => void;
    onSelectionChange?: (rows: object[]) => void;
    onEdit?: (row: object, key: string, value: any, oldValue: any) => (boolean | void);
    onRowClick?: (row: object) => void;
    emptyText?: string;
    cellClass?: (row: object, column: object) => (string | string[] | null | undefined);
    rowClass?: (row: object) => (string | string[] | null | undefined);
    focusableRows?: boolean;
    rowLabel?: (row: object) => string;
    density?: "normal" | "compact";
    wrap?: boolean;
    dataSource?: (query: {
        page: number;
        pageSize: number;
        cursor: any;
        sort: ({
            key: string;
            descending: boolean;
        } | null);
        filter: string;
    }) => Promise<{
        rows: object[];
        total?: number;
        nextCursor?: any;
    }>;
    chunkSize?: number;
    animateRows?: boolean;
    filterDelay?: number;
    rowActions?: {
        label: string;
        onclick: (row: object) => void;
        danger?: boolean;
        hidden?: (row: object) => boolean;
        ariaLabel?: (row: object) => string;
    }[];
}): {
    element: HTMLElement;
    update: Function;
    destroy: Function;
    setRows: Function;
    getSelected: () => object[];
    clearSelection: Function;
    getColumnWidths: () => {
        [x: string]: number;
    };
    toCsv: () => string;
    exportCsv: (filename?: string) => void;
};
