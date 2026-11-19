/**
 * Generates tabs. Arrow keys, Home and End move between the tabs.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.id]
 * @param {{id: string, label: string, content: *, disabled?: boolean}[]} options.tabs content is text, a Node,
 *        an array, or a function called once when the tab is first shown (lazy content)
 * @param {string} [options.active] id of the initially active tab (default: the first)
 * @param {(id: string) => void} [options.onChange]
 * @returns {{element: HTMLElement, select: (id: string) => void, getActive: () => string}}
 */
export function generateTabs(options?: {
    parent?: string | Element;
    id?: string;
    tabs: {
        id: string;
        label: string;
        content: any;
        disabled?: boolean;
    }[];
    active?: string;
    onChange?: (id: string) => void;
}): {
    element: HTMLElement;
    select: (id: string) => void;
    getActive: () => string;
};
/**
 * Generates breadcrumbs. The last item is the current page.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {{label: string, href?: string, onclick?: Function}[]} options.items
 */
export function generateBreadcrumbs(options?: {
    parent?: string | Element;
    items: {
        label: string;
        href?: string;
        onclick?: Function;
    }[];
}): any;
/**
 * Generates a page selector.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {number} options.total number of items
 * @param {number} [options.pageSize=10]
 * @param {number} [options.page=1]
 * @param {number} [options.siblings=1] page buttons shown next to the current page
 * @param {(page: number) => void} [options.onChange]
 * @returns {{element: HTMLElement, setPage: Function, setTotal: Function, getPage: Function}}
 */
export function generatePagination(options?: {
    parent?: string | Element;
    total: number;
    pageSize?: number;
    page?: number;
    siblings?: number;
    onChange?: (page: number) => void;
}): {
    element: HTMLElement;
    setPage: Function;
    setTotal: Function;
    getPage: Function;
};
/**
 * Generates collapsible panels.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {{id?: string, title: string, content: *, open?: boolean}[]} options.items
 * @param {boolean} [options.multiple=false] allow several panels to be open at once
 * @returns {{element: HTMLElement, toggle: (index: number, open?: boolean) => void}}
 */
export function generateAccordion(options?: {
    parent?: string | Element;
    items: {
        id?: string;
        title: string;
        content: any;
        open?: boolean;
    }[];
    multiple?: boolean;
}): {
    element: HTMLElement;
    toggle: (index: number, open?: boolean) => void;
};
/**
 * Generates a button that opens a menu. Arrow keys move through the items, Esc closes it, and so does a click outside.
 * The menu is a native popover (the `popover` attribute): it is drawn above everything, so no parent can cut it off, and the browser takes care of the
 * light dismiss and of the focus. It is placed next to the button, below it, or above it when there is no room below. Browsers without the popover API
 * get a plain menu that is shown and hidden with `hidden`.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.label] button text (leave it out for an icon-only button, and give `ariaLabel`)
 * @param {string|Node} [options.icon] shown before the label, text or a Node (e.g. an SVG); hidden from screen readers
 * @param {string} [options.ariaLabel] accessible name, needed when there is no label
 * @param {boolean} [options.caret=false] show a small arrow after the label
 * @param {string} [options.toggleClass] extra CSS class(es) of the toggle button
 * @param {{label?: string, onclick?: Function, href?: string, disabled?: boolean, divider?: boolean}[]} options.items
 * @param {"left"|"right"} [options.align="left"]
 * @returns {{element: HTMLElement, open: Function, close: Function}}
 */
export function generateDropdown(options?: {
    parent?: string | Element;
    label?: string;
    icon?: string | Node;
    ariaLabel?: string;
    caret?: boolean;
    toggleClass?: string;
    items: {
        label?: string;
        onclick?: Function;
        href?: string;
        disabled?: boolean;
        divider?: boolean;
    }[];
    align?: "left" | "right";
}): {
    element: HTMLElement;
    open: Function;
    close: Function;
};
/**
 * Generates a vertical navigation with nested items. On small screens it collapses behind a toggle button.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {{id: string, label: string, icon?: string, href?: string, children?: object[]}[]} options.items
 * @param {(item: object) => void} [options.onSelect]
 * @param {string} [options.active] id of the initially selected item
 * @returns {{element: HTMLElement, select: (id: string) => void, toggle: Function}}
 */
export function generateSidebar(options?: {
    parent?: string | Element;
    items: {
        id: string;
        label: string;
        icon?: string;
        href?: string;
        children?: object[];
    }[];
    onSelect?: (item: object) => void;
    active?: string;
}): {
    element: HTMLElement;
    select: (id: string) => void;
    toggle: Function;
};
