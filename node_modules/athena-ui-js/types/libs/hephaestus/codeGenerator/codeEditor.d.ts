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
 * @param {Array<{from: number, to: number}|{text: string}>} [options.readOnlyRanges] what cannot be changed: lines (1-based, inclusive), or a piece of text (its first
 *        occurrence when it is set; it stays locked where it is while the text around it changes)
 * @param {(context: {value: string, position: number, line: number, lineText: string, prefix: string, explicit: boolean, language: string}) => (Array<{label: string, insert?: string, detail?: string}>|Promise<Array>)} [options.provideCompletions]
 * @param {boolean} [options.autoComplete=true] with provideCompletions: suggest while typing (otherwise only with Ctrl+Space)
 * @param {boolean} [options.folding=false] (needs lineNumbers) blocks can be folded by indentation: a click on the arrow beside the line number, Ctrl+Shift+[ and ].
 *        getValue() and onChange always give the whole text; an edit that would touch folded lines opens them first. Off while there are readOnlyRanges.
 * @param {boolean} [options.minimap=false] a small picture of the whole text beside it (hidden in a narrow editor)
 * @param {boolean} [options.multipleCursors=false] Ctrl+D selects the next occurrence, Ctrl+Alt+Up / Down or Alt+click adds a cursor, Escape goes back to one
 * @param {(value: string, reason: string) => void} [options.onChange] after every change made by typing, undo, redo, replace ... (not after setValue)
 * @returns the handle: { element, textarea, getValue, setValue, focus, getSelection, setSelection, insertText, setLanguage, setReadOnly, setWrap, setMarkers,
 *          setReadOnlyRanges, undo, redo, canUndo, canRedo, openFind, closeFind, toggleComment,
 *          fold, unfold, foldAll, unfoldAll, getCursorCount, destroy }
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
    readOnlyRanges?: Array<{
        from: number;
        to: number;
    } | {
        text: string;
    }>;
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
    folding?: boolean;
    minimap?: boolean;
    multipleCursors?: boolean;
    onChange?: (value: string, reason: string) => void;
}): any;
