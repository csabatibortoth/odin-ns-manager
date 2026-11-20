# Moving from Athena UI 1.x to 2.0

2.0 is lighter and has no side effects: no jQuery, no globals, no libraries loaded at run time, and everything is in a cascade layer. Most of what you call
(`generateTable`, `showDialog`, `createRouter`, ...) is the same. This is the list of what is not, in the order you will probably meet it.

## 1. Imports: no default export, no globals

`athena-ui.js` is plain ES module exports now. Importing it does not touch the page, and nothing is put on `window`.

```js
// 1.x
import AthenaUI, { init } from "athena-ui-js";     // the default export is gone
window.generateTable(...)                          // the globals are gone

// 2.0
import { init, generateTable } from "athena-ui-js";
import { generateTable } from "athena-ui-js/table";   // or only what you use, so the rest is never downloaded
```

Entry points: `table`, `chart`, `dialog`, `menu`, `navigation`, `forms`, `feedback`, `components`, `inputs`, `router`, `session`, `theme`, `i18n`, `format`,
`validation`, `sanitize`, `csv`, `dom`, `controls`. Deep imports of files under `src/libs` are not part of the package interface (the `exports` map closes them).

**A page that needs the globals** (inline handlers, classic scripts, the `customLoader`) opts in with one line:

```html
<script type="module" src="node_modules/athena-ui-js/src/classic.js"></script>   <!-- window.generateTable, window.AthenaUI, ... -->
```

## 2. jQuery is gone

Athena UI has no jQuery code, and `jquery` is not a peer dependency any more. The one place where a jQuery object came back to you,
`HTMLControlGenerator.create(options)`, returns the element now: use `$(HTMLControlGenerator.create(options))` if you still want a jQuery object.
`HTMLControlGenerator.register(type, factory)`: the factory returns an element.

## 3. crypto-js and js-cookie are gone

- **`enable_encrypt_password` is removed.** The login, registration and change password forms return the password as it was typed. Send it over HTTPS and hash
  it on the server (argon2, scrypt, bcrypt). Hashing it in the browser only turns the hash into the password. If your server expects a SHA-256 hash, change
  the server, or hash in your own `login` callback with `crypto.subtle.digest("SHA-256", ...)`.
- **`Cookies`** is a small helper of our own with `get`, `set` and `remove` (days or a `Date` for `expires`, `path`, `domain`, `sameSite`, `secure`).
  What js-cookie had beyond that (`getJSON`, `withAttributes`, converters) is not there.
- No script is loaded at run time any more (`libs.js` and `loadLibs` are removed). `customLoader` (your own classic script) still works.

## 4. HTMLElementGenerator and HTMLControlGenerator

They are part of Athena UI (`athena-ui-js/controls`) and no longer git submodules. The calls are the same; with the classic build they are globals again.

## 5. Dialogs and the accordion use native elements

- `showDialog` (and `confirmDialog`, `promptDialog`, `showConfirm`, `showFormDialog`) opens a real `<dialog>` with `showModal()`. The browser traps the focus, closes
  it with Esc, draws the backdrop and puts it in the top layer. In your CSS, `.dialog-backdrop` and `.modal-content` are gone from these dialogs: style
  `dialog.dialog`, `dialog.dialog::backdrop` and `.dialog-inner`. `handle.backdrop` is the dialog element too. In a test (jsdom) use `installDom` from
  `athena-ui-js/testing`, which gives jsdom `showModal()`; a synthetic Esc key does not close a native dialog, send the `cancel` event instead.
- `generateAccordion` is `<details>` and `<summary>`: `.accordion-header` is a `<summary>`, there is no `aria-expanded` on a button, `.accordion-open` is the
  `[open]` attribute and `.accordion-title` is gone. `accordion.toggle(index, open)` works as before.
- The dropdown and the tooltip became native popovers in 2.1 (see the release notes): the menu is `<div class="dropdown-menu" popover>` (no `hidden` attribute any more: use `:popover-open`), and the tooltip text is a `popover="manual"` element.

## 6. CSS: a layer, tokens and dark mode

- All rules of the default theme are in the cascade layer `athena`, so a plain rule of your application wins without a more specific selector. If you used
  `!important` or a longer selector to beat Athena, you can take it out. If you put Athena's CSS into **your own layer order**, declare `athena` where you want it.
- The tokens are in `src/res/themes/tokens.css` (radius, spacing, border, focus ring, dialog widths, row height and the colours), see `docs/styling.md` for every
  class and variable. The new tokens are `--athena-focus`, `--athena-focus-width`, `--athena-border-width`, `--athena-space-1` ... `--athena-space-4`,
  `--athena-dialog-small|medium|large` and `--athena-row-height`.
- **The default theme follows the system now**: on a device that prefers dark colours it is dark unless `data-mode="light"` is on `<html>`. To keep it light
  always, put `data-mode="light"` on `<html>` (or use `createThemeManager`, which does it).
- `src/res/themes/dark/style.css` (theme `{ id: 1 }`) still works.

## 7. Small things

- Messages with plural forms: `validation.minLength`, `validation.maxLength` and `validation.maxFiles` are `{ one, other }` objects in the built-in English texts. A message you
  override with `addMessages` can stay a plain string. `translate` knows `{name:number}` and `{name:date}`, and chooses a plural form by `params.count`.
- `package.json`: `"sideEffects"` lists only `classic.js`, `theme-boot.js` and CSS, so bundlers can drop what you do not use. TypeScript definitions are in `types/`.
- The browser tests run under a strict Content-Security-Policy (no inline script, no inline style) and fail on any violation: the library does not need `'unsafe-inline'`.
- `init()` and `createApp({ root })`: `createApp` builds the layout into an element of your page instead of the body.

## 8. What Odin NS Manager needed when it moved (a real application, 2.x)

Odin moved with little work, and then replaced its own copies of the theme manager, the header menu, forms, tables and charts. What it found:

- **`HTMLControlGenerator` and `HTMLElementGenerator` are in Athena** (`athena-ui-js/controls`, `src/libs/core/elementGenerator.js`); you do not need the old packages. They are plain functions now, without jQuery: if your code
  wrapped their result in jQuery, wrap it where you use it (`$(HTMLControlGenerator.create(...))`).
- **Dialogs are native `<dialog>` elements.** A selector such as `.dialog-backdrop .dialog` or `.modal-content` finds nothing; use `showDialog(...).element` or the `class` option. The close button has the class `dialog-close`.
- **Form parts** have classes of their own: `.form-message` (the line under the fields, `.form-message-error` / `-success`) and `.form-actions` (the buttons). Rules that styled your own copies of these can go.
- **Delete from your stylesheet**: rules that beat Athena's specificity (it is in the layer `athena` now, a plain rule wins), your copy of the theme variables (use `createThemeManager` and the tokens), the menu repair
  (icons, active item, keyboard are in `generateMenu`), and the table CSS for a narrow screen (`stack: true`).
- **Order that worked**: the theme manager first (a drop-in), then the menu, then the pieces where Athena lacked something (forms, tables, charts): define what is missing in the application, build it in the library with
  tests, install the packed tarball into the application with `npm install --no-save <file>.tgz`, and only when the library is published change the dependency.
- **Check with the real application**: run it with a throwaway database, take screenshots of every page before and after, and drive the flows with real input. Not everything has to move: Odin keeps its own
  `el()` wrapper, its API client and its list loader.
- **Smaller downloads**: import from the entry points (`athena-ui-js/table`, ...) and start with `athena-ui-js/app` instead of the root file, which loads every module.

## 9. What Heimdall needed when it moved (a second real application, 2.6 to 2.7)

Heimdall replaced its chart library (uPlot), its log filter, its custom views and its own dialogs, forms and tables with Athena. What it found:

- **Generic class names collide.** Athena styles plain class names such as `.facts`, `.fact`, `.widget`, `.widget-body`, `.widget-header`, `.widget-title`, `.stat`, `.toast`, `.dialog`, `.empty-state`, `.loading-state`, `.page-header`,
  `.page-title`, `.page-actions`, `.card`, `.badge`, `.alert`, `.tab`, `.field`, `.field-label`, `.menu`, `.dropdown`, `.sidebar`, `.chip`, `.stepper`, `.avatar`, `.spinner`, `.pagination`, `.choice`, `.switch`, `.combobox`,
  `.chart-legend`, `.theme-picker`, `.theme-preview`, `.form-actions`, `.form-message`. If your application used one of them for something of its own (a `.facts` list, a `.widget` of a dashboard), its look changes:
  rename yours (a prefix of your application is enough) or use the Athena part. The full list is the file `docs/styling.md` (`npm run docs`); search it for the names you use.
- **Rules of your own must not be unlayered if you want Athena to win, and the other way round**: Athena is in the layer `athena`, so any plain rule of yours beats it. That is the way to restyle, and also the way an old `.grid td` or `td` rule
  leaks into an Athena table (add a rule for the Athena class, for example `.is-stacked .grid td`).
- **A theme preview needs the variables for the mode**: map your theme variables for `:root, [data-theme][data-mode]`, not only for `:root[data-theme]`, otherwise the pictures of a theme in the picker all look the same.
  `generateThemePicker({ previewModes: "both" })` shows the light and the dark picture side by side.
- **Tests**: run the application's tests with `installDom` from `athena-ui-js/testing` instead of a copy of jsdom setup, and import Athena modules after it is installed.
- **Escape closes a dialog by the `cancel` event** of the native `<dialog>`; a test that sends a key must dispatch `cancel`.
- **New in 2.7.0 for what Heimdall had to write itself**: `hideLabel` for a field, `contentSize` and a right `size` on a resize of a widget, `addWidgetWithSettings`, `changeDelay` and `flush()` for the layout of a grid,
  `getLayout({ breakpoint })`, room for a chart legend, no gap under a chart, and a page header that keeps the actions on the row of the title.

## Upgrade in five steps

1. Replace `import AthenaUI from ...` and `window.` calls by named imports, or add the `classic.js` line.
2. Remove the jQuery script tag if nothing else of yours needs it.
3. Remove `enable_encrypt_password` and make the server hash the password.
4. Search your CSS for `.dialog-backdrop`, `.modal-content` (in dialogs) and `.accordion-open`, and for rules that only exist to beat Athena's specificity.
5. Run your tests, with a Content-Security-Policy on the page if you can: it tells you what still writes inline styles or scripts.
