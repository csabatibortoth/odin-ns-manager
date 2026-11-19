export function generateHeaderContent(): void;
/**
 * Generates the menu of the header. Without options it is built from the global `menuItems` / nav callback, as before.
 * With `options.items` it is a generateMenu (no globals): `generateHeaderMenu({ items, onNavigate, active, layout, followHash })`.
 */
export function generateHeaderMenu(options: any): {
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
export function clearHeaderMenu(): void;
export function generateHeaderTitle(): void;
export function generateHeaderLogo(): void;
export function generateContaninerForElements(params: any): void;
