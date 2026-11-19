export function focusableIn(container: any): any[];
/**
 * Keeps Tab inside the container, calls onEscape on Esc and moves the focus into the container.
 * Returns a release function that restores the previous focus.
 */
export function trapFocus(container: any, { onEscape }?: {}): () => void;
