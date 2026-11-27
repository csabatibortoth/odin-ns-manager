// Athena UI theme boot script (MIT). A classic script, not a module: load it in <head>, before the stylesheet, so the saved
// theme and mode are on <html> before the page is drawn and the wrong colours never flash. createThemeManager does the rest.
// It is a file of its own because a strict Content-Security-Policy does not allow an inline script. Configure it with
// data attributes on its own tag (they have to match createThemeManager):
//
//   <script src="/athena-ui/theme-boot.js" data-key="myapp.appearance" data-theme="ocean"></script>
//
//   data-key    localStorage key (default "athena.appearance")
//   data-theme  the theme that is used when nothing is saved (default "default")
//   data-dark-themes, data-light-themes  themes (ids, separated by spaces) that are dark / light while no mode has been chosen (their defaultMode in
//               createThemeManager)
(function () {
    var tag = document.currentScript;
    var key = (tag && tag.getAttribute("data-key")) || "athena.appearance";
    var theme = (tag && tag.getAttribute("data-theme")) || "default";
    var mode = "";          // none chosen
    var listed = function (name, id) { return ((tag && tag.getAttribute(name)) || "").split(/\s+/).indexOf(id) >= 0; };
    try {
        var saved = JSON.parse(localStorage.getItem(key) || "{}");
        if (/^[a-z0-9_-]+$/i.test(saved.theme || "")) theme = saved.theme;
        if (saved.mode === "light" || saved.mode === "dark" || (saved.mode === "system" && saved.chosen === true)) mode = saved.mode;
    } catch (e) {
        // Private browsing, or a value that is not JSON: the defaults
    }
    if (!mode) mode = listed("data-dark-themes", theme) ? "dark" : listed("data-light-themes", theme) ? "light" : "system";
    var dark = mode === "dark" || (mode === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-mode", dark ? "dark" : "light");
})();
