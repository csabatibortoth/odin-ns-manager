// The graphs of the dashboard: line charts over time. The chart is the one of Athena UI (SVG, no inline style): this module is the card around it,
// with the title, the legend and the message for a graph without data. The colors are the ones of the theme (--series-1 ... in themes.css).

import { generateChart } from '../vendor/athena-ui/chart.js';
import { el } from './ui.js';

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
// A line breaks where nothing was measured; the time axis is the whole range that was asked for.
export function lineChart({ title, unit, series, format = formatNumber }) {
    const many = series.length > 1;
    const key = (index) => el('span', { class: `chart-key s${index + 1}` });
    const $plot = el('div', { class: 'chart-plot' });

    const $el = el(
        'section',
        { class: 'card chart' },
        el('h3', {}, title, unit ? el('span', { class: 'muted', text: ` ${unit}` }) : null),
        // One series is named by the title; more of them need a legend
        many ? el('div', { class: 'chart-legend' }, series.map((item, index) => el('span', {}, key(index), item.name))) : null,
        $plot
    );

    let chart = null;

    return {
        $el,
        update(data) {
            if (!data.t.length) {
                chart?.destroy();
                chart = null;
                $plot.empty().append(el('p', { class: 'chart-empty muted', text: 'Nothing is measured yet' }));
                return;
            }
            const changes = {
                times: data.t,
                timeRange: { from: data.from, to: data.to },
                series: series.map((item) => ({ name: item.name, data: data.values[item.key] || [] })),
            };
            if (chart) {
                chart.update(changes);
                return;
            }
            $plot.empty();
            chart = generateChart({
                parent: $plot[0],
                type: 'line',
                gaps: true,
                // A window that is half filled looks like a full one: no dots; the time of a value is short (the table of values is narrow)
                points: false,
                timeFormat: { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
                responsive: true,
                height: 190,
                margin: { top: 10, right: 14, bottom: 24, left: 46 },
                legend: false,
                table: true,
                animate: false,
                format,
                // The axis has round numbers of its own: a chart of whole numbers has ticks of 0.25 too
                tickFormat: (value) => formatNumber(value),
                ariaLabel: `${title}: line chart over time. The values are in the table below.`,
                ...changes,
            });
        },
    };
}
