/**
 * Generates an HTML element and appends it to its parent.
 *
 * @param {object} options
 * @param {string} options.elementType one of `supportedElements`
 * @param {string} [options.parent] id of the parent element; omitted or '' appends to body
 * @param {string} [options.id]
 * @param {string} [options.class]
 * @param {string} [options.text]
 * @param {string} [options.src] img only
 * @param {string} [options.alt] img only
 * @param {*} [options.data] passed to the onclick / onchange handlers
 * @param {(data: *) => void} [options.onclick]
 * @param {(data: *) => void} [options.onchange]
 * @returns {HTMLElement|null} the generated element, or null when generation failed
 */
export function HTMLElementGenerator(options: {
    elementType: string;
    parent?: string;
    id?: string;
    class?: string;
    text?: string;
    src?: string;
    alt?: string;
    data?: any;
    onclick?: (data: any) => void;
    onchange?: (data: any) => void;
}): HTMLElement | null;
export const supportedElements: readonly string[];
export default HTMLElementGenerator;
