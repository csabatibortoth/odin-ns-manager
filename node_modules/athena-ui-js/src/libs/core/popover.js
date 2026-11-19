//popover helpers for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

// The native popover API (the `popover` attribute) gives a dropdown or a tooltip what it needs without a line of script: it is drawn in the top layer (above
// everything, never cut off by an overflow of a parent), a click outside or Esc closes it, and the focus goes back. What it does not do is place the popover
// next to its button: that is placePopover() below, which sets two CSS variables (allowed under a strict Content-Security-Policy: no inline style attribute)
// that the stylesheet reads. Browsers without the popover API (before 2023 to 2024) get the plain fallback: the element is shown and hidden with `hidden`.

/** True when the browser has the popover API. */
export const supportsPopover = () => typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype && typeof HTMLElement.prototype.showPopover === "function";

/** Is the popover (or the fallback element) open? */
export const isOpen = element => (supportsPopover() && element.hasAttribute("popover") ? element.matches(":popover-open") : !element.hidden);

/** Opens it: showPopover(), or without the API: the element is no longer hidden. Does nothing when it is open already. */
export function openPopover(element) {
    if (isOpen(element)) return;
    if (supportsPopover() && element.hasAttribute("popover")) element.showPopover();
    else element.hidden = false;
}

/** Closes it. Does nothing when it is closed already. */
export function closePopover(element) {
    if (!isOpen(element)) return;
    if (supportsPopover() && element.hasAttribute("popover")) element.hidePopover();
    else element.hidden = true;
}

const EDGE = 4;   // px kept free between the popover and the edge of the window

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
export function placePopover(anchor, popover, { side = "auto", align = "start", gap = 4, room = 240 } = {}) {
    const box = anchor.getBoundingClientRect();
    const height = document.documentElement.clientHeight;
    const above = side === "top" ? box.top >= room : side === "auto" && height - box.bottom < room && box.top > height - box.bottom;
    const x = align === "end" ? box.right : align === "center" ? box.left + box.width / 2 : box.left;
    const y = above ? box.top - gap : box.bottom + gap;
    popover.style.setProperty("--athena-popover-left", `${Math.round(x)}px`);
    popover.style.setProperty("--athena-popover-top", `${Math.round(y)}px`);
    popover.classList.toggle("athena-popover-above", above);
    popover.classList.toggle("athena-popover-end", align === "end");
    popover.classList.toggle("athena-popover-center", align === "center");
}

/**
 * After the popover is shown: measures it and moves it back inside the window when it sticks out to the left, the right or the bottom (a popover that
 * is taller than the room is left where it is: it scrolls).
 */
export function settlePopover(popover) {
    const box = popover.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    const dx = box.left < EDGE ? EDGE - box.left : box.right > width - EDGE ? width - EDGE - box.right : 0;
    const dy = box.bottom > height - EDGE && box.top - (box.bottom - (height - EDGE)) >= EDGE ? height - EDGE - box.bottom : 0;
    if (dx) popover.style.setProperty("--athena-popover-left", `${Math.round(parseFloat(popover.style.getPropertyValue("--athena-popover-left")) + dx)}px`);
    if (dy) popover.style.setProperty("--athena-popover-top", `${Math.round(parseFloat(popover.style.getPropertyValue("--athena-popover-top")) + dy)}px`);
}

/**
 * Keeps an open popover next to its anchor while the page scrolls or the window changes size. Returns a function that stops it.
 * (A popover in the top layer does not move with its anchor by itself.)
 */
export function followAnchor(anchor, popover, options) {
    let queued = false;
    const update = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            if (!isOpen(popover)) return;
            placePopover(anchor, popover, options);
            settlePopover(popover);
        });
    };
    window.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
        window.removeEventListener("scroll", update, { capture: true });
        window.removeEventListener("resize", update);
    };
}
