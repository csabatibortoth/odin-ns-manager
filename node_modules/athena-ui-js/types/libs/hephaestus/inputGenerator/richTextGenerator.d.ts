/**
 * Generates a rich text editor. The content is HTML restricted to a safe set of tags (paragraphs, headings,
 * bold / italic / underline / strike, lists, quotes, code, links); everything else, including scripts, styles,
 * event attributes and `javascript:` links, is removed when the content is set, pasted and read.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.id]
 * @param {string} [options.label]
 * @param {string} [options.value] initial HTML
 * @param {string} [options.placeholder]
 * @param {string[]} [options.toolbar] button names (bold, italic, underline, strike, h2, h3, quote, ul, ol, link,
 *        unlink, clear, undo, redo, source) and "|" separators. `source` switches between the visual editor and
 *        the sanitized HTML source.
 * @param {number} [options.minHeight=140] px
 * @param {boolean} [options.disabled]
 * @param {(html: string) => void} [options.onChange]
 * @returns {{element: HTMLElement, editor: HTMLElement, getValue: () => string, setValue: (html: string) => void,
 *            getText: () => string, focus: Function}}
 */
export function createRichText(options?: {
    parent?: string | Element;
    id?: string;
    label?: string;
    value?: string;
    placeholder?: string;
    toolbar?: string[];
    minHeight?: number;
    disabled?: boolean;
    onChange?: (html: string) => void;
}): {
    element: HTMLElement;
    editor: HTMLElement;
    getValue: () => string;
    setValue: (html: string) => void;
    getText: () => string;
    focus: Function;
};
/** Generates a labelled rich text editor, see createRichText. */
export function generateRichText(options?: {}): any;
export function createWysiwyg(options?: {}): {
    element: HTMLElement;
    editor: HTMLElement;
    getValue: () => string;
    setValue: (html: string) => void;
    getText: () => string;
    focus: Function;
};
export function generateWysiwyg(options?: {}): any;
