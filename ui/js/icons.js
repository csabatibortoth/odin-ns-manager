// The icons of the menu: simple line drawings on a 24 x 24 grid, drawn with
// the color of the text around them (see .icon in theme.css).

const SVG_NS = 'http://www.w3.org/2000/svg';

// Each icon is a list of [tag, attributes]
const ICONS = {
    dashboard: [['rect', { x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 13.5, y: 3.5, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.5 }]],
    dns: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M3 12h18M12 3c3.5 3.2 3.5 14.8 0 18M12 3c-3.5 3.2-3.5 14.8 0 18' }]],
    monitoring: [['path', { d: 'M3 12h4l3-8 4 16 3-8h4' }]],
    service: [['path', { d: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1' }], ['circle', { cx: 15, cy: 6, r: 2 }], ['circle', { cx: 9, cy: 12, r: 2 }], ['circle', { cx: 17, cy: 18, r: 2 }]],
    user: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4 21c0-4 3.6-6 8-6s8 2 8 6' }]],
    more: [['circle', { cx: 5, cy: 12, r: 1.4, class: 'solid' }], ['circle', { cx: 12, cy: 12, r: 1.4, class: 'solid' }], ['circle', { cx: 19, cy: 12, r: 1.4, class: 'solid' }]],
    // Half of a circle is filled: the light and the dark
    appearance: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 3.5a8.5 8.5 0 0 1 0 17z', class: 'solid' }]],
};

// An <svg> element for the name; an unknown name gets the "more" icon
export function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const [tag, attributes] of ICONS[name] || ICONS.more) {
        const node = document.createElementNS(SVG_NS, tag);
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
        svg.append(node);
    }
    return svg;
}
