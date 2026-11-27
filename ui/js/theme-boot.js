// Runs before the page is drawn, so it never shows the wrong colors for a
// moment: puts the saved theme and mode on <html>. theme.js does the rest.
// It is a classic script of its own, as the content security policy of the
// interface does not allow one inside the page.
(function () {
    var theme = 'default';
    var mode = ''; // none chosen
    try {
        var saved = JSON.parse(localStorage.getItem('odin.appearance') || '{}');
        if (/^[a-z]+$/.test(saved.theme || '')) theme = saved.theme;
        if (saved.mode === 'light' || saved.mode === 'dark' || (saved.mode === 'system' && saved.chosen === true)) mode = saved.mode;
    } catch (e) {
        // Private browsing, or a value that is not JSON: the defaults
    }
    // The defaultMode of a theme (theme.js)
    if (!mode) mode = theme === 'bridge' ? 'dark' : 'system';
    var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-mode', dark ? 'dark' : 'light');
})();
