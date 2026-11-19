/** Splits tokens at the line breaks: an array (one entry per line) of arrays of { type, text }. */
export function tokensToLines(tokens: any): any[][];
/** The nodes of one line: text nodes and <span class="tok-..."> (a span has one class and one text node). */
export function lineNodes(tokens: any): any;
/**
 * Writes the highlighted lines of a text into a <code> element (replacing what is there). The editor uses it too.
 *
 * @param {HTMLElement} code
 * @param {string} text
 * @param {string|object} [language] a name or alias ("js"), or a language object; unknown: plain text
 * @param {object} [options]
 * @param {Array<number|string>} [options.highlightLines] line numbers (1-based) or ranges ("5-8") that get a background
 * @returns {number} the number of lines
 */
export function renderCode(code: HTMLElement, text: string, language?: string | object, { highlightLines }?: {
    highlightLines?: Array<number | string>;
}): number;
/**
 * Highlights read-only code: a `<pre class="athena-code"><code>` element.
 *
 * @param {string} text
 * @param {string|object} [language] "js", "ts", "json", "html", "css", "sql", "sh", "yaml", "c#", "python" or a language you registered
 * @param {object} [options]
 * @param {boolean} [options.lineNumbers=false]
 * @param {Array<number|string>} [options.highlightLines]
 * @param {boolean} [options.wrap=false] long lines wrap instead of scrolling
 * @param {string} [options.label] accessible name of the code
 * @returns {HTMLPreElement}
 */
export function highlightCode(text: string, language?: string | object, { lineNumbers, highlightLines, wrap, label }?: {
    lineNumbers?: boolean;
    highlightLines?: Array<number | string>;
    wrap?: boolean;
    label?: string;
}): HTMLPreElement;
/**
 * A code block: a label with the language, a copy button and the highlighted code.
 *
 * @param {object} options
 * @param {string|HTMLElement} [options.parent]
 * @param {string} options.code
 * @param {string|object} [options.language]
 * @param {string} [options.title] shown in the header instead of the language
 * @param {boolean} [options.lineNumbers=false]
 * @param {Array<number|string>} [options.highlightLines]
 * @param {boolean} [options.copy=true] the copy button
 * @param {boolean} [options.wrap=false]
 * @param {string} [options.id]
 * @returns {{element: HTMLElement, getCode: () => string, setCode: (code: string, language?: string|object) => void, copy: () => Promise<boolean>, destroy: Function}}
 */
export function generateCodeBlock({ parent, code, language, title, lineNumbers, highlightLines, copy, wrap, id }?: {
    parent?: string | HTMLElement;
    code: string;
    language?: string | object;
    title?: string;
    lineNumbers?: boolean;
    highlightLines?: Array<number | string>;
    copy?: boolean;
    wrap?: boolean;
    id?: string;
}): {
    element: HTMLElement;
    getCode: () => string;
    setCode: (code: string, language?: string | object) => void;
    copy: () => Promise<boolean>;
    destroy: Function;
};
/**
 * A view of the difference between two texts, with highlighted code on both sides.
 *
 * @param {object} options
 * @param {string|HTMLElement} [options.parent]
 * @param {string} [options.original]
 * @param {string} [options.modified]
 * @param {string|object} [options.language]
 * @param {"unified"|"split"} [options.mode="unified"]
 * @param {number} [options.context=3] unchanged lines kept around a change (Infinity: all of them); a button shows the rest
 * @param {string} [options.originalLabel]
 * @param {string} [options.modifiedLabel]
 * @returns {{element: HTMLElement, setTexts: (original: string, modified: string) => void, setMode: (mode: string) => void, getStats: () => {added: number, removed: number}}}
 */
export function createDiffView({ parent, original, modified, language, mode, context, originalLabel, modifiedLabel }?: {
    parent?: string | HTMLElement;
    original?: string;
    modified?: string;
    language?: string | object;
    mode?: "unified" | "split";
    context?: number;
    originalLabel?: string;
    modifiedLabel?: string;
}): {
    element: HTMLElement;
    setTexts: (original: string, modified: string) => void;
    setMode: (mode: string) => void;
    getStats: () => {
        added: number;
        removed: number;
    };
};
