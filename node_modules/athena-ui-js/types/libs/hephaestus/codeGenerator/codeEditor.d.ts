/**
 * A code editor.
 *
 * @param {object} options
 * @param {string|HTMLElement} options.element the container
 * @param {string} [options.value]
 * @param {string|object} [options.language] "js", "json", ... or a language object (see registerLanguage)
 * @param {boolean} [options.readOnly=false]
 * @param {boolean} [options.lineNumbers=true]
 * @param {boolean} [options.wrap=false] soft wrap
 * @param {number} [options.tabSize=4]
 * @param {boolean} [options.insertSpaces=true] Tab inserts spaces (false: a tab character)
 * @param {boolean} [options.statusBar=true] line and column, and the message of a marker
 * @param {string} [options.label] accessible name of the editor
 * @param {number} [options.maxHighlightLength=300000] longer texts are shown without highlighting (and without line numbers) to stay fast
 * @param {{line: number, message: string, level?: "error"|"warning"|"info"}[]} [options.markers] lint markers (lines count from 1)
 * @param {{from: number, to: number}[]} [options.readOnlyRanges] lines (1-based, inclusive) that cannot be changed
 * @param {(context: {value: string, position: number, line: number, lineText: string, prefix: string, explicit: boolean, language: string}) => (Array<{label: string, insert?: string, detail?: string}>|Promise<Array>)} [options.provideCompletions]
 * @param {boolean} [options.autoComplete=true] with provideCompletions: suggest while typing (otherwise only with Ctrl+Space)
 * @param {(value: string, reason: string) => void} [options.onChange] after every change made by typing, undo, redo, replace ... (not after setValue)
 * @returns the handle: { element, textarea, getValue, setValue, focus, getSelection, setSelection, insertText, setLanguage, setReadOnly, setWrap, setMarkers,
 *          setReadOnlyRanges, undo, redo, canUndo, canRedo, openFind, closeFind, toggleComment, destroy }
 */
export function createCodeEditor(options?: {
    element: string | HTMLElement;
    value?: string;
    language?: string | object;
    readOnly?: boolean;
    lineNumbers?: boolean;
    wrap?: boolean;
    tabSize?: number;
    insertSpaces?: boolean;
    statusBar?: boolean;
    label?: string;
    maxHighlightLength?: number;
    markers?: {
        line: number;
        message: string;
        level?: "error" | "warning" | "info";
    }[];
    readOnlyRanges?: {
        from: number;
        to: number;
    }[];
    provideCompletions?: (context: {
        value: string;
        position: number;
        line: number;
        lineText: string;
        prefix: string;
        explicit: boolean;
        language: string;
    }) => (Array<{
        label: string;
        insert?: string;
        detail?: string;
    }> | Promise<any[]>);
    autoComplete?: boolean;
    onChange?: (value: string, reason: string) => void;
}): any;
