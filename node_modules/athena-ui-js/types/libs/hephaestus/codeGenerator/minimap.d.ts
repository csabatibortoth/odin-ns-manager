/** @returns {{element: HTMLElement, draw: (lines: {type: string|null, text: string}[][]) => void, destroy: () => void}} */
export function createMinimap(scroller: any): {
    element: HTMLElement;
    draw: (lines: {
        type: string | null;
        text: string;
    }[][]) => void;
    destroy: () => void;
};
