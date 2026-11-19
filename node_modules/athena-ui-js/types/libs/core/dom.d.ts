/**
 * Creates an element. This is the safe way to write pages: text is only ever inserted as text, attributes that run code
 * (on*, style, srcdoc) and unsafe addresses (javascript:, data:, ...) in href / src / action are refused, listeners have to be
 * functions, and children can be given as nested lists.
 *
 * @param {string} tag
 * @param {object} [props]
 * @param {string} [props.class]
 * @param {string} [props.id]
 * @param {string} [props.text] set as textContent (never parsed as HTML)
 * @param {Object<string, string|boolean|number>} [props.attrs] attributes, false / null / undefined are skipped
 * @param {Object<string, Function>} [props.on] event listeners (a value that is not a function throws a TypeError)
 * @param {Object<string, *>} [props.prop] DOM properties (value, checked, disabled, ...), not the ones that parse HTML
 * @param {...(Node|string|number|Array|null|false)} children text, nodes, or lists of them
 */
export function el(tag: string, props?: {
    class?: string;
    id?: string;
    text?: string;
    attrs?: {
        [x: string]: string | boolean | number;
    };
    on?: {
        [x: string]: Function;
    };
    prop?: {
        [x: string]: any;
    };
}, ...children: (Node | string | number | any[] | null | false)[]): HTMLElement;
/**
 * Fills a node with content. Strings are inserted as text, never as HTML.
 * Accepts a string / number, a Node, an array of those, or a function returning one.
 */
export function setContent(node: any, content: any): any;
/**
 * Finds an element from an element, an id or a CSS selector ("#list", ".panel > ul").
 * An id wins over a selector with the same text. Returns null when nothing matches.
 */
export function resolveElement(target: any): Element;
export function mount(parent: any, node: any): any;
/**
 * Gives a component the same handle as every other one: { element, update(), destroy() }.
 * What the component already has is kept. `update` does nothing unless the component supports it
 * (it returns the handle), `destroy` removes the element (and `also`, e.g. a wrapper around it).
 */
export function asHandle(handle: any, { element, also }?: {
    element?: any;
}): any;
/**
 * A stricter el(): only the tags and attributes on your lists are allowed, everything else is refused (a tag throws, an attribute is
 * skipped with a warning). For pages that are built from data you do not control, such as a plugin API. The refusals of el() still apply.
 *
 * @param {object} allow
 * @param {string[]} [allow.tags] allowed tag names (default: any)
 * @param {string[]} allow.attributes allowed attribute names, lower case: ["class", "title", "href"]
 * @param {boolean} [allow.dataAndAria=true] data-* and aria-* attributes are allowed too
 * @returns {typeof el}
 */
export function createSafeBuilder({ tags, attributes, dataAndAria }?: {
    tags?: string[];
    attributes: string[];
    dataAndAria?: boolean;
}): typeof el;
export function uid(prefix?: string): string;
export function cx(...classes: any[]): string;
