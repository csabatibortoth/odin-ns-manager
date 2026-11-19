// The look of the interface: a theme (a set of colors, see css/themes.css) and
// a mode (light, dark, or whatever the system uses). Both are kept in the
// browser, and put on <html> as data-theme and data-mode, which is what the
// stylesheet reads. The work is done by the theme manager of Athena UI;
// theme-boot.js sets the same two attributes before the page is drawn.

import { createThemeManager } from '../vendor/athena-ui/theme.js';

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

// The same key as before, so what a person chose is kept. The color of the bar of the browser on a phone follows the header.
const manager = createThemeManager({ themes: THEMES, modes: MODES, storageKey: 'odin.appearance', themeColorVariable: '--header-bg' });

export const { appearance, setTheme, setMode, refresh } = manager;

// Called with { theme, mode, dark } now, and whenever the look changes
export const onAppearanceChange = manager.onChange;
