//chartGenerator for Athena UI
//Author: Csaba Tóth https://github.com/csabatibortoth/
//LICENCE: MIT
//Repository: https://github.com/csabatibortoth/athena-ui

// Dependency free SVG charts: bar, line, pie and donut.

const NS = "http://www.w3.org/2000/svg";
const PALETTE = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"];
const MARGIN = { top: 40, right: 20, bottom: 50, left: 55 };

const svgEl = (tag, attrs = {}, text) => {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    if (text != null) node.textContent = text;
    return node;
};

const colorOf = (series, index) => series.color ?? PALETTE[index % PALETTE.length];
const formatNumber = n => Number.isInteger(n) ? String(n) : String(+n.toFixed(2));

// Rounded axis maximum and tick step, so ticks land on readable numbers.
function niceScale(span, ticks = 5) {
    if (span <= 0) return { span: 1, step: 1 / ticks };
    const rough = span / ticks;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].map(m => m * magnitude).find(s => s >= rough);
    return { span: step * Math.ceil(span / step - 1e-9), step };
}

function addLegend(svg, entries, width, height) {
    let x = MARGIN.left;
    const y = height - 12;
    for (const { name, color } of entries) {
        svg.append(svgEl("rect", { x, y: y - 9, width: 10, height: 10, fill: color }));
        svg.append(svgEl("text", { x: x + 14, y, class: "chart-legend" }, name));
        x += 14 + name.length * 7 + 14;
        if (x > width) break;
    }
}

// Draws grid, ticks and axes for the value range [min, min + scale.span].
function addAxes(svg, { labels, min, scale, width, height }) {
    const plotW = width - MARGIN.left - MARGIN.right;
    const plotH = height - MARGIN.top - MARGIN.bottom;
    const y = value => MARGIN.top + plotH - ((value - min) / scale.span) * plotH;
    const ticks = Math.round(scale.span / scale.step);
    for (let i = 0; i <= ticks; i++) {
        const v = min + i * scale.step;
        svg.append(svgEl("line", { x1: MARGIN.left, x2: MARGIN.left + plotW, y1: y(v), y2: y(v), class: "chart-grid" }));
        svg.append(svgEl("text", { x: MARGIN.left - 8, y: y(v) + 4, "text-anchor": "end", class: "chart-tick" }, formatNumber(v)));
    }
    const band = plotW / Math.max(labels.length, 1);
    labels.forEach((label, i) => svg.append(svgEl("text",
        { x: MARGIN.left + band * (i + 0.5), y: MARGIN.top + plotH + 18, "text-anchor": "middle", class: "chart-tick" }, label)));
    svg.append(svgEl("line", { x1: MARGIN.left, x2: MARGIN.left, y1: MARGIN.top, y2: MARGIN.top + plotH, class: "chart-axis" }));
    // The category axis sits at zero when the range includes it, so negative bars hang below it.
    const baseline = y(Math.min(Math.max(0, min), min + scale.span));
    svg.append(svgEl("line", { x1: MARGIN.left, x2: MARGIN.left + plotW, y1: baseline, y2: baseline, class: "chart-axis" }));
    return { band, y };
}

function valueRange(series) {
    const values = series.flatMap(s => s.data);
    const min = Math.min(0, ...values);
    const scale = niceScale(Math.max(0, ...values) - min);
    return { min, scale };
}

function drawBar(svg, { labels, series, width, height }) {
    const { min, scale } = valueRange(series);
    const { band, y } = addAxes(svg, { labels, min, scale, width, height });
    const groupWidth = band * 0.8;
    const barWidth = groupWidth / series.length;
    series.forEach((s, si) => s.data.forEach((value, i) => {
        const x = MARGIN.left + band * i + (band - groupWidth) / 2 + barWidth * si;
        const top = Math.min(y(value), y(0));
        const bar = svgEl("rect", {
            x, y: top, width: Math.max(barWidth - 2, 1), height: Math.abs(y(0) - y(value)),
            fill: colorOf(s, si), class: "chart-bar"
        });
        bar.append(svgEl("title", {}, `${s.name ?? ""} ${labels[i] ?? ""}: ${formatNumber(value)}`.trim()));
        svg.append(bar);
    }));
}

function drawLine(svg, { labels, series, width, height }) {
    const { min, scale } = valueRange(series);
    const { band, y } = addAxes(svg, { labels, min, scale, width, height });
    series.forEach((s, si) => {
        const color = colorOf(s, si);
        const points = s.data.map((v, i) => [MARGIN.left + band * (i + 0.5), y(v)]);
        svg.append(svgEl("polyline", {
            points: points.map(p => p.join(",")).join(" "), fill: "none", stroke: color, "stroke-width": 2, class: "chart-line"
        }));
        points.forEach(([cx, cy], i) => {
            const dot = svgEl("circle", { cx, cy, r: 4, fill: color, class: "chart-point" });
            dot.append(svgEl("title", {}, `${s.name ?? ""} ${labels[i] ?? ""}: ${formatNumber(s.data[i])}`.trim()));
            svg.append(dot);
        });
    });
}

function drawPie(svg, { labels, series, width, height, donut }) {
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
        const color = PALETTE[i % PALETTE.length];
        let slice;
        if (sweep >= Math.PI * 2 - 1e-6) {
            // A single full slice cannot be drawn as an arc.
            slice = donut
                ? svgEl("circle", { cx, cy, r: (r + inner) / 2, fill: "none", stroke: color, "stroke-width": r - inner })
                : svgEl("circle", { cx, cy, r, fill: color });
        } else {
            const end = start + sweep;
            const large = sweep > Math.PI ? 1 : 0;
            const d = donut
                ? `M${point(r, start)} A${r},${r} 0 ${large} 1 ${point(r, end)} L${point(inner, end)} A${inner},${inner} 0 ${large} 0 ${point(inner, start)} Z`
                : `M${cx},${cy} L${point(r, start)} A${r},${r} 0 ${large} 1 ${point(r, end)} Z`;
            slice = svgEl("path", { d, fill: color, stroke: "#fff" });
        }
        slice.setAttribute("class", "chart-slice");
        slice.append(svgEl("title", {}, `${labels[i] ?? ""}: ${formatNumber(value)} (${Math.round(value / total * 100)}%)`));
        svg.append(slice);
        start += sweep;
    });
    // The legend of a pie lists the slices, not the series.
    return labels.map((name, i) => ({ name, color: PALETTE[i % PALETTE.length] }));
}

const DRAWERS = {
    bar: drawBar,
    line: drawLine,
    pie: drawPie,
    donut: (svg, o) => drawPie(svg, { ...o, donut: true })
};

/**
 * Draws a chart as inline SVG and appends it to its parent.
 *
 * @param {object} options
 * @param {"bar"|"line"|"pie"|"donut"} [options.type="bar"]
 * @param {string} [options.parent] id of the parent element, defaults to "wrapper"
 * @param {string} [options.id] id of the svg element
 * @param {string} [options.title]
 * @param {string[]} [options.labels] category labels
 * @param {{name?: string, data: number[], color?: string}[]} options.series pie / donut use the first series only
 * @param {number} [options.width=600]
 * @param {number} [options.height=360]
 * @param {boolean} [options.legend] default: shown for several series, and for pie / donut
 * @returns {SVGElement|null} null when the options are invalid
 */
export function generateChart(options = {}) {
    const { type = "bar", parent = "wrapper", id, title, width = 600, height = 360 } = options;
    const draw = DRAWERS[type];
    const series = (options.series ?? []).filter(s => Array.isArray(s?.data) && s.data.length);
    if (!draw || !series.length) {
        console.error("Athena UI: generateChart needs a valid type and at least one series with data", options);
        return null;
    }
    const labels = (options.labels ?? []).map(String);
    const count = Math.max(...series.map(s => s.data.length));
    while (labels.length < count) labels.push(String(labels.length + 1));

    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width, height, class: "athena-chart", role: "img" });
    if (id) svg.id = id;
    if (title) {
        svg.setAttribute("aria-label", title);
        svg.append(svgEl("text", { x: width / 2, y: 24, "text-anchor": "middle", class: "chart-title" }, title));
    }

    const pieLegend = draw(svg, { labels, series, width, height });
    if (options.legend ?? (Boolean(pieLegend) || series.length > 1)) {
        addLegend(svg, pieLegend ?? series.map((s, i) => ({ name: s.name ?? `Series ${i + 1}`, color: colorOf(s, i) })), width, height);
    }
    (document.getElementById(parent) ?? document.body).append(svg);
    return svg;
}
