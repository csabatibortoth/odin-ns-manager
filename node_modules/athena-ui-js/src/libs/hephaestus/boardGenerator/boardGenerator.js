//Board of Athena UI: columns of cards (a Kanban board) whose cards a person moves with the mouse, with a finger or with the keyboard.
//The board owns its container. It shows what it is given and tells the application what the person did (onMove); the application keeps the data.
//Cards are shown as text (or built by the application's renderCard): the board never parses HTML.
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

import { asHandle, el, resolveElement, uid } from "../../core/dom.js";
import { translate } from "../../core/i18n.js";
import { clamp, columnAt, focusStep, indexAt, scrollSpeed, stepOf } from "../../core/boardLayout.js";

const SAFE_ID = /^[\w.:-]{1,100}$/;
const MAX_COLUMNS = 50;
const INTERACTIVE = "a[href], button, input, select, textarea, summary, label, [contenteditable], [data-board-no-drag]";
const DRAG_START = 5; // pixels the pointer has to travel before a press becomes a drag

const isThenable = value => value !== null && typeof value === "object" && typeof value.then === "function";

/**
 * A board of columns and cards.
 *
 * @typedef {object} BoardColumn
 * @property {string} id a short name of letters, digits and . _ : - (it is what onMove reports)
 * @property {string} [title] the heading of the column (default: the id)
 *
 * @typedef {{ id: string, column: string, title?: string, [field: string]: any }} BoardCard
 *   id: a short name of letters, digits and . _ : -; column: the id of the column the card is in (the order of the cards in the array is their order in the column);
 *   title: the text of the card when there is no renderCard; any other field is kept and given back
 *
 * @typedef {object} BoardMove
 * @property {string} id the card
 * @property {BoardCard} card the object that was given for the card
 * @property {{column: string, index: number}} from where it was
 * @property {{column: string, index: number}} to where it is now (the board shows it there already)
 *
 * @param {object} options
 * @param {string|HTMLElement} options.element the container (the board owns it)
 * @param {BoardColumn[]} options.columns the columns, left to right (1 to 50)
 * @param {BoardCard[]} [options.cards] the cards (other fields are kept and given to renderCard and the events)
 * @param {string} [options.label] the accessible name of the board
 * @param {number} [options.headingLevel=3] the heading level of the column titles (2 to 6)
 * @param {boolean} [options.movable=true] false: the cards can not be moved
 * @param {boolean} [options.collapsible=true] false: no fold button on the columns
 * @param {string[]} [options.collapsed] the columns that are folded at the start
 * @param {number} [options.maxCards=5000]
 * @param {(card: BoardCard, container: HTMLElement) => void} [options.renderCard] builds the inside of a card (use text nodes: the board adds nothing else)
 * @param {(move: BoardMove) => (boolean|void|Promise<boolean|void>)} [options.onMove] called after a card was moved. The board shows the card in its new place at once; when this
 *        returns false, throws or rejects, the card goes back (and a message is announced). Return a promise to wait for a server.
 * @param {(error: unknown, move: BoardMove) => void} [options.onMoveError] called when onMove threw or rejected (the card is back by then)
 * @param {(card: BoardCard) => void} [options.onOpen] a click on a card (not on a link or a button inside it) or Enter on it
 * @param {(columnId: string, collapsed: boolean) => void} [options.onCollapse] a column was folded or shown by the person
 * @returns the handle: { element, update, setCards, setColumns, moveCard, getCards, getColumns, collapse, isCollapsed, focusCard, destroy }
 */
export function createBoard(options = {}) {
    const element = resolveElement(options.element);
    if (!element) throw new TypeError("Athena UI: createBoard needs an element");
    const headingLevel = clamp(Math.round(Number(options.headingLevel ?? 3)), 2, 6);
    const movable = options.movable !== false;
    const collapsible = options.collapsible !== false;
    const maxCards = clamp(Math.round(Number(options.maxCards ?? 5000)), 1, 50000);
    const collapsed = new Set(options.collapsed ?? []);

    /** @type {{id: string, title: string}[]} */ let columns = [];
    /** @type {Map<string, {id: string, column: string, data: object, signature: string|null, node?: HTMLElement}>} */ const cards = new Map();
    /** @type {Map<string, string[]>} */ const lanes = new Map();
    /** @type {Map<string, {root: HTMLElement, body: HTMLElement, count: HTMLElement, fold: HTMLElement|null, empty: HTMLElement}>} */ const parts = new Map();
    let carry = null;      // a card picked up with the keyboard: { id, origin: {column, index}, position: {column, index} }
    let drag = null;       // a card dragged with a pointer
    let tabStop = null;    // the card that is in the tab order
    let destroyed = false;
    let suppressClick = false;
    let reshuffling = false; // the board is moving its own nodes: the browser reports the focus as lost, which is not the person leaving

    const hintId = uid("athena-board-hint");
    const live = el("div", { class: "athena-visually-hidden", attrs: { role: "status", "aria-live": "polite" } });
    const hint = el("p", { class: "athena-visually-hidden", id: hintId, text: translate("board.hint") });
    element.after(live, hint);
    element.classList.add("athena-board");
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", options.label ?? translate("board.label"));
    const announce = text => {
        live.textContent = "";
        live.textContent = text;
    };

    // ---------------- the data ----------------
    function readColumns(list) {
        if (!Array.isArray(list) || list.length < 1 || list.length > MAX_COLUMNS) throw new TypeError(`Athena UI: a board needs 1 to ${MAX_COLUMNS} columns`);
        const seen = new Set();
        return list.map(column => {
            if (typeof column?.id !== "string" || !SAFE_ID.test(column.id)) throw new TypeError("Athena UI: a column id is a short name of letters, digits and . _ : -");
            if (seen.has(column.id)) throw new TypeError(`Athena UI: the column id "${column.id}" is used twice`);
            seen.add(column.id);
            return { id: column.id, title: String(column.title ?? column.id) };
        });
    }
    function readCards(list, known) {
        if (!Array.isArray(list)) throw new TypeError("Athena UI: the cards of a board are an array");
        if (list.length > maxCards) throw new RangeError(`Athena UI: a board shows at most ${maxCards} cards`);
        const seen = new Set();
        return list.map(card => {
            if (typeof card?.id !== "string" || !SAFE_ID.test(card.id)) throw new TypeError("Athena UI: a card id is a short name of letters, digits and . _ : -");
            if (seen.has(card.id)) throw new TypeError(`Athena UI: the card id "${card.id}" is used twice`);
            if (!known.has(card.column)) throw new TypeError(`Athena UI: the card "${card.id}" is in the column "${card.column}", which does not exist`);
            seen.add(card.id);
            let signature = null;
            try { signature = JSON.stringify(card); } catch { /* shown again every time */ }
            return { id: card.id, column: card.column, data: card, signature };
        });
    }
    const columnIndex = id => columns.findIndex(column => column.id === id);
    const titleOf = id => cards.get(id)?.data.title ?? id;
    const columnTitle = index => columns[index]?.title ?? "";
    const laneWithout = (columnId, id) => lanes.get(columnId).filter(other => other !== id);
    const positionOf = id => {
        const card = cards.get(id);
        return { column: columnIndex(card.column), index: lanes.get(card.column).indexOf(id) };
    };

    // ---------------- the DOM ----------------
    function buildColumns() {
        element.replaceChildren();
        parts.clear();
        for (const column of columns) {
            const titleId = uid("athena-board-title");
            const title = el("h" + headingLevel, { class: "board-column-title", id: titleId, text: column.title });
            const count = el("span", { class: "board-count" });
            const empty = el("div", { class: "board-empty", text: translate("board.empty") });
            const body = el("div", { class: "board-cards", attrs: { role: "list", "aria-labelledby": titleId, "data-column-id": column.id } }, empty);
            const fold = collapsible ? el("button", { class: "board-fold", attrs: { type: "button" }, on: { click: () => toggle(column.id, true) } }) : null;
            const header = el("div", { class: "board-column-header" }, ...(fold ? [fold] : []), title, count);
            const root = el("section", { class: "board-column", attrs: { "data-column-id": column.id, "aria-labelledby": titleId } }, header, body);
            parts.set(column.id, { root, body, count, fold, empty });
            element.append(root);
        }
    }

    function renderInside(card) {
        const container = card.node.querySelector(".board-card-body");
        container.replaceChildren();
        if (typeof options.renderCard === "function") options.renderCard(card.data, container);
        else container.append(el("div", { class: "board-card-title", text: String(card.data.title ?? card.id) }));
    }

    function makeNode(card) {
        const handle = el("span", { class: "board-card-handle", attrs: { "aria-hidden": "true" } });
        const body = el("div", { class: "board-card-body" });
        card.node = el("div", { class: "board-card", attrs: { role: "listitem", tabindex: "-1", "data-card-id": card.id, "aria-describedby": movable ? hintId : false } }, ...(movable ? [handle] : []), body);
        renderInside(card);
    }

    function describeFold(id) {
        const part = parts.get(id);
        const index = columnIndex(id);
        const folded = collapsed.has(id);
        part.root.classList.toggle("is-collapsed", folded);
        part.body.hidden = folded;
        if (part.fold) {
            part.fold.setAttribute("aria-expanded", String(!folded));
            part.fold.setAttribute("aria-label", translate(folded ? "board.unfold" : "board.fold", { column: columnTitle(index) }));
            part.fold.textContent = folded ? "▸" : "▾";
        }
    }

    /** Puts the card nodes of every column in the order of the lanes (only where it differs) and updates the counts. */
    function place() {
        for (const column of columns) {
            const part = parts.get(column.id);
            const ids = lanes.get(column.id);
            const want = ids.map(id => cards.get(id).node);
            const have = [...part.body.children].filter(node => node.classList.contains("board-card"));
            if (want.length !== have.length || want.some((node, i) => node !== have[i])) part.body.replaceChildren(...want, part.empty);
            part.empty.hidden = want.length > 0;
            part.count.textContent = String(want.length);
            part.count.setAttribute("aria-label", translate("board.count", { count: want.length }));
        }
    }

    /** Runs a change of the DOM and gives the focus back to the card that had it (moving a node can drop the focus). */
    function keepingFocus(change) {
        const active = element.contains(document.activeElement) ? document.activeElement.closest?.(".board-card") : null;
        const id = active?.dataset.cardId;
        const was = reshuffling;
        reshuffling = true;
        try { change(); } finally { reshuffling = was; }
        if (id && cards.get(id)?.node && document.activeElement !== cards.get(id).node) { reshuffling = true; try { cards.get(id).node.focus({ preventScroll: true }); } finally { reshuffling = was; } }
    }

    function setTabStop(id) {
        if (tabStop && cards.get(tabStop)?.node) cards.get(tabStop).node.setAttribute("tabindex", "-1");
        tabStop = cards.has(id) ? id : null;
        if (!tabStop) {
            const first = columns.map(column => lanes.get(column.id)[0]).find(Boolean);
            tabStop = first ?? null;
        }
        if (tabStop) cards.get(tabStop).node.setAttribute("tabindex", "0");
    }

    // ---------------- loading data ----------------
    function load(columnList, cardList) {
        if (carry) cancelCarry(false);
        if (drag) endDrag(false);
        const nextColumns = columnList ? readColumns(columnList) : columns;
        const known = new Set(nextColumns.map(column => column.id));
        const nextCards = readCards(cardList ?? [...cards.values()].map(card => card.data), known);
        const rebuilt = nextColumns !== columns;
        columns = nextColumns;
        for (const id of [...collapsed]) if (!known.has(id)) collapsed.delete(id);
        keepingFocus(() => {
            if (rebuilt) { for (const card of cards.values()) card.node?.remove(); buildColumns(); }
            const seen = new Set();
            lanes.clear();
            for (const column of columns) lanes.set(column.id, []);
            for (const next of nextCards) {
                seen.add(next.id);
                const old = cards.get(next.id);
                if (old && old.node) {
                    next.node = old.node;
                    if (old.signature === null || old.signature !== next.signature) { cards.set(next.id, next); renderInside(next); } else cards.set(next.id, next);
                } else { cards.set(next.id, next); makeNode(next); }
                lanes.get(next.column).push(next.id);
            }
            for (const [id, card] of [...cards]) if (!seen.has(id)) { card.node?.remove(); cards.delete(id); }
            for (const column of columns) describeFold(column.id);
            place();
            setTabStop(tabStop);
        });
    }

    // ---------------- folding ----------------
    function toggle(id, byPerson) {
        const now = !collapsed.has(id);
        if (now) collapsed.add(id); else collapsed.delete(id);
        describeFold(id);
        if (byPerson) options.onCollapse?.(id, now);
    }

    // ---------------- moving: the place in the data and the answer to the application ----------------
    function put(id, column, index) {
        const card = cards.get(id);
        lanes.get(card.column).splice(lanes.get(card.column).indexOf(id), 1);
        const lane = lanes.get(column);
        lane.splice(clamp(index, 0, lane.length), 0, id);
        card.column = column;
    }

    async function commit(id, from) {
        const card = cards.get(id);
        const now = positionOf(id);
        const move = { id, card: card.data, from: { column: columns[from.column].id, index: from.index }, to: { column: columns[now.column].id, index: now.index } };
        if (typeof options.onMove !== "function") return;
        card.node.classList.add("is-pending");
        let failed = false;
        let error;
        try {
            let result = options.onMove(move);
            if (isThenable(result)) result = await result;
            failed = result === false;
        } catch (caught) {
            failed = true;
            error = caught;
        }
        card.node?.classList.remove("is-pending");
        if (destroyed || !cards.has(id)) return;
        if (failed) {
            keepingFocus(() => { put(id, move.from.column, move.from.index); place(); });
            announce(translate("board.moveFailed", { title: titleOf(id), column: columnTitle(from.column) }));
            if (error !== undefined) options.onMoveError?.(error, move);
        }
    }

    // ---------------- the keyboard ----------------
    function pickUp(id) {
        const origin = positionOf(id);
        carry = { id, origin, position: { ...origin } };
        cards.get(id).node.classList.add("is-picked");
        const lane = lanes.get(columns[origin.column].id);
        announce(translate("board.pickedUp", { title: titleOf(id), column: columnTitle(origin.column), position: origin.index + 1, total: lane.length }));
    }
    function moveCarry(key) {
        const lengths = columns.map(column => laneWithout(column.id, carry.id).length);
        const next = stepOf(carry.position, key, lengths);
        if (!next) return announce(translate("board.blocked"));
        keepingFocus(() => { put(carry.id, columns[next.column].id, next.index); place(); });
        carry.position = next;
        announce(translate("board.moved", { title: titleOf(carry.id), column: columnTitle(next.column), position: next.index + 1, total: lengths[next.column] + 1 }));
        cards.get(carry.id).node.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
    function drop() {
        const { id, origin, position } = carry;
        carry = null;
        cards.get(id).node.classList.remove("is-picked");
        const total = lanes.get(columns[position.column].id).length;
        announce(translate("board.dropped", { title: titleOf(id), column: columnTitle(position.column), position: position.index + 1, total }));
        if (position.column !== origin.column || position.index !== origin.index) commit(id, origin);
    }
    function cancelCarry(say = true) {
        const { id, origin } = carry;
        carry = null;
        cards.get(id).node.classList.remove("is-picked");
        keepingFocus(() => { put(id, columns[origin.column].id, origin.index); place(); });
        if (say) announce(translate("board.cancelled"));
    }

    function focusCardAt(position) {
        const id = lanes.get(columns[position.column].id)[position.index];
        if (id) { setTabStop(id); cards.get(id).node.focus(); }
    }

    function onKeydown(event) {
        const node = event.target?.closest?.(".board-card");
        if (!node || !element.contains(node) || event.altKey || event.ctrlKey || event.metaKey) return;
        const id = node.dataset.cardId;
        if (carry) {
            if (id !== carry.id) return;
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); moveCarry(event.key); } else if (event.key === " " || event.key === "Enter") { event.preventDefault(); drop(); } else if (event.key === "Escape") { event.preventDefault(); cancelCarry(); }
            return;
        }
        if (event.target !== node) return; // a key inside a control of the card is that control's
        if (event.key === " " && movable) { event.preventDefault(); pickUp(id); return; }
        if (event.key === "Enter") { event.preventDefault(); options.onOpen?.(cards.get(id).data); return; }
        const lengths = columns.map(column => lanes.get(column.id).length);
        const next = focusStep(positionOf(id), event.key, lengths);
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); if (next) focusCardAt(next); }
    }
    function onFocusin(event) {
        const node = event.target?.closest?.(".board-card");
        if (node && element.contains(node) && node.dataset.cardId !== tabStop && !carry) setTabStop(node.dataset.cardId);
    }
    function onFocusout(event) {
        if (reshuffling) return;
        if (carry && !element.contains(event.relatedTarget)) cancelCarry(false); // the focus left the board: nothing stays half moved
    }
    function onClick(event) {
        if (suppressClick) { suppressClick = false; return; }
        if (typeof options.onOpen !== "function") return;
        const node = event.target?.closest?.(".board-card");
        if (!node || !element.contains(node) || event.target.closest?.(INTERACTIVE)) return;
        options.onOpen(cards.get(node.dataset.cardId).data);
    }

    // ---------------- the pointer ----------------
    let press = null;
    function onPointerdown(event) {
        if (!movable || drag || press || event.button !== 0 || !event.isPrimary) return;
        const node = event.target?.closest?.(".board-card");
        if (!node || !element.contains(node)) return;
        const onHandle = Boolean(event.target.closest(".board-card-handle"));
        if (event.target.closest(INTERACTIVE) && !onHandle) return;
        if (event.pointerType === "touch" && !onHandle) return; // a finger on the card scrolls; the handle moves it
        press = { id: node.dataset.cardId, x: event.clientX, y: event.clientY, pointerId: event.pointerId, type: event.pointerType };
        document.addEventListener("pointermove", onPointermove);
        document.addEventListener("pointerup", onPointerup);
        document.addEventListener("pointercancel", onPointercancel);
        document.addEventListener("keydown", onDragKey, true);
    }
    function forgetPress() {
        press = null;
        document.removeEventListener("pointermove", onPointermove);
        document.removeEventListener("pointerup", onPointerup);
        document.removeEventListener("pointercancel", onPointercancel);
        document.removeEventListener("keydown", onDragKey, true);
    }
    function onPointermove(event) {
        if (!press || event.pointerId !== press.pointerId) return;
        if (!drag) {
            if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_START) return;
            beginDrag(event);
        }
        event.preventDefault();
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (!drag.frame) drag.frame = requestAnimationFrame(updateDrag);
    }
    function onPointerup(event) {
        if (!press || event.pointerId !== press.pointerId) return;
        const dragged = Boolean(drag);
        if (dragged) { drag.x = event.clientX; drag.y = event.clientY; updateDrag(); endDrag(true); suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
        forgetPress();
    }
    function onPointercancel(event) {
        if (!press || event.pointerId !== press.pointerId) return;
        if (drag) endDrag(false);
        forgetPress();
    }
    function onDragKey(event) {
        if (event.key === "Escape" && drag) { event.preventDefault(); event.stopPropagation(); endDrag(false); forgetPress(); }
    }

    function beginDrag(event) {
        const card = cards.get(press.id);
        const rect = card.node.getBoundingClientRect();
        const ghost = card.node.cloneNode(true);
        for (const attribute of ["data-card-id", "tabindex", "role", "aria-describedby", "id"]) ghost.removeAttribute(attribute);
        ghost.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
        ghost.classList.add("is-ghost");
        ghost.setAttribute("aria-hidden", "true");
        ghost.style.width = `${rect.width}px`;
        document.body.append(ghost);
        const placeholder = el("div", { class: "board-placeholder", attrs: { "aria-hidden": "true" } });
        placeholder.style.height = `${rect.height}px`;
        drag = { id: press.id, origin: positionOf(press.id), ghost, placeholder, offsetX: press.x - rect.left, offsetY: press.y - rect.top, x: event.clientX, y: event.clientY, frame: 0, scroller: 0, target: null };
        card.node.classList.add("is-dragging");
        element.classList.add("is-dragging-card");
        announce(translate("board.pickedUp", { title: titleOf(press.id), column: columnTitle(drag.origin.column), position: drag.origin.index + 1, total: lanes.get(columns[drag.origin.column].id).length }));
        scrollLoop();
    }

    /** The ghost follows the pointer; the placeholder shows where the card would land. */
    function updateDrag() {
        if (!drag) return;
        drag.frame = 0;
        drag.ghost.style.transform = `translate(${Math.round(drag.x - drag.offsetX)}px, ${Math.round(drag.y - drag.offsetY)}px)`;
        const columnRects = columns.map(column => parts.get(column.id).root.getBoundingClientRect());
        const ci = columnAt(columnRects, drag.x);
        for (const column of columns) parts.get(column.id).root.classList.toggle("is-drop-target", column.id === columns[ci]?.id);
        if (ci < 0) return;
        const id = columns[ci].id;
        const part = parts.get(id);
        const others = laneWithout(id, drag.id);
        let index = others.length;
        if (!collapsed.has(id)) {
            index = indexAt(others.map(other => cards.get(other).node.getBoundingClientRect()), drag.y);
            const before = index < others.length ? cards.get(others[index]).node : part.empty;
            if (drag.placeholder.nextSibling !== before || drag.placeholder.parentNode !== part.body) part.body.insertBefore(drag.placeholder, before);
            part.empty.hidden = true;
        } else drag.placeholder.remove();
        drag.target = { column: ci, index };
    }

    /** The board and the page scroll while the pointer is near their edges. */
    function scrollLoop() {
        if (!drag) return;
        const box = element.getBoundingClientRect();
        const dx = element.scrollWidth > element.clientWidth ? scrollSpeed(drag.x, box.left, box.right) : 0;
        const dy = scrollSpeed(drag.y, 0, globalThis.innerHeight ?? 0);
        if (dx) element.scrollLeft += dx;
        if (dy) globalThis.scrollBy?.(0, dy);
        if (dx || dy) { drag.frame ||= requestAnimationFrame(updateDrag); }
        drag.scroller = requestAnimationFrame(scrollLoop);
    }

    function endDrag(dropIt) {
        const { id, origin, ghost, placeholder, target } = drag;
        cancelAnimationFrame(drag.frame);
        cancelAnimationFrame(drag.scroller);
        const card = cards.get(id);
        ghost.remove();
        placeholder.remove();
        drag = null;
        element.classList.remove("is-dragging-card");
        for (const part of parts.values()) part.root.classList.remove("is-drop-target");
        card.node.classList.remove("is-dragging");
        const moved = dropIt && target && (target.column !== origin.column || target.index !== origin.index);
        if (moved) keepingFocus(() => { put(id, columns[target.column].id, target.index); place(); });
        else place();
        if (!dropIt) announce(translate("board.cancelled"));
        else if (moved) announce(translate("board.dropped", { title: titleOf(id), column: columnTitle(target.column), position: target.index + 1, total: lanes.get(columns[target.column].id).length }));
        if (moved) commit(id, origin);
    }

    // ---------------- start ----------------
    element.addEventListener("keydown", onKeydown);
    element.addEventListener("focusin", onFocusin);
    element.addEventListener("focusout", onFocusout);
    element.addEventListener("click", onClick);
    element.addEventListener("pointerdown", onPointerdown);
    columns = readColumns(options.columns);
    buildColumns();
    load(null, options.cards ?? []);

    const handle = asHandle({
        element,
        /** Shows new data: { columns?, cards? }. The cards that stay keep their element (and the focus). */
        update(next = {}) {
            if (destroyed) return handle;
            load(next.columns ?? null, next.cards ?? null);
            return handle;
        },
        setCards(list) { return handle.update({ cards: list }); },
        setColumns(list) { return handle.update({ columns: list }); },
        /** Moves a card from the application's side (no onMove call). */
        moveCard(id, column, index = Infinity) {
            if (!cards.has(id)) throw new RangeError(`Athena UI: there is no card "${id}"`);
            if (columnIndex(column) < 0) throw new RangeError(`Athena UI: there is no column "${column}"`);
            keepingFocus(() => { put(id, column, index); place(); });
            return handle;
        },
        getCards: () => columns.flatMap(column => lanes.get(column.id).map((id, index) => ({ id, column: column.id, index, card: cards.get(id).data }))),
        getColumns: () => columns.map(column => ({ ...column, collapsed: collapsed.has(column.id) })),
        collapse(id, state = true) {
            if (columnIndex(id) < 0) throw new RangeError(`Athena UI: there is no column "${id}"`);
            if (collapsed.has(id) !== Boolean(state)) toggle(id, false);
            return handle;
        },
        isCollapsed: id => collapsed.has(id),
        focusCard(id) { if (cards.has(id)) { setTabStop(id); cards.get(id).node.focus(); } return handle; },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            if (drag) endDrag(false);
            forgetPress();
            element.removeEventListener("keydown", onKeydown);
            element.removeEventListener("focusin", onFocusin);
            element.removeEventListener("focusout", onFocusout);
            element.removeEventListener("click", onClick);
            element.removeEventListener("pointerdown", onPointerdown);
            element.replaceChildren();
            element.classList.remove("athena-board", "is-dragging-card");
            element.removeAttribute("role");
            element.removeAttribute("aria-label");
            live.remove();
            hint.remove();
        },
    });
    return handle;
}
