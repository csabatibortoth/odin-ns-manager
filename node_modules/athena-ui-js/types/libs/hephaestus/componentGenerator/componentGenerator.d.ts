/**
 * Generates a link. External links open in a new tab and get `rel="noopener noreferrer"`.
 * With `onclick` and no `href` it behaves as an in-page action.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} options.text
 * @param {string} [options.href]
 * @param {boolean} [options.external]
 * @param {(event: Event) => void} [options.onclick]
 * @returns {HTMLAnchorElement}
 */
export function generateLink(options?: {
    parent?: string | Element;
    text: string;
    href?: string;
    external?: boolean;
    onclick?: (event: Event) => void;
}): HTMLAnchorElement;
/**
 * Generates a section with an optional heading. Returns the section, fill it through `content`
 * or append to it.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.title]
 * @param {number} [options.level=2] heading level 1..6
 * @param {string|Node|Array|Function} [options.content]
 * @returns {HTMLElement}
 */
export function generateSection(options?: {
    parent?: string | Element;
    title?: string;
    level?: number;
    content?: string | Node | any[] | Function;
}): HTMLElement;
/**
 * Generates a card.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.title]
 * @param {string} [options.image] image URL shown on top
 * @param {string} [options.imageAlt]
 * @param {string|Node|Array|Function} [options.content]
 * @param {string|Node|Array|Function} [options.footer]
 * @returns {{element: HTMLElement, body: HTMLElement}} append to `body` to add more content
 */
export function generateCard(options?: {
    parent?: string | Element;
    title?: string;
    image?: string;
    imageAlt?: string;
    content?: string | Node | any[] | Function;
    footer?: string | Node | any[] | Function;
}): {
    element: HTMLElement;
    body: HTMLElement;
};
/**
 * Generates a small label.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} options.text
 * @param {"neutral"|"info"|"success"|"warning"|"error"} [options.variant="neutral"]
 * @param {boolean} [options.pill]
 * @returns {HTMLElement}
 */
export function generateBadge(options?: {
    parent?: string | Element;
    text: string;
    variant?: "neutral" | "info" | "success" | "warning" | "error";
    pill?: boolean;
}): HTMLElement;
export function initialsOf(name?: string): string;
/**
 * Generates an avatar: the image, or the initials of the name when there is no (working) image.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.name]
 * @param {string} [options.src]
 * @param {"small"|"large"} [options.size]
 * @returns {HTMLElement}
 */
export function generateAvatar(options?: {
    parent?: string | Element;
    name?: string;
    src?: string;
    size?: "small" | "large";
}): HTMLElement;
/**
 * Generates a KPI tile: a label, a big value and an optional change.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} options.label
 * @param {string|number} options.value
 * @param {number} [options.delta] change in percent, shown with an arrow
 * @param {boolean} [options.invertDelta] a falling value is good news (costs, errors)
 * @param {"ok"|"warn"|"bad"} [options.tone] colours the tile (the class is-ok / is-warn / is-bad) and adds the word to the screen reader text
 * @param {string} [options.note] small text under the value ("of 120 hosts", "updated 2 min ago")
 * @returns {{element: HTMLElement, setValue: Function, setNote: Function, setTone: Function}}
 */
export function generateStat(options?: {
    parent?: string | Element;
    label: string;
    value: string | number;
    delta?: number;
    invertDelta?: boolean;
    tone?: "ok" | "warn" | "bad";
    note?: string;
}): {
    element: HTMLElement;
    setValue: Function;
    setNote: Function;
    setTone: Function;
};
/**
 * Generates a responsive grid. The columns collapse to one on small screens.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {number} [options.columns=3]
 * @param {string} [options.gap] any CSS length
 * @returns {HTMLElement} append the cells to it
 */
export function generateGrid(options?: {
    parent?: string | Element;
    columns?: number;
    gap?: string;
}): HTMLElement;
/**
 * Adds a tooltip to an element. It shows on hover and on keyboard focus, and Esc hides it.
 * It is a native popover (`popover="manual"`), so it is drawn above everything and never cut off by a parent with `overflow: hidden`. A touch
 * does not show it (a tap would hide the thing it describes). Browsers without the popover API show it with CSS, as before.
 *
 * @param {Element|string} target element or id
 * @param {string} text
 */
export function generateTooltip(target: Element | string, text: string): HTMLElement;
/**
 * The top of a page: breadcrumbs, the title (a heading), a description and the actions of the page.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {{label: string, href?: string, onclick?: Function}[]} [options.breadcrumbs] see generateBreadcrumbs
 * @param {(Node|string)[]|Node} [options.actions] buttons, shown at the end of the header
 * @param {1|2|3} [options.level=1] heading level
 * @returns {{element: HTMLElement, setTitle: Function, setDescription: Function, actions: HTMLElement}}
 */
export function generatePageHeader(options?: {
    parent?: string | Element;
    title: string;
    description?: string;
    breadcrumbs?: {
        label: string;
        href?: string;
        onclick?: Function;
    }[];
    actions?: (Node | string)[] | Node;
    level?: 1 | 2 | 3;
}): {
    element: HTMLElement;
    setTitle: Function;
    setDescription: Function;
    actions: HTMLElement;
};
/**
 * A list of facts: a term and its description, in pairs (a <dl>).
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {{term: string, description: (string|number|Node|Array), title?: string}[]} options.items text is inserted as text
 * @param {boolean} [options.inline=false] terms and descriptions side by side
 * @returns {{element: HTMLElement, setItems: Function}}
 */
export function generateFacts(options?: {
    parent?: string | Element;
    items: {
        term: string;
        description: (string | number | Node | any[]);
        title?: string;
    }[];
    inline?: boolean;
}): {
    element: HTMLElement;
    setItems: Function;
};
/**
 * What a list shows when there is nothing in it: a title, a short explanation and what to do about it.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} options.title
 * @param {string} [options.message]
 * @param {string|Node} [options.icon] decorative
 * @param {{text: string, onclick: Function, variant?: string}} [options.action] a button
 */
export function generateEmptyState(options?: {
    parent?: string | Element;
    title: string;
    message?: string;
    icon?: string | Node;
    action?: {
        text: string;
        onclick: Function;
        variant?: string;
    };
}): any;
/**
 * A skeleton: grey lines with a shimmer where text or a card will be, so the page does not jump when it arrives. It is a live region that says
 * "Loading..." to a screen reader; the shimmer stops under reduced motion.
 *
 * @param {object} [options]
 * @param {string|Element} [options.parent]
 * @param {number} [options.lines=3] the last of several lines is shorter
 * @param {string} [options.class] e.g. "skeleton-card" in your own CSS gives the box a height
 */
export function generateSkeleton(options?: {
    parent?: string | Element;
    lines?: number;
    class?: string;
}): any;
/**
 * A placeholder while something loads: a spinner and a text (a live region, so a screen reader says it).
 *
 * @param {object} [options]
 * @param {string|Element} [options.parent]
 * @param {string} [options.text] default: the translated "Loading..."
 */
export function generateLoading(options?: {
    parent?: string | Element;
    text?: string;
}): any;
