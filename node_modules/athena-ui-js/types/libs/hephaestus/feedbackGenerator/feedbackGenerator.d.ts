/**
 * Shows a toast notification in the corner of the page.
 *
 * @param {object|string} options a message, or an options object
 * @param {string} options.message
 * @param {string} [options.title]
 * @param {"info"|"success"|"warning"|"error"} [options.type="info"]
 * @param {number} [options.duration=4000] ms before it disappears, 0 keeps it until it is closed
 * @param {"top-right"|"top-left"|"top-center"|"bottom-right"|"bottom-left"|"bottom-center"} [options.position="top-right"] the corner (or the middle of an edge) of the window.
 *        Every position has its own stack. An application that keeps its main buttons in the top right corner shows its toasts at the bottom.
 * @param {{x?: number, y?: number}} [options.offset] the distance from the edge in px (default 16); also the variables --athena-toast-x and --athena-toast-y
 * @returns {{close: Function}}
 */
export function showToast(options: object | string): {
    close: Function;
};
/**
 * Generates an inline alert box.
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.id]
 * @param {string|Node} options.message
 * @param {string} [options.title]
 * @param {"info"|"success"|"warning"|"error"} [options.type="info"]
 * @param {boolean} [options.dismissible]
 * @returns {HTMLElement}
 */
export function generateAlert(options?: {
    parent?: string | Element;
    id?: string;
    message: string | Node;
    title?: string;
    type?: "info" | "success" | "warning" | "error";
    dismissible?: boolean;
}): HTMLElement;
/**
 * Copies text to the clipboard and says so in a toast. Resolves with true when it worked (it needs a secure page and a click or key
 * press of the person), false otherwise (a toast with the error is shown).
 *
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.message] text of the toast (default: the translated "Copied")
 * @param {boolean} [options.toast=true] false copies silently
 * @returns {Promise<boolean>}
 */
export function copyToClipboard(text: string, { message, toast }?: {
    message?: string;
    toast?: boolean;
}): Promise<boolean>;
/**
 * Generates a loading spinner.
 *
 * @param {object} [options]
 * @param {string|Element} [options.parent]
 * @param {string} [options.id]
 * @param {"small"|"large"} [options.size]
 * @param {string} [options.label] accessible text, defaults to the translated "Loading..."
 * @returns {HTMLElement}
 */
export function generateSpinner(options?: {
    parent?: string | Element;
    id?: string;
    size?: "small" | "large";
    label?: string;
}): HTMLElement;
/**
 * Generates a progress bar. Without a value it is indeterminate.
 *
 * @param {object} [options]
 * @param {string|Element} [options.parent]
 * @param {string} [options.id]
 * @param {number} [options.value] 0..max
 * @param {number} [options.max=100]
 * @param {string} [options.label] text shown above the bar
 * @param {"info"|"success"|"warning"|"error"} [options.type]
 * @returns {{element: HTMLElement, setValue: (value: number) => void}}
 */
export function generateProgress(options?: {
    parent?: string | Element;
    id?: string;
    value?: number;
    max?: number;
    label?: string;
    type?: "info" | "success" | "warning" | "error";
}): {
    element: HTMLElement;
    setValue: (value: number) => void;
};
