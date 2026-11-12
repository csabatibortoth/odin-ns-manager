// The graphs of the dashboard: line charts over time, drawn as SVG. The colors
// are the ones of the theme (.s1, .s2, ... in theme.css). Nothing is styled
// inline, as the content security policy of the interface does not allow it.

import { el, table } from './ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEIGHT = 190;
const MARGIN = { top: 10, right: 14, bottom: 24, left: 46 };
// The steps of the time axis, in seconds
const TIME_STEPS = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600];

function svg(tag, attributes = {}, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined));
    return node;
}

// The top of the value axis, and its ticks: round numbers, a few of them
function valueTicks(max) {
    if (!(max > 0)) max = 1;
    const power = 10 ** Math.floor(Math.log10(max / 4));
    const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => max / candidate <= 4);
    const ticks = [];
    for (let value = 0; value < max + step / 2; value += step) ticks.push(Math.round(value * 1e6) / 1e6);
    if (ticks.at(-1) < max) ticks.push(ticks.at(-1) + step);
    return ticks;
}

function timeTicks(from, to, most) {
    const step = (TIME_STEPS.find((candidate) => (to - from) / 1000 / candidate <= most) || TIME_STEPS.at(-1)) * 1000;
    // On the round minutes and hours of the clock of the reader
    const offset = new Date(to).getTimezoneOffset() * 60000;
    const ticks = [];
    for (let t = Math.ceil((from - offset) / step) * step + offset; t <= to; t += step) ticks.push(t);
    return ticks;
}

const clock = (t, seconds = false) =>
    new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined });

// 1234.5 -> "1,234.5"; small values keep a decimal or two
export function formatNumber(value, digits) {
    if (value === null || value === undefined || Number.isNaN(value)) return '–';
    const abs = Math.abs(value);
    return value.toLocaleString(undefined, { maximumFractionDigits: digits ?? (abs >= 100 ? 0 : abs >= 10 ? 1 : 2) });
}

// A card with a line chart.
// options: { title, unit, series: [{ key, name }], format: (value) => text }
// - the series take the colors of the theme in their order.
// Returns { $el, update(data) }; data: { from, to, t: [times], values: { key: [numbers or null] } }
export function lineChart({ title, unit, series, format = formatNumber }) {
    const many = series.length > 1;
    const $plot = el('div', { class: 'chart-plot' });
    const $tip = el('div', { class: 'chart-tip', role: 'status' }).hide();
    const $table = el('div');
    const $details = el('details', { class: 'chart-data' }, el('summary', { text: 'Data table' }), $table);
    const key = (index) => el('span', { class: `chart-key s${index + 1}` });

    const $el = el(
        'section',
        { class: 'card chart' },
        el('h3', {}, title, unit ? el('span', { class: 'muted', text: ` ${unit}` }) : null),
        // One series is named by the title; more of them need a legend
        many ? el('div', { class: 'chart-legend' }, series.map((item, index) => el('span', {}, key(index), item.name))) : null,
        $plot.append($tip),
        $details
    );

    let data = { from: 0, to: 1, t: [], values: {} };
    let width = 0;
    let scale = null; // of the last drawing: { x, y, plotRight }
    let hoverTime = null;
    let marks = null; // the group of the crosshair

    const fillTable = () => {
        if (!$details.prop('open')) return;
        const rows = data.t.map((t, index) => index).reverse();
        $table.empty().append(
            table(
                [
                    { title: 'Time', cell: (index) => clock(data.t[index], true) },
                    ...series.map((item) => ({ title: item.name, class: 'num', cell: (index) => format(data.values[item.key][index]) })),
                ],
                rows,
                'Nothing is measured yet.'
            )
        );
    };
    $details.on('toggle', fillTable);

    function draw() {
        if (!width) return;
        const right = width - MARGIN.right;
        const bottom = HEIGHT - MARGIN.bottom;
        const columns = series.map((item) => data.values[item.key] || []);
        const ticks = valueTicks(Math.max(0, ...columns.flat().filter((value) => value !== null)));
        const top = ticks.at(-1);
        const x = (t) => MARGIN.left + ((t - data.from) / (data.to - data.from)) * (right - MARGIN.left);
        const y = (value) => bottom - (value / top) * (bottom - MARGIN.top);
        scale = { x, y };

        const grid = ticks.map((tick) => [
            svg('line', { class: tick === 0 ? 'axis-line' : 'grid-line', x1: MARGIN.left, x2: right, y1: y(tick), y2: y(tick) }),
            svg('text', { class: 'tick', x: MARGIN.left - 8, y: y(tick), dy: '0.32em', 'text-anchor': 'end' }, formatNumber(tick)),
        ]);
        const times = timeTicks(data.from, data.to, width < 420 ? 4 : 6).map((t) =>
            svg('text', { class: 'tick', x: x(t), y: bottom + 16, 'text-anchor': 'middle' }, clock(t))
        );

        // A line breaks where nothing was measured; a lone point is drawn as a dot
        const lines = columns.map((column, index) => {
            let path = '';
            let pen = false;
            column.forEach((value, at) => {
                if (value === null || value === undefined) {
                    pen = false;
                    return;
                }
                const point = `${x(data.t[at]).toFixed(1)} ${y(value).toFixed(1)}`;
                const alone = !pen && (column[at + 1] === null || column[at + 1] === undefined);
                path += pen ? `L${point}` : `M${point}${alone ? 'h0.01' : ''}`;
                pen = true;
            });
            return svg('path', { class: `line s${index + 1}`, d: path });
        });

        marks = svg('g', { class: 'crosshair' });
        const chart = svg(
            'svg',
            { width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`, role: 'img', tabindex: 0, 'aria-label': `${title}: line chart over time. The values are in the data table below.` },
            grid,
            times,
            lines,
            marks,
            data.t.length ? null : svg('text', { class: 'tick', x: (MARGIN.left + right) / 2, y: (MARGIN.top + bottom) / 2, 'text-anchor': 'middle' }, 'Nothing is measured yet')
        );

        chart.addEventListener('pointermove', (event) => {
            const box = chart.getBoundingClientRect();
            const t = data.from + ((event.clientX - box.left - MARGIN.left) / (right - MARGIN.left)) * (data.to - data.from);
            hover(nearest(t));
        });
        chart.addEventListener('pointerleave', () => hover(null));
        chart.addEventListener('blur', () => hover(null));
        chart.addEventListener('keydown', (event) => {
            const move = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
            if (event.key === 'Escape') hover(null);
            if (!move || !data.t.length) return;
            event.preventDefault();
            const current = hoverTime === null ? (move > 0 ? -1 : data.t.length) : nearest(hoverTime);
            hover(Math.min(data.t.length - 1, Math.max(0, current + move)));
        });

        $plot.children('svg').remove();
        $plot.prepend(chart);
        if (hoverTime !== null) hover(nearest(hoverTime));
    }

    // The index of the sample that is the closest to a time
    function nearest(t) {
        let best = null;
        data.t.forEach((time, index) => {
            if (best === null || Math.abs(time - t) < Math.abs(data.t[best] - t)) best = index;
        });
        return best;
    }

    // Shows the values of a sample: a line at its time, a dot on every series, and the readout
    function hover(index) {
        marks?.replaceChildren();
        if (index === null || index === undefined || !scale) {
            hoverTime = null;
            $tip.hide();
            return;
        }
        hoverTime = data.t[index];
        const at = scale.x(hoverTime);
        marks.append(svg('line', { class: 'cross-line', x1: at, x2: at, y1: MARGIN.top, y2: HEIGHT - MARGIN.bottom }));
        series.forEach((item, order) => {
            const value = data.values[item.key][index];
            if (value !== null && value !== undefined) marks.append(svg('circle', { class: `dot s${order + 1}`, cx: at, cy: scale.y(value), r: 4 }));
        });

        $tip.empty().append(
            el('div', { class: 'muted', text: clock(hoverTime, true) }),
            series.map((item, order) =>
                el('div', {}, many ? key(order) : null, el('strong', { text: format(data.values[item.key][index]) }), many ? ` ${item.name}` : null)
            )
        ).show();
        // On the side of the line that has the room for it
        const leftSide = at > width / 2;
        $tip.css({ left: leftSide ? 'auto' : `${at + 12}px`, right: leftSide ? `${width - at + 12}px` : 'auto' });
    }

    new ResizeObserver(() => {
        const now = Math.floor($plot.width());
        if (now && now !== width) {
            width = now;
            draw();
        }
    }).observe($plot[0]);

    return {
        $el,
        update(next) {
            data = next;
            draw();
            fillTable();
        },
    };
}
