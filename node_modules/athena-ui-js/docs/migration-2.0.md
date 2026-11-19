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

## Upgrade in five steps

1. Replace `import AthenaUI from ...` and `window.` calls by named imports, or add the `classic.js` line.
2. Remove the jQuery script tag if nothing else of yours needs it.
3. Remove `enable_encrypt_password` and make the server hash the password.
4. Search your CSS for `.dialog-backdrop`, `.modal-content` (in dialogs) and `.accordion-open`, and for rules that only exist to beat Athena's specificity.
5. Run your tests, with a Content-Security-Policy on the page if you can: it tells you what still writes inline styles or scripts.
