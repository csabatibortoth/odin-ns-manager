/**
 * Generates a drag-and-drop area. Files dropped on it (or picked with the browser dialog after a click / Enter / Space)
 * are checked against `accept`, `maxSize` and `maxFiles`; the valid ones are passed to `onDrop`, the rest to `onReject`.
 * Nothing is read or sent: what to do with the files is up to the caller (generateFileUpload builds on this).
 *
 * @param {object} options
 * @param {string|Element} [options.parent]
 * @param {string} [options.id]
 * @param {string} [options.class]
 * @param {*} [options.content] text, Node, array or function; the default is the localized "Drop files here" text
 * @param {string} [options.accept] like ".png,image/*"
 * @param {boolean} [options.multiple=true]
 * @param {number} [options.maxSize] bytes per file
 * @param {number} [options.maxFiles] files accepted per drop
 * @param {boolean} [options.clickable=true] click / Enter / Space opens the file dialog
 * @param {boolean} [options.disabled=false]
 * @param {(files: File[]) => void} [options.onDrop] valid files
 * @param {(rejected: {file: File, reason: string}[]) => void} [options.onReject]
 * @param {(over: boolean) => void} [options.onDragChange] a drag entered / left the area
 * @returns {{element: HTMLElement, input: HTMLInputElement, handleFiles: (files: Iterable<File>) => void,
 *            setDisabled: (disabled: boolean) => void, open: () => void}}
 */
export function createDropZone(options?: {
    parent?: string | Element;
    id?: string;
    class?: string;
    content?: any;
    accept?: string;
    multiple?: boolean;
    maxSize?: number;
    maxFiles?: number;
    clickable?: boolean;
    disabled?: boolean;
    onDrop?: (files: File[]) => void;
    onReject?: (rejected: {
        file: File;
        reason: string;
    }[]) => void;
    onDragChange?: (over: boolean) => void;
}): {
    element: HTMLElement;
    input: HTMLInputElement;
    handleFiles: (files: Iterable<File>) => void;
    setDisabled: (disabled: boolean) => void;
    open: () => void;
};
/** Generates a drag-and-drop area into `parent`, see createDropZone. */
export function generateDropZone(options?: {}): any;
