export function defaultMenuItems(menuId: any, count?: number): {
    id: string;
    class: string;
    text: string;
    inner_text: string;
}[];
/**
 * Generates a menu. An item with `children: [{ inner_text, disabled? }]` opens a submenu on click, Enter, Space
 * or the Down arrow. Esc, a click outside, or choosing an entry closes it. Choosing an entry calls the
 * nav callback with its `inner_text`, like a top level item.
 */
export function generateBasicMenu(options: any): void;
export function generateMenuWireFrame(options: any): void;
export function addMenuItemToWireFrame(options: any): void;
