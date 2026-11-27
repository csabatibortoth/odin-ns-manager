//Widget gallery of Athena UI: the registered widget types, to be added to a grid by a click, the keyboard, or by dragging one onto the grid.
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { asHandle, el, resolveElement } from "../../core/dom.js";
import { translate } from "../../core/i18n.js";
import { getWidgetType, getWidgetTypes } from "./widgetGrid.js";

const DRAG_DISTANCE = 6;      // px: less than this is a click

/**
 * A list of widget types for a grid. Every type is a button (click, Enter or Space adds it), so dragging is never the only way.
 * A mouse or pen can drag the whole button; a finger drags by the grip, so that swiping over the list still scrolls the page.
 *
 * @param {object} options
 * @param {string|HTMLElement} options.element the container
 * @param {object} options.grid the handle of createWidgetGrid
 * @param {string[]} [options.types] which types, in this order (default: every registered type)
 * @param {boolean} [options.withSettings=false] open the settings of a new widget; dismissing them adds nothing
 * @param {string} [options.label] accessible name of the list
 * @param {(id: string, type: string) => void} [options.onAdd] called after a widget was added
 * @returns the handle: { element, update() (draw the list again, after new types were registered), destroy() }
 */
export function createWidgetGallery(options = {}) {
    const element = resolveElement(options.element);
    if (!element) throw new TypeError("Athena UI: createWidgetGallery needs an element");
    const { grid } = options;
    if (typeof grid?.beginDrop !== "function") throw new TypeError("Athena UI: createWidgetGallery needs the grid of createWidgetGrid");

    const list = el("ul", { class: "athena-widget-gallery", attrs: { "aria-label": options.label ?? translate("widget.gallery") } });
    element.append(list);
    let drag = null;
    let dragged = false;      // the click that follows a drag must not add a second widget

    const added = async result => {
        const id = await result;
        if (id) options.onAdd?.(id, grid.getWidget(id)?.type);
    };

    async function add(type) {
        try {
            await added(options.withSettings ? grid.addWidgetWithSettings(type) : grid.addWidget(type));
        } catch (error) {
            console.warn("Athena UI: the widget could not be added", error);
        }
    }

    function end(drop) {
        const current = drag;
        if (!current) return;
        drag = null;
        current.stop();
        if (!current.session) return;
        if (drop) added(current.session.drop({ withSettings: options.withSettings }));
        else current.session.cancel();
    }

    function start(event, button, type) {
        dragged = false;
        if (drag || event.button !== 0) return;
        if (event.pointerType === "touch" && !event.target.closest(".widget-gallery-grip")) return;
        const current = { session: null, stop: null };
        drag = current;
        const move = moveEvent => {
            if (moveEvent.pointerId !== event.pointerId) return;
            if (!current.session) {
                if (Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) < DRAG_DISTANCE) return;
                current.session = grid.beginDrop(type);
                if (!current.session) return end(false);
                dragged = true;
                button.classList.add("is-dragging");
            }
            current.session.move(moveEvent.clientX, moveEvent.clientY);
        };
        const up = upEvent => upEvent.pointerId === event.pointerId && end(true);
        const cancel = cancelEvent => cancelEvent.pointerId === event.pointerId && end(false);
        const escape = keyEvent => {
            if (keyEvent.key !== "Escape") return;
            keyEvent.preventDefault();
            end(false);
        };
        const doc = button.ownerDocument;
        const listeners = [["pointermove", move], ["pointerup", up], ["pointercancel", cancel], ["keydown", escape]];
        for (const [name, fn] of listeners) doc.addEventListener(name, fn);
        current.stop = () => {
            for (const [name, fn] of listeners) doc.removeEventListener(name, fn);
            button.classList.remove("is-dragging");
        };
    }

    function render() {
        end(false);
        const types = (options.types ?? getWidgetTypes()).map(getWidgetType).filter(Boolean);
        list.replaceChildren(...types.map(({ type, title, description }) => {
            const button = el("button", { class: "widget-gallery-item", attrs: { type: "button", "data-widget-type": type } },
                el("span", { class: "widget-gallery-grip", text: "⠿", attrs: { "aria-hidden": "true" } }),
                el("span", { class: "widget-gallery-text" },
                    el("span", { class: "widget-gallery-title", text: title }),
                    description ? el("span", { class: "widget-gallery-description", text: description }) : null));
            button.addEventListener("pointerdown", event => start(event, button, type));
            button.addEventListener("click", () => {
                if (dragged) {
                    dragged = false;
                    return;
                }
                add(type);
            });
            return el("li", {}, button);
        }));
    }

    render();

    return asHandle({
        element: list,
        update: render,
        destroy() {
            end(false);
            list.remove();
        }
    });
}
