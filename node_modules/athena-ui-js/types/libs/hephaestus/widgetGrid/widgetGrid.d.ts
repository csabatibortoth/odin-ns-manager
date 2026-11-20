/**
 * Registers a type of widget, so grids can create it, load it from a saved layout and show its settings.
 *
 * @param {string} type name of the type, for example "stat" (it is saved in layouts)
 * @param {object} definition
 * @param {(context: WidgetContext) => (void|Function|{update?: Function, destroy?: Function})} definition.render builds the widget into `context.element`;
 *        it may return a function (called when the widget goes away) or an object with `update(context)` and `destroy(context)`
 * @param {(context: WidgetContext) => void} [definition.update] called (throttled) when the config or the title changed; without it the widget is rendered again
 * @param {(context: WidgetContext, size: {width: number, height: number}) => void} [definition.resize] called (throttled) when the body changes its size
 * @param {(context: WidgetContext) => void} [definition.destroy] called when the widget is removed or the grid is destroyed
 * @param {object[]|((widget: object) => object[])} [definition.configForm] field definitions (see generateField) of the settings dialog; the field `name` is the key in the config
 * @param {object} [definition.defaultConfig] config of a new widget
 * @param {string} [definition.title] title of a new widget
 * @param {{w: number, h: number}} [definition.defaultSize={w: 3, h: 2}] size in grid cells
 * @param {{w?: number, h?: number}} [definition.minSize]
 * @param {{w?: number, h?: number}} [definition.maxSize]
 *
 * @typedef {object} WidgetContext
 * @property {string} id
 * @property {string} type
 * @property {HTMLElement} element the body of the widget: build into it
 * @property {object} config the current config (read it again in update())
 * @property {string} title
 * @property {{width: number, height: number}} size the box of the body, as it is now
 * @property {{width: number, height: number}} contentSize what is left inside the padding of the body: the room a chart or a table has
 * @property {(title: string) => void} setTitle
 */
export function registerWidget(type: string, definition: {
    render: (context: WidgetContext) => (void | Function | {
        update?: Function;
        destroy?: Function;
    });
    update?: (context: WidgetContext) => void;
    resize?: (context: WidgetContext, size: {
        width: number;
        height: number;
    }) => void;
    destroy?: (context: WidgetContext) => void;
    configForm?: object[] | ((widget: object) => object[]);
    defaultConfig?: object;
    title?: string;
    defaultSize?: {
        w: number;
        h: number;
    };
    minSize?: {
        w?: number;
        h?: number;
    };
    maxSize?: {
        w?: number;
        h?: number;
    };
}): void;
/** Forgets a widget type. Widgets of it that are in grids stay and are shown as unknown. */
export function unregisterWidget(type: any): boolean;
/** The names of the registered widget types. */
export function getWidgetTypes(): any[];
/**
 * A grid of widgets.
 *
 * @param {object} options
 * @param {string|HTMLElement} options.element the container
 * @param {number} [options.columns=12] columns when there are no breakpoints
 * @param {number} [options.rowHeight=80] height of a row in px
 * @param {number} [options.gap=12] gap between widgets in px
 * @param {Record<string, {minWidth?: number, columns: number}>} [options.breakpoints] layouts by the width of the container, for example
 *        `{ large: { minWidth: 900, columns: 12 }, small: { minWidth: 0, columns: 4 } }`. A breakpoint without a layout of its own is derived from the widest one.
 * @param {object[]} [options.widgets] first widgets: `{ type, title?, config?, x?, y?, w?, h?, locked?, id? }`
 * @param {object} [options.layout] a saved layout (getLayout()), used instead of `widgets`
 * @param {boolean} [options.editable=false] edit mode: move, resize, settings, duplicate, remove
 * @param {boolean} [options.compact=true] widgets fall upwards when there is room (false: they stay where they are put)
 * @param {boolean} [options.animate=true] widgets slide to their new places (never under reduced motion)
 * @param {string} [options.label] accessible name of the dashboard
 * @param {number} [options.maxWidgets=200]
 * @param {number} [options.changeDelay=0] ms to wait after a change before onChange is called (a drag is many steps: one call after the last); 0 calls it at once. `flush()` calls it now
 * @param {(layout: object, reason: string) => void} [options.onChange] called after a change made by the person or by add/remove/...: "move", "resize", "add", "remove", "duplicate", "settings", "lock", "undo", "redo"
 * @returns the handle: { element, addWidget, addWidgetWithSettings, flush, removeWidget, duplicateWidget, configureWidget, updateWidget, getWidget, getWidgets, lockWidget, setEditable, isEditable,
 *          getLayout, setLayout, undo, redo, canUndo, canRedo, getBreakpoint, destroy }
 */
export function createWidgetGrid(options?: {
    element: string | HTMLElement;
    columns?: number;
    rowHeight?: number;
    gap?: number;
    breakpoints?: Record<string, {
        minWidth?: number;
        columns: number;
    }>;
    widgets?: object[];
    layout?: object;
    editable?: boolean;
    compact?: boolean;
    animate?: boolean;
    label?: string;
    maxWidgets?: number;
    changeDelay?: number;
    onChange?: (layout: object, reason: string) => void;
}): any;
/**
 * Registers a type of widget, so grids can create it, load it from a saved layout and show its settings.
 */
export type WidgetContext = {
    id: string;
    type: string;
    /**
     * the body of the widget: build into it
     */
    element: HTMLElement;
    /**
     * the current config (read it again in update())
     */
    config: object;
    title: string;
    /**
     * the box of the body, as it is now
     */
    size: {
        width: number;
        height: number;
    };
    /**
     * what is left inside the padding of the body: the room a chart or a table has
     */
    contentSize: {
        width: number;
        height: number;
    };
    setTitle: (title: string) => void;
};
