/** Tick positions (ms) at round times between `from` and `to`, about `count` of them. */
export function timeTicks(from: any, to: any, count?: number): {
    ticks: number[];
    step: number;
};
/**
 * Keeps about `buckets` x positions of a long series: of every bucket the lowest and the highest value stay (in their order),
 * so peaks are not lost. Returns the kept indices.
 */
export function decimate(indices: any, values: any, buckets: any): any;
/**
 * Draws a chart as inline SVG and appends it to its parent.
 *
 * @param {object} options
 * @param {"bar"|"line"|"area"|"sparkline"|"pie"|"donut"} [options.type="bar"]
 * @param {string|Element} [options.parent] element, id or selector, defaults to "wrapper"
 * @param {string} [options.id] id of the svg element
 * @param {string} [options.title] drawn above the chart, and its accessible name
 * @param {string[]} [options.labels] category labels
 * @param {(number|Date|string)[]} [options.times] line and area charts: the time of every value (Date, ms or a date string).
 *        The x axis becomes a time axis with ticks at round times, and the points sit at their real distance.
 * @param {{name?: string, data: number[], color?: string}[]} options.series pie / donut / sparkline use the first series only.
 *        Colours come from the theme (--series-1 ... --series-8); `color` is an override for one series.
 * @param {number} [options.width=600] (a sparkline: 120)
 * @param {number} [options.height=360] (a sparkline: 32)
 * @param {boolean} [options.legend] default: shown for several series, and for pie / donut. Clicking an entry hides / shows its series.
 * @param {boolean} [options.table=false] adds a "Show as table" section with the values below the chart
 * @param {boolean} [options.zero=true] line charts: false lets the value axis start near the smallest value
 * @param {boolean} [options.zoom=false] line and area charts: drag over the plot to zoom into that range, double click (or the
 *        reset button, or 0 / Esc) to zoom out; with the keyboard on the plot: + and - zoom, the arrow keys pan.
 *        Without `zoom` the arrow keys on the plot read the values from point to point (Home and End: first and last, Esc: hide); with `zoom` that is Alt + arrow
 * @param {{from: number, to: number}|null} [options.zoomRange] the range in view, in the units of the x axis: milliseconds with
 *        `times`, otherwise the index of the point (-0.5 is the left edge of the first point)
 * @param {(range: ({from: number, to: number}|null)) => void} [options.onZoom] called when a person zooms or resets
 * @param {number} [options.maxPoints] `push` keeps at most this many points per series (the oldest are dropped)
 * @param {number[]} [options.hiddenSeries] the series (or slices) that are hidden at the start; a person hides and shows them with the legend, and a redraw keeps that
 * @param {boolean} [options.animate=true] the first drawing animates: bars grow, a line is drawn, slices pop in (not when it is redrawn, and not under reduced motion)
 * @param {boolean} [options.interactive=true] line and area charts: false leaves out the pointer layer (tooltip that follows the pointer, zoom)
 * @param {boolean} [options.gaps=false] line and area charts: a missing value (null, NaN, undefined) breaks the line, and a point on its own is a dot;
 *        without it the line goes on from the value before to the one after
 * @param {{from: (number|Date|string), to: (number|Date|string)}} [options.timeRange] line and area charts with `times`: the range of the time axis, when it is not the one
 *        the data covers (the last hour, of which only the last quarter has been measured)
 * @param {(value: number) => string} [options.format] how a value is written: on the axis, in the tooltips and in the table of values (default: whole numbers, otherwise two decimals)
 * @param {((time: number) => string)|Intl.DateTimeFormatOptions} [options.timeFormat] how a time is written in the tooltips and in the table of values (`times` only): a function of the
 *        time in milliseconds, or the options of Intl.DateTimeFormat (default: `{ dateStyle: "medium", timeStyle: "medium" }`, for example "Nov 19, 2026, 6:15:09 PM")
 * @param {boolean} [options.points=true] line and area charts: false never draws the dots, however few the points are (the tooltip still follows the pointer and the keyboard)
 * @param {(value: number) => string} [options.tickFormat] how the numbers of the value axis are written, when they should not be written like the values (a chart of whole numbers has ticks of 0.2)
 * @param {{top?: number, right?: number, bottom?: number, left?: number}} [options.margin] room around the plot in px (default 40, 20, 50, 55; with a legend the bottom is at least 48): a chart without a title and a legend does not need the top
 * @param {boolean} [options.responsive=false] the chart is as wide as its parent and follows it when it changes (`height` stays); `width` is only the first guess
 * @returns {(SVGElement & {element: SVGElement, update: (options?: object) => SVGElement, destroy: () => void,
 *            zoom: (from: number, to: number) => void, resetZoom: () => void, getZoom: () => ({from: number, to: number}|null),
 *            push: (point: {x?: (number|Date|string), label?: string, values: (number|number[])}, config?: {maxPoints?: number}) => void,
 *            dataTable: (HTMLElement|null)})|null}
 *          the SVG element, which also carries the handle ({ element, update(options), destroy() }) of the other
 *          components; null when the options are invalid. `parent` is an element, an id or a selector.
 *          `push` adds a point to every series (a number for the first series, or one value per series; `x` is the time with
 *          `times`, `label` the category) and draws the chart again at most once per frame, however often it is called.
 */
export function generateChart(options?: {
    type?: "bar" | "line" | "area" | "sparkline" | "pie" | "donut";
    parent?: string | Element;
    id?: string;
    title?: string;
    labels?: string[];
    times?: (number | Date | string)[];
    series: {
        name?: string;
        data: number[];
        color?: string;
    }[];
    width?: number;
    height?: number;
    legend?: boolean;
    table?: boolean;
    zero?: boolean;
    zoom?: boolean;
    zoomRange?: {
        from: number;
        to: number;
    } | null;
    onZoom?: (range: ({
        from: number;
        to: number;
    } | null)) => void;
    maxPoints?: number;
    hiddenSeries?: number[];
    animate?: boolean;
    interactive?: boolean;
    gaps?: boolean;
    timeRange?: {
        from: (number | Date | string);
        to: (number | Date | string);
    };
    format?: (value: number) => string;
    timeFormat?: ((time: number) => string) | Intl.DateTimeFormatOptions;
    points?: boolean;
    tickFormat?: (value: number) => string;
    margin?: {
        top?: number;
        right?: number;
        bottom?: number;
        left?: number;
    };
    responsive?: boolean;
}): (SVGElement & {
    element: SVGElement;
    update: (options?: object) => SVGElement;
    destroy: () => void;
    zoom: (from: number, to: number) => void;
    resetZoom: () => void;
    getZoom: () => ({
        from: number;
        to: number;
    } | null);
    push: (point: {
        x?: (number | Date | string);
        label?: string;
        values: (number | number[]);
    }, config?: {
        maxPoints?: number;
    }) => void;
    dataTable: (HTMLElement | null);
}) | null;
