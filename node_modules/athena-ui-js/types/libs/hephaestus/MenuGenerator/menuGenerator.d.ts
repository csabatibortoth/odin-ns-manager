/** The text of a badge: numbers above 99 become "99+", 0 / null / false / "" mean no badge. */
export function badgeText(value: any): string;
/**
 * Generates a navigation menu. Items are real links (`href`) or buttons, so the keyboard and screen readers work without help:
 * Tab reaches every item, Enter and Space use it, the arrow keys move inside a group, Esc closes it.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {MenuItem[]} options.items
 *        `icon` is shown before the label (text, or a Node such as an SVG; it is hidden from screen readers).
 *        `badge` is a small count or word after the label (0, null and "" show nothing, numbers above 99 show "99+").
 *        `badgeLabel` is what a screen reader hears for it ("3 unread"); without it the badge text is read after the label.
 *        `avatar` shows the picture (or the initials) of a person: for the user menu, usually with `align: "end"` and children.
 *        An item with `children` opens a group; a child can have children too (a group inside a group, any depth).
 * @param {(item: MenuItem, event: Event) => void} [options.onNavigate] called when a PERSON uses an item (click, Enter, Space).
 *        It is never called by select() or while the menu is built.
 * @param {string} [options.active] id of the item that is the current page at the start
 * @param {boolean} [options.followHash=false] the item whose `href` equals location.hash is the active one, and follows hashchange
 * @param {"bar"|"bottom-tabs"|"responsive"} [options.layout="bar"] "bottom-tabs": a bar of tabs at the bottom of the screen,
 *        groups open as sheets above it. "responsive": a bar on wide screens, bottom tabs on a tablet or phone (max 700px).
 * @param {string} [options.label] accessible name of the navigation
 * @param {string} [options.id]
 * @param {string} [options.class]
 * @returns {{element: HTMLElement, select: (id: string|null) => void, getActive: () => string|null, setBadge: (id: string, badge) => void,
 *            close: Function, update: (changes?: {items?: object[]}) => object, destroy: Function}}
 */
export function generateMenu(options?: {
    parent?: string | Element;
    items: MenuItem[];
    onNavigate?: (item: MenuItem, event: Event) => void;
    active?: string;
    followHash?: boolean;
    layout?: "bar" | "bottom-tabs" | "responsive";
    label?: string;
    id?: string;
    class?: string;
}): {
    element: HTMLElement;
    select: (id: string | null) => void;
    getActive: () => string | null;
    setBadge: (id: string, badge: any) => void;
    close: Function;
    update: (changes?: {
        items?: object[];
    }) => object;
    destroy: Function;
};
export type MenuItem = {
    id: string;
    label: string;
    icon?: string | Node;
    href?: string;
    disabled?: boolean;
    align?: "end";
    badge?: number | string | {
        text: (number | string);
        tone?: "info" | "ok" | "warn" | "bad";
    };
    badgeLabel?: string;
    avatar?: {
        name: string;
        src?: string;
    };
    children?: MenuItem[];
};
