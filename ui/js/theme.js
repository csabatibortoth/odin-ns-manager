// The look of the interface: a theme (a set of colors, see css/themes.css) and
// a mode (light, dark, or whatever the system uses). Both are kept in the
// browser, and put on <html> as data-theme and data-mode, which is what the
// stylesheet reads.

const KEY = 'odin.appearance';

// The themes the stylesheet knows. The first one is the default.
export const THEMES = [
    { id: 'default', name: 'Default', description: 'Blue and grey' },
    { id: 'aesir', name: 'Aesir', description: 'Navy, orange and grey' },
];

export const MODES = [
    { id: 'system', name: 'Like the system' },
    { id: 'light', name: 'Light' },
    { id: 'dark', name: 'Dark' },
];

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

function read() {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
        return {
            theme: THEMES.some((theme) => theme.id === saved.theme) ? saved.theme : THEMES[0].id,
            mode: MODES.some((mode) => mode.id === saved.mode) ? saved.mode : 'system',
        };
    } catch {
        return { theme: THEMES[0].id, mode: 'system' };
    }
}

let current = read();

export const appearance = () => ({ ...current, dark: document.documentElement.dataset.mode === 'dark' });

function apply() {
    const dark = current.mode === 'dark' || (current.mode === 'system' && systemDark.matches);
    const root = document.documentElement;
    root.dataset.theme = current.theme;
    root.dataset.mode = dark ? 'dark' : 'light';
    // The color of the bar of the browser on a phone follows the header
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'theme-color';
        document.head.append(meta);
    }
    meta.content = getComputedStyle(root).getPropertyValue('--header-bg').trim() || '#1f4e79';
    listeners.forEach((listener) => listener(appearance()));
}

function save(change) {
    current = { ...current, ...change };
    try {
        localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
        // Not saved, but it works until the page is closed
    }
    apply();
}

// The stylesheet may have loaded after the first call: read the colors again
export const refresh = apply;

export const setTheme = (id) => THEMES.some((theme) => theme.id === id) && save({ theme: id });
export const setMode = (id) => MODES.some((mode) => mode.id === id) && save({ mode: id });

// Called with { theme, mode, dark } now, and whenever the look changes
export function onAppearanceChange(listener) {
    listeners.add(listener);
    listener(appearance());
    return () => listeners.delete(listener);
}

// "Like the system" follows the system while the page is open
systemDark.addEventListener('change', () => current.mode === 'system' && apply());
// Another tab changed it
window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return;
    current = read();
    apply();
});

apply();
