//The minimap of the code editor: the whole text as small coloured bars beside it. A picture for the eyes (aria-hidden): scrolling works without it.
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { el } from "../../core/dom.js";

const WIDTH = 80;
const MAX_LINES = 20000;

/** @returns {{element: HTMLElement, draw: (lines: {type: string|null, text: string}[][]) => void, destroy: () => void}} */
export function createMinimap(scroller) {
    const canvas = el("canvas", { class: "code-minimap-canvas" });
    const view = el("div", { class: "code-minimap-view" });
    const element = el("div", { class: "code-minimap", attrs: { "aria-hidden": "true" } }, canvas, view);
    let drawn = [];
    let step = 2;
    let frame = 0;

    function place() {
        const height = Math.min(drawn.length * step, element.clientHeight);
        const total = scroller.scrollHeight || 1;
        view.style.setProperty("--code-minimap-top", `${Math.round(scroller.scrollTop / total * height)}px`);
        view.style.setProperty("--code-minimap-size", `${Math.round(Math.min(1, scroller.clientHeight / total) * height)}px`);
    }

    function paint() {
        frame = 0;
        const height = element.clientHeight;
        const context = canvas.getContext("2d");
        if (!context || !height) return;
        canvas.width = WIDTH;
        canvas.height = height;
        step = Math.min(3, height / Math.max(drawn.length, 1));
        const style = element.ownerDocument.defaultView.getComputedStyle(element);
        const colours = new Map();
        const colour = type => {
            if (!colours.has(type)) colours.set(type, (type && style.getPropertyValue(`--athena-tok-${type}`).trim()) || style.color);
            return colours.get(type);
        };
        drawn.slice(0, MAX_LINES).forEach((tokens, index) => {
            let x = 4;
            for (const token of tokens) {
                const text = token.text.replace(/\t/g, "    ");
                const lead = text.length - text.trimStart().length;
                const width = text.trim().length;
                if (width && x + lead < WIDTH) {
                    context.fillStyle = colour(token.type);
                    context.fillRect(x + lead, index * step, Math.min(width, WIDTH - x - lead), Math.max(1, step - 1));
                }
                x += text.length;
                if (x >= WIDTH) break;
            }
        });
        place();
    }

    const go = event => {
        const box = element.getBoundingClientRect();
        const height = Math.min(drawn.length * step, box.height) || 1;
        scroller.scrollTop = Math.max(0, Math.min(1, (event.clientY - box.top) / height)) * scroller.scrollHeight - scroller.clientHeight / 2;
    };
    element.addEventListener("pointerdown", event => {
        event.preventDefault();
        try { element.setPointerCapture(event.pointerId); } catch { /* the pointer is gone */ }
        go(event);
    });
    element.addEventListener("pointermove", event => {
        if (element.hasPointerCapture?.(event.pointerId)) go(event);
    });
    scroller.addEventListener("scroll", place, { passive: true });
    const resizing = typeof ResizeObserver === "function" ? new ResizeObserver(() => paint()) : null;
    resizing?.observe(element);

    return {
        element,
        draw(lines) {
            drawn = lines;
            if (!frame) frame = requestAnimationFrame(paint);
        },
        destroy() {
            cancelAnimationFrame(frame);
            resizing?.disconnect();
            scroller.removeEventListener("scroll", place);
            element.remove();
        }
    };
}
