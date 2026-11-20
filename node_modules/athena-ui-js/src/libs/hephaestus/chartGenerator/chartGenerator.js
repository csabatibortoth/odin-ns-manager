//chartGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

// Dependency free SVG charts: bar, line, area, sparkline, pie and donut. Colours come from the theme (--series-1 ... --series-8,
// see the stylesheet), nothing is styled inline, so a strict Content-Security-Policy works.

import { resolveElement, uid } from "../../core/dom.js";
import { getLocale, translate } from "../../core/i18n.js";

const NS = "http://www.w3.org/2000/svg";
const SERIES_COLORS = 8;
const DEFAULT_MARGIN = { top: 40, right: 20, bottom: 50, left: 55 };
// The legend stands under the time labels: with less than this at the bottom they overlap (a smaller margin the application asked for is raised)
const LEGEND_BOTTOM = 48;
const DOT_LIMIT = 80;       // up to this many points in view every point is a dot with a tooltip; more: the tooltip follows the pointer

const svgEl = (tag, attrs = {}, text) => {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    if (text != null) node.textContent = text;
    return node;
};

const seriesClass = index => `s${(index % SERIES_COLORS) + 1}`;
// A colour given by the caller goes in the `color` attribute (the shapes paint with currentColor); otherwise the class picks it from the theme.
const seriesProps = (series, index) => (series.color ? { color: series.color } : { class: seriesClass(index) });
// The time in a tooltip and in the table of values: `timeFormat` is a function (milliseconds) => text, or the options of Intl.DateTimeFormat
const DEFAULT_TIME_FORMAT = { dateStyle: "medium", timeStyle: "medium" };
function makeTimeFormatter(timeFormat) {
    if (typeof timeFormat === "function") return timeFormat;
    const formatter = new Intl.DateTimeFormat(getLocale(), timeFormat && typeof timeFormat === "object" ? timeFormat : DEFAULT_TIME_FORMAT);
    return t => formatter.format(t);
}
const formatNumber = n => Number.isInteger(n) ? String(n) : String(+n.toFixed(2));

// Rounded axis maximum and tick step, so ticks land on readable numbers.
function niceScale(span, ticks = 5) {
    if (span <= 0) return { span: 1, step: 1 / ticks };
    const rough = span / ticks;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].map(m => m * magnitude).find(s => s >= rough);
    return { span: step * Math.ceil(span / step - 1e-9), step };
}

/* ------------------TIME AXIS------------------- */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TIME_STEPS = [SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND, MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR,
    12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 90 * DAY, 365 * DAY];

/** Tick positions (ms) at round times between `from` and `to`, about `count` of them. */
export function timeTicks(from, to, count = 6) {
    const step = TIME_STEPS.find(s => (to - from) / s <= count) ?? TIME_STEPS.at(-1);
    // Ticks of a day or more start at midnight of the local day, shorter ones at a multiple of the step.
    const offset = step >= DAY ? new Date(from).getTimezoneOffset() * MINUTE : 0;
    const ticks = [];
    for (let t = Math.ceil((from - offset) / step) * step + offset; t <= to; t += step) ticks.push(t);
    return { ticks, step };
}

function timeFormatter(step) {
    const locale = getLocale();
    const options = step < MINUTE ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
        : step < DAY ? { hour: "2-digit", minute: "2-digit" }
            : step < 90 * DAY ? { month: "short", day: "numeric" }
                : { month: "short", year: "numeric" };
    const format = new Intl.DateTimeFormat(locale, options);
    return t => format.format(t);
}

const toTime = value => (value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value));

/**
 * Keeps about `buckets` x positions of a long series: of every bucket the lowest and the highest value stay (in their order),
 * so peaks are not lost. Returns the kept indices.
 */
export function decimate(indices, values, buckets) {
    if (indices.length <= buckets * 2) return indices;
    const size = indices.length / buckets;
    const kept = [];
    for (let b = 0; b < buckets; b++) {
        const slice = indices.slice(Math.floor(b * size), Math.floor((b + 1) * size));
        if (!slice.length) continue;
        let low = slice[0];
        let high = slice[0];
        for (const i of slice) {
            if (values[i] < values[low]) low = i;
            if (values[i] > values[high]) high = i;
        }
        kept.push(...(low === high ? [low] : low < high ? [low, high] : [high, low]));
    }
    return kept;
}

/* ------------------PARTS------------------- */

function addLegend(svg, entries, width, height, ctx) {
    const MARGIN = ctx.margin;
    let x = MARGIN.left;
    const y = height - 12;
    entries.forEach(({ name, props, series }) => {
        const group = svgEl("g", { class: "chart-legend-item", tabindex: 0, role: "button", "aria-pressed": "true", "aria-label": name, "data-legend": series ?? "" });
        group.append(svgEl("rect", { x, y: y - 9, width: 10, height: 10, class: `chart-swatch ${props.class ?? ""}`.trim(), ...(props.color ? { color: props.color } : {}) }));
        group.append(svgEl("text", { x: x + 14, y, class: "chart-legend" }, name));
        if (series != null) {
            const toggle = () => {
                const hidden = group.getAttribute("aria-pressed") === "true";
                group.setAttribute("aria-pressed", hidden ? "false" : "true");
                group.classList.toggle("is-off", hidden);
                for (const node of svg.querySelectorAll(`[data-series="${series}"]`)) node.classList.toggle("chart-hidden", hidden);
                ctx.hooks?.legend?.(series, hidden);
                ctx.tooltip.hide();
            };
            group.addEventListener("click", toggle);
            group.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggle();
                }
            });
        }
        svg.append(group);
        x += 14 + name.length * 7 + 14;
    });
}

// One tooltip per chart, drawn inside the SVG and moved with attributes (no inline style). Shows on hover and on keyboard focus.
function createTooltip(svg, width) {
    const group = svgEl("g", { class: "chart-tooltip", "aria-hidden": "true" });
    const box = svgEl("rect", { class: "chart-tooltip-box", rx: 4 });
    const text = svgEl("text", { class: "chart-tooltip-text" });
    group.append(box, text);
    const show = (x, y, lines) => {
        text.replaceChildren(...lines.map((line, i) => svgEl("tspan", { x: 8, dy: i ? 15 : 0 }, line)));
        group.classList.add("is-visible");
        let w = 80;
        let h = lines.length * 15 + 8;
        try {
            const bbox = text.getBBox();
            w = bbox.width + 16;
            h = bbox.height + 10;
        } catch { /* not rendered: the estimate stays */ }
        text.setAttribute("y", 15);
        const left = Math.min(Math.max(x - w / 2, 2), Math.max(width - w - 2, 2));
        const top = Math.max(y - h - 10, 2);
        box.setAttribute("width", w);
        box.setAttribute("height", h);
        group.setAttribute("transform", `translate(${left} ${top})`);
    };
    const hide = () => group.classList.remove("is-visible");
    svg.append(group);
    return { show, hide, group };
}

// Makes a shape react to the pointer and the keyboard focus. It is focusable and named, so the values can be read without a mouse.
function addTip(ctx, node, x, y, lines) {
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", lines.join(", "));
    node.setAttribute("role", "img");
    const show = () => ctx.tooltip.show(x, y, lines);
    node.addEventListener("pointerenter", show);
    node.addEventListener("focus", show);
    node.addEventListener("pointerleave", ctx.tooltip.hide);
    node.addEventListener("blur", ctx.tooltip.hide);
}

// Draws the value grid and the y axis for the range [min, min + scale.span].
function addValueAxis(svg, { min, scale, width, height, margin: MARGIN, format = formatNumber }) {
    const plotW = width - MARGIN.left - MARGIN.right;
    const plotH = height - MARGIN.top - MARGIN.bottom;
    const y = value => MARGIN.top + plotH - ((value - min) / scale.span) * plotH;
    const ticks = Math.round(scale.span / scale.step);
    for (let i = 0; i <= ticks; i++) {
        const v = min + i * scale.step;
        svg.append(svgEl("line", { x1: MARGIN.left, x2: MARGIN.left + plotW, y1: y(v), y2: y(v), class: "chart-grid" }));
        svg.append(svgEl("text", { x: MARGIN.left - 8, y: y(v) + 4, "text-anchor": "end", class: "chart-tick" }, format(v)));
    }
    svg.append(svgEl("line", { x1: MARGIN.left, x2: MARGIN.left, y1: MARGIN.top, y2: MARGIN.top + plotH, class: "chart-axis" }));
    // The category axis sits at zero when the range includes it, so negative bars hang below it.
    const baseline = y(Math.min(Math.max(0, min), min + scale.span));
    svg.append(svgEl("line", { x1: MARGIN.left, x2: MARGIN.left + plotW, y1: baseline, y2: baseline, class: "chart-axis" }));
    return { y, baseline, plotW, plotH };
}

function valueRange(values, zero = true) {
    const finite = values.filter(Number.isFinite);
    if (!finite.length) return { min: 0, scale: niceScale(1) };
    let min = zero ? Math.min(0, ...finite) : Math.min(...finite);
    const max = Math.max(zero ? 0 : -Infinity, ...finite);
    const scale = niceScale(max - min);
    if (!zero) min = Math.floor(min / scale.step) * scale.step;   // start the axis at a round number
    return { min, scale: niceScale(max - min) };
}

/* ------------------DRAWERS------------------- */

function drawBar(svg, ctx) {
    const { labels, series, width, height, format } = ctx;
    const MARGIN = ctx.margin;
    const { min, scale } = valueRange(series.flatMap(s => s.data));
    const { y, plotW, plotH } = addValueAxis(svg, { min, scale, width, height, margin: MARGIN, format: ctx.tickFormat });
    const band = plotW / Math.max(labels.length, 1);
    labels.forEach((label, i) => svg.append(svgEl("text",
        { x: MARGIN.left + band * (i + 0.5), y: MARGIN.top + plotH + 18, "text-anchor": "middle", class: "chart-tick" }, label)));
    const groupWidth = band * 0.8;
    const barWidth = groupWidth / series.length;
    series.forEach((s, si) => s.data.forEach((value, i) => {
        const x = MARGIN.left + band * i + (band - groupWidth) / 2 + barWidth * si;
        const top = Math.min(y(value), y(0));
        const bar = svgEl("rect", {
            x, y: top, width: Math.max(barWidth - 2, 1), height: Math.abs(y(0) - y(value)),
            "data-series": si, ...seriesProps(s, si)
        });
        bar.setAttribute("class", `chart-bar ${bar.getAttribute("class") ?? ""}`.trim());
        addTip(ctx, bar, x + barWidth / 2, top, [`${s.name ?? ""} ${labels[i] ?? ""}`.trim(), format(value)]);
        svg.append(bar);
    }));
}

// Line and area charts, with a category or a time axis, zoom (a range of the x axis) and long series (no dots, a pointer tooltip).
function drawLine(svg, ctx) {
    const { labels, series, width, height, times, area, options, zoom, format } = ctx;
    const MARGIN = ctx.margin;
    const plotW = width - MARGIN.left - MARGIN.right;
    const plotH = height - MARGIN.top - MARGIN.bottom;
    const count = Math.max(...series.map(s => s.data.length));
    const position = i => (times ? times[i] : i);                          // x position of point i in the units of the axis
    // The range of the x axis: what the data covers, or the one asked for (a window of the last hour that is only half measured)
    const full = times ? (options.timeRange && options.timeRange.to > options.timeRange.from ? { from: toTime(options.timeRange.from), to: toTime(options.timeRange.to) } : { from: Math.min(...times.slice(0, count)), to: Math.max(...times.slice(0, count)) }) : { from: -0.5, to: count - 0.5 };
    const view = zoom ? { from: Math.max(zoom.from, full.from), to: Math.min(zoom.to, full.to) } : full;
    if (!(view.to > view.from)) Object.assign(view, full);
    const x = p => MARGIN.left + ((p - view.from) / (view.to - view.from || 1)) * plotW;

    // The points in view, plus one on each side so the line leaves the plot
    const visible = series.map(s => {
        const inside = [];
        for (let i = 0; i < s.data.length; i++) {
            const p = position(i);
            if (p >= view.from && p <= view.to && Number.isFinite(s.data[i])) inside.push(i);
        }
        return inside;
    });
    const zeroBased = area || options.zero !== false;
    const { min, scale } = valueRange(series.flatMap((s, si) => visible[si].map(i => s.data[i])), zeroBased);
    const { y, baseline } = addValueAxis(svg, { min, scale, width, height, margin: MARGIN, format: ctx.tickFormat });

    // x axis
    if (times) {
        const { ticks: stops, step } = timeTicks(view.from, view.to);
        const format = timeFormatter(step);
        for (const t of stops) {
            svg.append(svgEl("line", { x1: x(t), x2: x(t), y1: MARGIN.top + plotH, y2: MARGIN.top + plotH + 4, class: "chart-axis" }));
            svg.append(svgEl("text", { x: x(t), y: MARGIN.top + plotH + 18, "text-anchor": "middle", class: "chart-tick" }, format(t)));
        }
    } else {
        const first = Math.max(Math.ceil(view.from + 0.5), 0);
        const last = Math.min(Math.floor(view.to - 0.5), count - 1);
        const every = Math.max(1, Math.ceil((last - first + 1) / Math.max(Math.floor(plotW / 60), 1)));
        for (let i = first; i <= last; i += every) svg.append(svgEl("text", { x: x(i), y: MARGIN.top + plotH + 18, "text-anchor": "middle", class: "chart-tick" }, labels[i] ?? ""));
    }

    const clipId = uid("chart-clip");
    const clip = svgEl("clipPath", { id: clipId });
    clip.append(svgEl("rect", { x: MARGIN.left, y: MARGIN.top - 4, width: plotW, height: plotH + 8 }));
    svg.append(clip);
    const when = i => (times ? ctx.formatTime(times[i]) : (labels[i] ?? ""));
    // `points: false` never draws the dots (the tooltip still follows the pointer and the keyboard), so a chart with few points looks like one with many
    const dotted = options.points !== false && Math.max(...visible.map(v => v.length)) <= DOT_LIMIT;

    series.forEach((s, si) => {
        // Neighbours outside the view keep the line running to the edge of the plot
        const inside = visible[si];
        const lo = inside.length ? inside[0] : 0;
        const hi = inside.length ? inside.at(-1) : -1;
        // Without `gaps` a missing value is skipped and the line goes on; with it the line breaks there, and a point on its own is a dot
        const runs = [];
        let run = [];
        for (let i = Math.max(lo - 1, 0); i <= Math.min(hi + 1, s.data.length - 1); i++) {
            if (Number.isFinite(s.data[i])) run.push(i);
            else if (options.gaps) {
                if (run.length) runs.push(run);
                run = [];
            }
        }
        if (run.length) runs.push(run);
        const group = svgEl("g", { "data-series": si, ...seriesProps(s, si) });
        const clipped = svgEl("g", { "clip-path": `url(#${clipId})` });
        for (const members of runs) {
            const points = decimate(members, s.data, Math.floor(plotW)).map(i => [x(position(i)), y(s.data[i])]);
            if (area && points.length) {
                const outline = [`M${points[0][0]},${baseline}`, ...points.map(p => `L${p.join(",")}`), `L${points.at(-1)[0]},${baseline}`, "Z"];
                clipped.append(svgEl("path", { d: outline.join(" "), class: "chart-area" }));
            }
            if (points.length === 1 && options.gaps) {
                // a lone point keeps a tooltip of its own, also when the chart draws no dots
                const lone = svgEl("circle", { cx: points[0][0], cy: points[0][1], r: 2.5, class: "chart-point chart-lone-point" });
                if (options.interactive !== false) addTip(ctx, lone, points[0][0], points[0][1], [`${s.name ?? ""} ${when(members[0])}`.trim(), format(s.data[members[0]])]);
                clipped.append(lone);
            }
            else clipped.append(svgEl("polyline", { points: points.map(p => p.join(",")).join(" "), class: "chart-line", fill: "none", pathLength: 1 }));
        }
        group.append(clipped);
        if (dotted) {
            for (const i of inside) {
                const dot = svgEl("circle", { cx: x(position(i)), cy: y(s.data[i]), r: 4, class: "chart-point" });
                addTip(ctx, dot, x(position(i)), y(s.data[i]), [`${s.name ?? ""} ${when(i)}`.trim(), format(s.data[i])]);
                group.append(dot);
            }
        }
        svg.append(group);
    });

    if (options.interactive === false) return;

    // A transparent layer over the plot: the tooltip follows the pointer, a drag selects a range to zoom into, and the keyboard pans and zooms.
    const hit = svgEl("rect", { class: "chart-hit", x: MARGIN.left, y: MARGIN.top, width: plotW, height: plotH, fill: "transparent" });
    const marker = svgEl("line", { class: "chart-marker", y1: MARGIN.top, y2: MARGIN.top + plotH, display: "none" });
    const selection = svgEl("rect", { class: "chart-selection", y: MARGIN.top, height: plotH, display: "none" });
    const toPosition = clientX => {
        const box = hit.getBoundingClientRect();
        const scaleX = box.width ? plotW / box.width : 1;
        return view.from + (((clientX - box.left) * scaleX) / plotW) * (view.to - view.from);
    };
    // The point (of the first series that has one) nearest to a position on the axis
    const nearest = target => {
        let best = null;
        series.forEach((s, si) => {
            const idx = visible[si];
            let lowIdx = 0;
            let highIdx = idx.length - 1;
            while (lowIdx < highIdx) {
                const mid = (lowIdx + highIdx) >> 1;
                if (position(idx[mid]) < target) lowIdx = mid + 1;
                else highIdx = mid;
            }
            for (const c of [idx[lowIdx - 1], idx[lowIdx]]) {
                if (c != null && (best == null || Math.abs(position(c) - target) < Math.abs(position(best) - target))) best = c;
            }
        });
        return best;
    };
    const showAt = index => {
        if (index == null) return;
        const px = x(position(index));
        marker.setAttribute("x1", px);
        marker.setAttribute("x2", px);
        marker.removeAttribute("display");
        const lines = [when(index), ...series.map(s => (Number.isFinite(s.data[index]) ? `${s.name ? `${s.name}: ` : ""}${format(s.data[index])}` : null)).filter(Boolean)];
        const top = Math.min(...series.map(s => (Number.isFinite(s.data[index]) ? y(s.data[index]) : Infinity)));
        ctx.tooltip.show(px, Number.isFinite(top) ? top : MARGIN.top, lines);
    };
    const hideAt = () => {
        marker.setAttribute("display", "none");
        ctx.tooltip.hide();
    };
    let dragStart = null;
    hit.addEventListener("pointermove", event => {
        if (dragStart != null) {
            const a = Math.min(dragStart, event.clientX);
            const b = Math.max(dragStart, event.clientX);
            const box = hit.getBoundingClientRect();
            const k = box.width ? plotW / box.width : 1;
            selection.setAttribute("x", MARGIN.left + (a - box.left) * k);
            selection.setAttribute("width", (b - a) * k);
            selection.removeAttribute("display");
            return;
        }
        showAt(nearest(toPosition(event.clientX)));
    });
    hit.addEventListener("pointerleave", () => { if (dragStart == null) hideAt(); });
    if (options.zoom) {
        hit.addEventListener("pointerdown", event => {
            if (event.button != null && event.button !== 0) return;
            dragStart = event.clientX;
            try { hit.setPointerCapture(event.pointerId); } catch { /* the pointer is gone */ }
        });
        const finish = event => {
            if (dragStart == null) return;
            const from = toPosition(Math.min(dragStart, event.clientX));
            const to = toPosition(Math.max(dragStart, event.clientX));
            const moved = Math.abs(event.clientX - dragStart);
            dragStart = null;
            selection.setAttribute("display", "none");
            if (moved > 6 && ctx.hooks?.zoom) ctx.hooks.zoom({ from, to });
        };
        hit.addEventListener("pointerup", finish);
        hit.addEventListener("pointercancel", () => { dragStart = null; selection.setAttribute("display", "none"); });
        hit.addEventListener("dblclick", () => ctx.hooks?.zoom(null));
        hit.setAttribute("tabindex", "0");
        hit.setAttribute("role", "application");
        hit.setAttribute("aria-label", translate("chart.zoomHint"));
        hit.addEventListener("keydown", event => {
            const span = view.to - view.from;
            const mid = (view.from + view.to) / 2;
            let next;
            if (event.key === "+" || event.key === "=") next = { from: mid - span / 4, to: mid + span / 4 };
            else if (event.key === "-" || event.key === "_") next = { from: mid - span, to: mid + span };
            else if (event.altKey) return;                  // Alt + arrows read the values (below)
            else if (event.key === "ArrowLeft") next = { from: view.from - span / 4, to: view.to - span / 4 };
            else if (event.key === "ArrowRight") next = { from: view.from + span / 4, to: view.to + span / 4 };
            else if (event.key === "0" || event.key === "Escape") next = null;
            else return;
            event.preventDefault();
            ctx.hooks?.zoom(next);
        });
        if (zoom) {
            const reset = svgEl("g", { class: "chart-reset", role: "button", tabindex: 0, "aria-label": translate("chart.resetZoom") });
            reset.append(svgEl("text", { x: width - MARGIN.right, y: 24, "text-anchor": "end", class: "chart-legend" }, `↺ ${translate("chart.resetZoom")}`));
            reset.addEventListener("click", () => ctx.hooks?.zoom(null));
            reset.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    ctx.hooks?.zoom(null);
                }
            });
            svg.append(reset);
        }
    }
    // Reading the values with the keyboard: the arrow keys move the tooltip from point to point (with `zoom` the arrows pan, so Alt + arrow reads),
    // Home and End go to the first and the last point, Escape hides the tooltip
    if (!options.zoom) {
        hit.setAttribute("tabindex", "0");
        hit.setAttribute("role", "application");
        hit.setAttribute("aria-label", translate("chart.readHint"));
    }
    let reading = null;
    const readable = () => {
        const byPosition = new Map();
        series.forEach((s, si) => visible[si].forEach(i => { if (!byPosition.has(position(i))) byPosition.set(position(i), i); }));
        return [...byPosition].sort((a, b) => a[0] - b[0]).map(entry => entry[1]);
    };
    hit.addEventListener("keydown", event => {
        if (options.zoom && !event.altKey && event.key !== "Home" && event.key !== "End") return;
        const all = readable();
        if (!all.length) return;
        let at = reading == null ? -1 : all.indexOf(reading);
        if (event.key === "ArrowRight") at = at < 0 ? 0 : Math.min(at + 1, all.length - 1);
        else if (event.key === "ArrowLeft") at = at < 0 ? all.length - 1 : Math.max(at - 1, 0);
        else if (event.key === "Home") at = 0;
        else if (event.key === "End") at = all.length - 1;
        else if (event.key === "Escape" && !options.zoom) {
            reading = null;
            hideAt();
            return;
        } else return;
        event.preventDefault();
        reading = all[at];
        showAt(reading);
    });
    hit.addEventListener("blur", () => { reading = null; hideAt(); });
    svg.append(marker, selection, hit);
}

// A small line without axes, legend or title: for a table cell or a stat tile. Its tooltips still work.
function drawSparkline(svg, ctx) {
    const { series, width, height, format } = ctx;
    const s = series[0];
    const values = s.data.filter(Number.isFinite);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = 3;
    const x = i => pad + (s.data.length === 1 ? (width - 2 * pad) / 2 : (i / (s.data.length - 1)) * (width - 2 * pad));
    const y = v => height - pad - (max === min ? (height - 2 * pad) / 2 : ((v - min) / (max - min)) * (height - 2 * pad));
    const points = s.data.map((v, i) => [x(i), y(v)]).filter((_, i) => Number.isFinite(s.data[i]));
    const group = svgEl("g", { "data-series": 0, ...seriesProps(s, 0) });
    group.append(svgEl("polyline", { points: points.map(p => p.join(",")).join(" "), class: "chart-line", fill: "none" }));
    const last = points.at(-1);
    if (last) {
        const dot = svgEl("circle", { cx: last[0], cy: last[1], r: 2.5, class: "chart-point" });
        addTip(ctx, dot, last[0], last[1], [format(values.at(-1))]);
        group.append(dot);
    }
    svg.append(group);
}

function drawPie(svg, ctx) {
    const { labels, series, width, height, donut, format } = ctx;
    const MARGIN = ctx.margin;
    const data = series[0].data.map(v => Math.max(0, v));
    const total = data.reduce((a, b) => a + b, 0);
    const cx = width / 2;
    const cy = MARGIN.top + (height - MARGIN.top - MARGIN.bottom) / 2;
    const r = Math.min(width - MARGIN.left - MARGIN.right, height - MARGIN.top - MARGIN.bottom) / 2;
    const inner = donut ? r * 0.55 : 0;
    const point = (radius, angle) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)].join(",");
    let start = -Math.PI / 2;
    data.forEach((value, i) => {
        if (!total || !value) return;
        const sweep = (value / total) * Math.PI * 2;
        let slice;
        if (sweep >= Math.PI * 2 - 1e-6) {
            // A single full slice cannot be drawn as an arc.
            slice = donut
                ? svgEl("circle", { cx, cy, r: (r + inner) / 2, fill: "none", "stroke-width": r - inner, class: "chart-ring" })
                : svgEl("circle", { cx, cy, r });
        } else {
            const end = start + sweep;
            const large = sweep > Math.PI ? 1 : 0;
            const d = donut
                ? `M${point(r, start)} A${r},${r} 0 ${large} 1 ${point(r, end)} L${point(inner, end)} A${inner},${inner} 0 ${large} 0 ${point(inner, start)} Z`
                : `M${cx},${cy} L${point(r, start)} A${r},${r} 0 ${large} 1 ${point(r, end)} Z`;
            slice = svgEl("path", { d });
        }
        slice.setAttribute("class", `chart-slice ${slice.getAttribute("class") ?? ""} ${seriesClass(i)}`.replace(/\s+/g, " ").trim());
        slice.setAttribute("data-series", i);
        const mid = start + sweep / 2;
        const [tx, ty] = point(r * (donut ? (1 + 0.55) / 2 : 0.6), mid).split(",").map(Number);
        addTip(ctx, slice, tx, ty, [labels[i] ?? "", `${format(value)} (${Math.round(value / total * 100)}%)`]);
        svg.append(slice);
        start += sweep;
    });
    // The legend of a pie lists the slices, not the series.
    return labels.map((name, i) => ({ name, props: { class: seriesClass(i) }, series: i }));
}

const DRAWERS = {
    bar: drawBar,
    line: drawLine,
    area: (svg, ctx) => drawLine(svg, { ...ctx, area: true }),
    sparkline: drawSparkline,
    pie: drawPie,
    donut: (svg, ctx) => drawPie(svg, { ...ctx, donut: true })
};

/* ------------------TABLE OF VALUES------------------- */

// The same numbers as a table, for screen readers and for people who want to read them off or copy them.
function buildDataTable({ labels, series, times, title, type, format = formatNumber, formatTime }) {
    const details = document.createElement("details");
    details.className = "chart-data";
    const summary = document.createElement("summary");
    summary.textContent = translate("showAsTable");
    const table = document.createElement("table");
    table.className = "athena-table chart-data-table";
    if (title) table.createCaption().textContent = title;
    const headRow = table.createTHead().insertRow();
    const names = type === "pie" || type === "donut" ? [series[0].name ?? ""] : series.map((s, i) => s.name ?? `${translate("series")} ${i + 1}`);
    ["", ...names].forEach((name, i) => {
        const th = document.createElement("th");
        th.scope = "col";
        th.textContent = i ? name : (times ? translate("time") : "");
        headRow.append(th);
    });
    const body = table.createTBody();
    const shown = type === "pie" || type === "donut" ? [series[0]] : series;
    const count = Math.max(...shown.map(s => s.data.length));
    const when = times ? { format: formatTime } : null;
    for (let i = 0; i < count; i++) {
        const row = body.insertRow();
        const head = document.createElement("th");
        head.scope = "row";
        head.textContent = times ? when.format(times[i]) : (labels[i] ?? "");
        row.append(head);
        for (const s of shown) row.insertCell().textContent = s.data[i] == null ? "" : format(s.data[i]);
    }
    details.append(summary, table);
    return details;
}

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
export function generateChart(options = {}) {
    const state = { used: { ...options, series: (options.series ?? []).map(s => ({ ...s, data: [...(s.data ?? [])] })) }, current: null, queued: false };
    if (options.labels) state.used.labels = [...options.labels];
    if (options.times) state.used.times = [...options.times];
    const hidden = new Set(options.hiddenSeries ?? []);
    let resizing = null;
    // Only the first drawing animates (bars grow, the line is drawn, slices pop in): a redraw while streaming or zooming must not start it again
    let firstDrawing = options.animate !== false;
    const hooks = {
        legend: (series, off) => {
            if (off) hidden.add(series);
            else hidden.delete(series);
            state.used.hiddenSeries = [...hidden];
        },
        zoom: range => {
            state.used = { ...state.used, zoomRange: range ?? null };
            handle.redraw();
            options.onZoom?.(range ?? null);
        }
    };
    const handle = {
        element: () => state.current.svg,
        redraw() {
            const next = buildChart(state.used, hooks, { animate: false });
            if (!next) return state.current?.svg;
            // A redraw replaces the whole SVG (every second while streaming, and when someone zooms). The keyboard focus would be lost
            // with it, so it goes to the same place in the new one: the same legend entry, the same point, or the plot.
            const old = state.current?.svg;
            const active = old && old.contains(document.activeElement) ? document.activeElement : null;
            const focusables = active ? [...old.querySelectorAll("[tabindex]")] : [];
            const position = active ? focusables.indexOf(active) : -1;
            if (state.current) {
                old.replaceWith(next.svg);
                state.current.table?.remove();
                if (next.table) next.svg.after(next.table);
            }
            state.current = next;
            if (active) {
                const now = [...next.svg.querySelectorAll("[tabindex]")];
                (active.classList.contains("chart-hit") || active.classList.contains("chart-reset") ? next.svg.querySelector(".chart-hit") : now[position] ?? next.svg.querySelector(".chart-hit"))?.focus({ preventScroll: true });
            }
            return attach(next.svg);
        },
        update(changes = {}) {
            state.used = { ...state.used, ...changes };
            return handle.redraw();
        },
        destroy() {
            resizing?.disconnect();
            state.current.svg.remove();
            state.current.table?.remove();
        },
        zoom: (from, to) => hooks.zoom({ from, to }),
        resetZoom: () => hooks.zoom(null),
        getZoom: () => state.used.zoomRange ?? null,
        push(point, config = {}) {
            const used = state.used;
            const values = Array.isArray(point.values) ? point.values : [point.values];
            used.series.forEach((s, i) => s.data.push(values[i] ?? NaN));
            if (used.times) used.times.push(toTime(point.x ?? Date.now()));
            else if (used.labels) used.labels.push(String(point.label ?? used.labels.length + 1));
            const limit = config.maxPoints ?? used.maxPoints;
            const extra = limit ? used.series[0].data.length - limit : 0;
            if (extra > 0) {
                for (const s of used.series) s.data.splice(0, extra);
                used.times?.splice(0, extra);
                used.labels?.splice(0, extra);
            }
            if (state.queued) return;
            state.queued = true;
            // Once per frame (the timer is for pages where frames are paused or late)
            let timer = 0;
            const run = () => {
                if (!state.queued) return;
                state.queued = false;
                clearTimeout(timer);
                handle.redraw();
            };
            requestAnimationFrame(run);
            timer = setTimeout(run, 100);
        }
    };
    const attach = svg => Object.defineProperties(svg, {
        element: { get: () => state.current.svg, configurable: true },
        update: { value: handle.update, configurable: true },
        destroy: { value: handle.destroy, configurable: true },
        zoom: { value: handle.zoom, configurable: true },
        resetZoom: { value: handle.resetZoom, configurable: true },
        getZoom: { value: handle.getZoom, configurable: true },
        push: { value: handle.push, configurable: true },
        dataTable: { get: () => state.current.table ?? null, configurable: true }
    });

    const host = resolveElement(options.parent ?? "wrapper") ?? document.body;
    if (options.responsive && host.clientWidth >= 120) state.used.width = Math.floor(host.clientWidth);
    const built = buildChart(state.used, hooks, { animate: firstDrawing });
    firstDrawing = false;
    if (!built) return null;
    state.current = built;
    host.append(built.svg);
    if (built.table) built.svg.after(built.table);
    if (options.responsive && typeof ResizeObserver === "function") {
        // The chart is as wide as its parent (the height stays): redrawn once per frame when the parent changes its width
        let frame = 0;
        resizing = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const width = Math.floor(host.clientWidth);
                if (width >= 120 && width !== state.used.width) handle.update({ width });
            });
        });
        resizing.observe(host);
    }
    return attach(built.svg);
}

function buildChart(options = {}, hooks, { animate = false } = {}) {
    const { type = "bar", id, title } = options;
    const sparkline = type === "sparkline";
    const width = options.width ?? (sparkline ? 120 : 600);
    const height = options.height ?? (sparkline ? 32 : 360);
    const draw = DRAWERS[type];
    const series = (options.series ?? []).filter(s => Array.isArray(s?.data) && s.data.length);
    if (!draw || !series.length) {
        console.error("Athena UI: generateChart needs a valid type and at least one series with data", options);
        return null;
    }
    const labels = (options.labels ?? []).map(String);
    const count = Math.max(...series.map(s => s.data.length));
    while (labels.length < count) labels.push(String(labels.length + 1));
    const times = options.times && (type === "line" || type === "area") ? options.times.map(toTime) : null;
    if (times && (times.length < count || times.some(Number.isNaN))) {
        console.error("Athena UI: generateChart `times` needs a valid time for every value", options);
        return null;
    }

    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width, height, class: `athena-chart athena-chart-${type}${animate && type !== "sparkline" ? " athena-chart-animated" : ""}`, role: "img" });
    if (id) svg.id = id;
    const summary = `${title ?? translate(`chart.${type}`)}: ${series.map(s => s.name ?? "").filter(Boolean).join(", ")}`.replace(/: $/, "");
    svg.setAttribute("aria-label", options.ariaLabel ?? summary);
    if (title && !sparkline) svg.append(svgEl("text", { x: width / 2, y: 24, "text-anchor": "middle", class: "chart-title" }, title));

    // The tooltip is created first, so the shapes can use it, and moved to the end afterwards, so it is drawn on top.
    const tooltip = createTooltip(svg, width);
    const margin = { ...DEFAULT_MARGIN, ...(options.margin ?? {}) };
    if (!sparkline && type !== "pie" && type !== "donut" && (options.legend ?? series.length > 1)) margin.bottom = Math.max(margin.bottom, LEGEND_BOTTOM);
    const format = typeof options.format === "function" ? options.format : formatNumber;
    const tickFormat = typeof options.tickFormat === "function" ? options.tickFormat : format;
    const formatTime = makeTimeFormatter(options.timeFormat);
    const ctx = { labels, series, width, height, times, options, tooltip, hooks, zoom: options.zoomRange ?? null, margin, format, tickFormat, formatTime };
    const pieLegend = draw(svg, ctx);
    if (!sparkline && (options.legend ?? (Boolean(pieLegend) || series.length > 1))) {
        addLegend(svg, pieLegend ?? series.map((s, i) => ({ name: s.name ?? `${translate("series")} ${i + 1}`, props: seriesProps(s, i), series: i })), width, height, ctx);
    }
    svg.append(tooltip.group);
    for (const index of options.hiddenSeries ?? []) {
        for (const node of svg.querySelectorAll(`[data-series="${index}"]`)) node.classList.add("chart-hidden");
        const entry = svg.querySelector(`.chart-legend-item[data-legend="${index}"]`);
        entry?.setAttribute("aria-pressed", "false");
        entry?.classList.add("is-off");
    }
    return { svg, table: options.table ? buildDataTable({ labels, series, times, title, type, format, formatTime }) : null };
}
