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
export function createBoard(options?: {
    element: string | HTMLElement;
    columns: BoardColumn[];
    cards?: BoardCard[];
    label?: string;
    headingLevel?: number;
    movable?: boolean;
    collapsible?: boolean;
    collapsed?: string[];
    maxCards?: number;
    renderCard?: (card: BoardCard, container: HTMLElement) => void;
    onMove?: (move: BoardMove) => (boolean | void | Promise<boolean | void>);
    onMoveError?: (error: unknown, move: BoardMove) => void;
    onOpen?: (card: BoardCard) => void;
    onCollapse?: (columnId: string, collapsed: boolean) => void;
}): any;
/**
 * A board of columns and cards.
 */
export type BoardColumn = {
    /**
     * a short name of letters, digits and . _ : - (it is what onMove reports)
     */
    id: string;
    /**
     * the heading of the column (default: the id)
     */
    title?: string;
};
/**
 * id: a short name of letters, digits and . _ : -; column: the id of the column the card is in (the order of the cards in the array is their order in the column);
 * title: the text of the card when there is no renderCard; any other field is kept and given back
 */
export type BoardCard = {
    id: string;
    column: string;
    title?: string;
    [field: string]: any;
};
/**
 * A board of columns and cards.
 */
export type BoardMove = {
    /**
     * the card
     */
    id: string;
    /**
     * the object that was given for the card
     */
    card: BoardCard;
    /**
     * where it was
     */
    from: {
        column: string;
        index: number;
    };
    /**
     * where it is now (the board shows it there already)
     */
    to: {
        column: string;
        index: number;
    };
};
