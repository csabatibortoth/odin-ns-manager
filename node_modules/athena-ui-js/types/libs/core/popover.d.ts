/** Opens it: showPopover(), or without the API: the element is no longer hidden. Does nothing when it is open already. */
export function openPopover(element: any): void;
/** Closes it. Does nothing when it is closed already. */
export function closePopover(element: any): void;
/**
 * Where a popover goes, next to the element it belongs to, before it is shown (so there is no frame at the wrong place). Only the side and the alignment
 * are chosen here, from the position of the anchor in the window: the popover is moved with CSS (translate) by its own size. Once it is shown,
 * `settlePopover` measures it and keeps it inside the window.
 *
 * @param {Element} anchor the button or the target of the tooltip
 * @param {HTMLElement} popover
 * @param {object} [options]
 * @param {"bottom"|"top"|"auto"} [options.side="auto"] "bottom": below. "top": above, unless there is less than `room` px above. "auto": below,
 *        unless there is less than `room` px below and more room above
 * @param {"start"|"end"|"center"} [options.align="start"] which edge of the anchor the popover lines up with
 * @param {number} [options.gap=4] px between the anchor and the popover
 * @param {number} [options.room=240] how much room a side needs, in px (a tooltip needs about 40)
 */
export function placePopover(anchor: Element, popover: HTMLElement, { side, align, gap, room }?: {
    side?: "bottom" | "top" | "auto";
    align?: "start" | "end" | "center";
    gap?: number;
    room?: number;
}): void;
/**
 * After the popover is shown: measures it and moves it back inside the window when it sticks out to the left, the right or the bottom (a popover that
 * is taller than the room is left where it is: it scrolls).
 */
export function settlePopover(popover: any): void;
/**
 * Keeps an open popover next to its anchor while the page scrolls or the window changes size. Returns a function that stops it.
 * (A popover in the top layer does not move with its anchor by itself.)
 */
export function followAnchor(anchor: any, popover: any, options: any): () => void;
export function supportsPopover(): boolean;
export function isOpen(element: any): any;
