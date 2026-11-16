# Athena UI

A small jQuery based UI framework for development and education purposes. It generates a page
layout (header, menu, content wrapper, footer) from a single `init()` call, loads its own libraries
and theme, and ships the building blocks of a multipurpose application: forms, tables, charts,
feedback, navigation, a router and more.

Current version: **1.0.0** (first stable release)

[Quick start](#usage) · [API](#api) · [Components](#charts) · [Themes](#themes) · [Tests](#tests) · [Release notes](#releases)

## Status

1.0.0 is the first stable release. From here on the exported API of `src/athena-ui.js` follows
[semantic versioning](https://semver.org/): breaking changes only come with a new major version.
Known limits are listed below, so you can judge whether it fits your project:

- Rich text uses the deprecated `document.execCommand`. Content is sanitized in the browser, but sanitize it on the server too.
- The session cookie is readable from JavaScript. It is a UI state, not a security boundary: authenticate on the server.
- Virtual table rows have to be a fixed height, one line per cell.
- Translations: English and Hungarian.

## Features

- Generated page layout: container, header (logo, title, menu), wrapper, footer (menu, copyright text)
- Menus built from your own item lists, with a navigation callback
- Login, registration and lost password forms with optional SHA-256 password hashing
- SVG charts (bar, line, pie, donut) without extra dependencies
- Tables with sortable columns, filter box, pagination, row selection, inline editing, resizable columns, virtual scrolling for thousands of rows and CSV export
- Form builder: text, number, date, textarea, select, radio / checkbox groups, switch, autocomplete, multi select, with validation
- Buttons, toasts, alerts, spinner, progress bar, alert / confirm / prompt dialogs
- Tabs, accordion, dropdown, sidebar, breadcrumbs, pagination and a hash / history router
- Cards, grid, badges, avatars, KPI tiles, tooltips, links, sections
- File upload with progress, stepper (wizard), date range picker, rich text editor
- Menus with submenus
- Session handling (login state in a cookie), change password form
- Default and dark theme (switchable at runtime), responsive, translations (English, Hungarian), keyboard and ARIA support
- Modal open / close helpers
- Themes loaded at runtime, custom stylesheets supported
- Written as ES modules, no build step

## Requirements

- [jQuery](https://jquery.com/) v4.0.0, loaded before Athena UI
- A browser with ES module support
- The page has to be served over HTTP(S). Modules do not load from `file://`.

Bundled as git submodules:

| Library | Version | Used for |
| --- | --- | --- |
| [HTMLControlGenerator](https://github.com/csabatibortoth/HTMLControlGenerator) | 0.4.0 | inputs, lists |
| [HTMLElementGenerator](https://github.com/csabatibortoth/HTMLElementGenerator) | 0.3.0 | divs, headings, images |
| [crypto-js](https://github.com/brix/crypto-js) | 4.2.0 | password hashing |
| [js-cookie](https://github.com/js-cookie/js-cookie) | 3.0.8 | cookie handling |

## Installation

```sh
git clone --recurse-submodules https://github.com/csabatibortoth/athena-ui.git
```

In an existing clone, or after updating:

```sh
git submodule update --init
```

Serve the `src` folder with any static web server and open `index.html` to see the example.

## Usage

```html
<script src="https://code.jquery.com/jquery-4.0.0.min.js"
    integrity="sha256-OaVG6prZf4v69dPg6PhVattBXkcOWQB62pdZ3ORyrao=" crossorigin="anonymous"></script>
<script type="module">
    import { init, clearWrapper, generateLoginForm } from "./athena-ui.js";

    init({
        theme: { id: 0 },
        config: { header_title_text: "My App", login_enabled: true },
        menuItems: {
            headerMenu: [
                { id: "menu-home", class: "menu-item", text: "", inner_text: "Home" },
                { id: "menu-login", class: "menu-item", text: "", inner_text: "Login" }
            ],
            footerMenu: []
        },
        nav: page => {
            if (page === "Login") {
                clearWrapper();
                generateLoginForm();
            }
        },
        login: ({ username, password }) => console.log(`${username} logged in`)
    });
</script>
```

`init()` returns a Promise that resolves with the effective configuration once the libraries and
the theme are loaded and the layout is generated.

### init options

| Option | Description |
| --- | --- |
| `theme` | `{ id }` of a theme registered in `res/themes/themes.js`, or `{ href }` of a custom stylesheet. Defaults to the default theme. |
| `config` | Settings overriding the defaults, see [Configuration](#configuration). |
| `menuItems` | `{ headerMenu, footerMenu }`, arrays of `{ id, class, text, inner_text }`. Placeholder items are generated without it. |
| `nav` | Called without arguments when the wrapper is generated, and with the `inner_text` of the item on menu clicks. |
| `login` | Called with `{ username, password }` when the login button is clicked and `login_enabled` is set. |
| `register` | Called with `{ username, email, password }` when a valid registration form is submitted and `registration_enabled` is set. |
| `lostPassword` | Called with `{ email }` when a valid lost password form is submitted and `lost_password_enabled` is set. |
| `changePassword` | Called with `{ currentPassword, newPassword }` when a valid change password form is submitted and `change_password_enabled` is set. |

### Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `header_title_text` | `"Athena UI"` | Title in the header |
| `header_img_url` | | Header logo URL |
| `copyright` | placeholder text | Footer text, the version is appended |
| `version` | `"1.0.0"` | Version shown in the footer |
| `bordered` | `true` | Draw a border around the layout blocks |
| `generateHeader`, `generateFooter` | `true` | Generate the header / footer block |
| `generateHeadercontent`, `generateFooterContent`, `generateWrappercontent` | `true` | Generate the content of the block |
| `login_enabled` | `false` | Call the `login` callback from the login form |
| `registration_enabled` | `false` | Call the `register` callback from the registration form |
| `lost_password_enabled` | `false` | Call the `lostPassword` callback from the lost password form |
| `change_password_enabled` | `false` | Call the `changePassword` callback from the change password form |
| `login_remember_me` | `false` | Show a "Remember me" checkbox in the login form, passed to `login` as `remember` |
| `locale` | `"en"` | Language of the generated texts (`en`, `hu`, or your own, see [Translations](#translations)) |
| `session_cookie` | `"athena_session"` | Name of the session cookie |
| `session_days` | `7` | Lifetime of a remembered session in days |
| `enable_encrypt_password` | `false` | SHA-256 hash the password before it is passed to `login` / `register` |
| `customLoader` | | URL of an extra classic script, loaded before the layout is generated |
| `container_class`, `header_class`, `header_menu_class`, `wrapper_class`, `footer_class`, `footer_menu_class`, `loginForm_class`, `registrationForm_class`, `lostPasswordForm_class`, `changePasswordForm_class` | | CSS classes of the generated blocks |

### API

Everything is exported from `athena-ui.js`:

| Export | Description |
| --- | --- |
| `init(options)` | Loads everything and generates the layout |
| `config` | The live configuration object |
| `generateBasicLayout()`, `generateHeader()`, `generateWrapper()`, `generateFooter()` | Layout generation |
| `clearHeader()`, `clearWrapper()`, `clearFooter()`, `clearHeaderMenu()`, `clearFooterMenu()` | Empty a block |
| `generateBasicMenu(options)` | Generate a menu into any parent |
| `generateLoginForm()`, `getLoginFormData()` | Login form into the wrapper, and its current values |
| `generateRegistrationForm(parent)`, `getRegistrationFormData()`, `validateRegistrationForm()` | Registration form (username, email, password, confirmation) into `parent` (default `wrapper`). Validated before the callback is called. |
| `generateLostPasswordForm(parent)`, `getLostPasswordFormData()` | Lost password form (email) |
| `generateChart(options)` | Draw a chart, see [Charts](#charts) |
| `generateTable(options)` | Draw a table, see [Tables](#tables) |
| `generateChangePasswordForm(parent)`, `getChangePasswordFormData()`, `validateChangePasswordForm()` | Change password form |
| `generateForm`, `generateField`, `generateButton` | Form builder, see [Forms](#forms) |
| `showToast`, `generateAlert`, `generateSpinner`, `generateProgress` | See [Feedback](#feedback) |
| `showDialog`, `alertDialog`, `confirmDialog`, `promptDialog` | See [Dialogs](#dialogs) |
| `generateTabs`, `generateBreadcrumbs`, `generatePagination`, `generateAccordion`, `generateDropdown`, `generateSidebar` | See [Navigation](#navigation) |
| `createRouter(options)` | See [Router](#router) |
| `generateCard`, `generateSection`, `generateGrid`, `generateBadge`, `generateAvatar`, `generateStat`, `generateLink`, `generateTooltip` | See [Components](#components) |
| `generateAutocomplete`, `generateMultiSelect`, `generateFileUpload`, `generateStepper`, `generateDateRange`, `generateRichText` | See [Inputs](#inputs) |
| `sanitizeHtml(html)`, `htmlToText(html)`, `isSafeUrl(url)` | The allow-list sanitizer behind the rich text editor |
| `setSession`, `getSession`, `isLoggedIn`, `logout`, `onSessionChange` | See [Session](#session) |
| `translate`, `setLocale`, `getLocale`, `addMessages` | See [Translations](#translations) |
| `validateValue`, `validateAll` | The validator behind the form builder |
| `toCsv(columns, rows)`, `downloadFile(name, text)` | CSV helpers |
| `setTheme({ id })` | Switch the theme at runtime |
| `openModal(id)`, `closeModal(id)` | Show / hide a `.modal` element (default id: `myModal`). Elements with the `close` class close their modal. |
| `loadScript(src)` | Load a classic script once, returns a Promise |
| `Cookies` | The [js-cookie](https://github.com/js-cookie/js-cookie) API |
| `HTMLElementGenerator(options)` | The [HTMLElementGenerator](https://github.com/csabatibortoth/HTMLElementGenerator) function |

### Charts

```js
generateChart({
    type: "bar",                 // "bar" | "line" | "pie" | "donut"
    parent: "wrapper",           // id of the parent element (default)
    title: "Revenue",
    labels: ["Q1", "Q2", "Q3"],
    series: [
        { name: "2025", data: [12, 19, 8] },
        { name: "2026", data: [14, 17, 12], color: "#e15759" }
    ]
});
```

Charts are inline SVG and support negative values. `pie` and `donut` use the first series, one slice per
label. Other options: `id`, `width` (600), `height` (360), `legend` (shown for several series and for
pie / donut). Returns the `<svg>` element, or `null` when the options are invalid.

### Tables

```js
const { setRows } = generateTable({
    parent: "wrapper",
    caption: "Users",
    columns: [{ key: "name", label: "Name" }, { key: "age", label: "Age", format: v => `${v} y` }],
    rows: [{ name: "Anna", age: 31 }, { name: "Béla", age: 27 }],
    filter: true,                // text filter box
    pageSize: 10,                // 0 = no pagination
    onRowClick: row => console.log(row)
});
```

Click a header to sort (disable with `sortable: false`, or per column). Other options: `id`, `class`,
`emptyText`. Returns `{ element, setRows(rows), getSelected(), clearSelection(), toCsv(), exportCsv(filename) }`.

- `selectable: true` adds a checkbox column (the header checkbox selects every filtered row), `onSelectionChange(rows)` reports changes.
- A column with `editable: true` can be edited with a double click, or Enter / F2 on the focused cell. `onEdit(row, key, value, oldValue)` is called after the edit; return `false` to reject it. Numeric cells stay numbers.
- `resizableColumns: true` puts a drag handle on every header edge. The handle is focusable too: Left / Right resize by 10 px, Shift by 50 px, double click resets the column to its configured `width`. Columns take `width`, `minWidth` and `maxWidth`; `onColumnResize(key, width)` and `getColumnWidths()` let you persist the layout.
- `virtual: { height: 400, rowHeight: 36, overscan: 5 }` (or `virtual: true`) renders only the rows in view and keeps the scroll bar the size of the whole list, so 10 000+ rows stay fast. Rows have a fixed height (the theme enforces it, one line per cell), the table scrolls inside `height` and its header stays visible. It replaces pagination; filtering, sorting, selection, editing and CSV export work as usual.
- `exportCsv()` downloads the filtered and sorted rows. Cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so a spreadsheet does not run them as formulas.

### Forms

```js
const form = generateForm({
    parent: "wrapper",
    submitText: "Save",
    fields: [
        { name: "name", label: "Name", required: true, minLength: 2, help: "At least 2 characters" },
        { name: "email", label: "Email", type: "email", required: true },
        { name: "password", label: "Password", type: "password", required: true },
        { name: "password2", label: "Repeat", type: "password", match: "password" },
        { name: "country", label: "Country", type: "select", placeholder: "Choose...", options: ["Hungary", "Italy"] },
        { name: "plan", type: "radio", label: "Plan", options: ["Free", "Pro"], value: "Free" },
        { name: "news", type: "switch", label: "Newsletter" }
    ],
    onSubmit: async values => { await save(values); }   // called when every field is valid
});
```

Field types: `text`, `password`, `email`, `number`, `date`, `datetime-local`, `time`, `month`, `week`, `url`, `tel`,
`search`, `color`, `range`, `file`, `hidden`, `textarea`, `select` (`multiple`), `checkbox`, `switch`, `radio`,
`checkboxes`, `autocomplete`, `multiselect`, `daterange` (value `{ from, to }`), `richtext` (value: safe HTML).
The date, time and color types use the native pickers of the browser.

Rules (`required`, `email`, `minLength`, `maxLength`, `pattern`, `min`, `max`, `match`, `validate(value, values)`) can be
given on the field or in `rules`. A field is validated when it loses focus, then on every change. A rejected
`onSubmit` promise is shown as form message and the submit button shows a spinner while it runs.

The returned form has `getValues()`, `setValues()`, `setErrors({ name: "Taken" })` (server side errors),
`validate()`, `reset()`, `setMessage(text)`, `fields` and `submitButton`. `generateField(options)` builds a single field.

`generateButton({ text, variant, loading, disabled, onclick })` has the variants `primary`, `secondary`, `danger` and
`link`, and returns `{ element, setLoading, setDisabled, setText }`.

### Feedback

```js
showToast({ title: "Saved", message: "All good", type: "success", duration: 4000 });   // info | success | warning | error
generateAlert({ parent: "wrapper", type: "error", message: "Failed", dismissible: true });
generateSpinner({ parent: "wrapper", size: "large" });
const progress = generateProgress({ parent: "wrapper", label: "Upload", value: 20 });   // no value: indeterminate
progress.setValue(60);
```

### Dialogs

```js
await alertDialog("Saved");
if (await confirmDialog("Delete the item?", { title: "Delete", confirmText: "Delete", danger: true })) { /* ... */ }
const name = await promptDialog("Your name", { validate: v => v ? "" : "Required" });   // null when cancelled
const choice = await showDialog({ title: "Custom", content: "Pick one", buttons: [{ text: "A", value: "a" }, { text: "B", value: "b" }] });
```

Dialogs trap the focus, close with Esc (resolving `null` / `false`) and restore the focus. Text content is
never parsed as HTML. `openModal` / `closeModal` got the same focus handling.

### Navigation

```js
generateTabs({ parent: "wrapper", tabs: [{ id: "a", label: "A", content: "First" }, { id: "b", label: "B", content: () => lazyNode() }] });
generateAccordion({ parent: "wrapper", items: [{ title: "Q", content: "A", open: true }], multiple: false });
generateDropdown({ parent: "wrapper", label: "Actions", items: [{ label: "Edit", onclick }, { divider: true }, { label: "Delete", onclick }] });
generatePagination({ parent: "wrapper", total: 200, pageSize: 10, onChange: page => load(page) });
generateBreadcrumbs({ parent: "wrapper", items: [{ label: "Home", href: "#/" }, { label: "Users" }] });
generateSidebar({ parent: "wrapper", active: "home", onSelect: item => go(item.id),
    items: [{ id: "home", label: "Home" }, { id: "reports", label: "Reports", children: [{ id: "daily", label: "Daily" }] }] });
```

Tabs, dropdown and the combobox inputs follow the WAI-ARIA keyboard patterns (arrow keys, Home / End, Esc).
The sidebar collapses behind a toggle button on small screens.

### Menus with submenus

```js
init({
    menuItems: {
        headerMenu: [
            { id: "menu-home", class: "menu-item", text: "", inner_text: "Home" },
            { id: "menu-more", class: "menu-item", text: "", inner_text: "More", children: [{ inner_text: "Reports" }, { inner_text: "Archive", disabled: true }] }
        ],
        footerMenu: []
    },
    nav: name => router.navigate(`/${name.toLowerCase()}`)   // called with the entry's inner_text
});
```

A submenu opens with a click, Enter, Space or the Down arrow, closes with Esc, a click outside or by choosing an entry,
and supports the arrow keys, Home and End. The same works in the footer menu.

### Router

```js
const router = createRouter({
    routes: {
        "/": () => renderHome(),
        "/users/:id": ({ params, query }) => renderUser(params.id),
        "/admin": { handler: renderAdmin, title: "Admin" }
    },
    outlet: "wrapper",                                     // emptied before every page
    beforeEach: ({ path }) => path === "/admin" && !isLoggedIn() ? "/login" : undefined,   // false cancels, a path redirects
    notFound: () => renderNotFound()
});
router.start();
router.navigate("/users/5?tab=info");
```

`mode: "history"` uses real paths instead of the hash, the server then has to answer every path with the page.
Pass `router.navigate` from your `nav` callback to route the menu clicks.

### Components

```js
const grid = generateGrid({ parent: "wrapper", columns: 3 });         // one column on small screens
generateStat({ parent: grid, label: "Revenue", value: "$12k", delta: 8.2 });
generateCard({ parent: grid, title: "Title", content: "Text or a Node", footer: "Footer", image: "a.jpg" });
generateBadge({ parent: "wrapper", text: "new", variant: "success", pill: true });
generateAvatar({ parent: "wrapper", name: "Ada Lovelace", src: "ada.png" });   // initials without a working image
generateTooltip(buttonElement, "Saves the form");
generateLink({ parent: "wrapper", text: "Docs", href: "https://example.com", external: true });
generateSection({ parent: "wrapper", title: "Section", level: 2, content: "..." });
```

`parent` is the id of an element or the element itself. String content is always inserted as text.

### Inputs

```js
generateAutocomplete({ parent: "wrapper", label: "Country", options: ["Hungary", "Italy"] });
generateAutocomplete({ parent: "wrapper", options: async query => fetchSuggestions(query), minChars: 2 });   // remote data
generateMultiSelect({ parent: "wrapper", options: [{ value: "h", text: "Hungary" }], value: ["h"] });         // getValue(): array
generateFileUpload({ parent: "wrapper", accept: ".png,.pdf", maxSize: 2 * 1024 * 1024, url: "/upload",
    onProgress: (file, percent) => {}, onComplete: (file, response) => {}, onError: (file, error) => {} });
generateStepper({ parent: "wrapper", onFinish: () => {}, steps: [
    { title: "Account", content: () => buildStep1(), validate: () => valid || "Fix the errors" },
    { title: "Done", content: "Finished" }
] });
```

```js
generateDateRange({ parent: "wrapper", label: "Stay", from: "2026-06-01", min: "2026-01-01", onChange: ({ from, to }) => {} });
const editor = generateRichText({ parent: "wrapper", label: "Description", placeholder: "Write...", value: "<p>Hello</p>",
    toolbar: ["bold", "italic", "|", "ul", "ol", "link"], onChange: html => {} });
editor.getValue();   // safe HTML, "" when empty
```

The date range uses the native date pickers; the end picker starts at the chosen start date and a reversed range typed by
hand is reported. The rich text editor produces a restricted set of HTML (paragraphs, headings, bold / italic / underline /
strike, lists, quotes, code, links). Everything else (scripts, styles, iframes, images, event attributes, `javascript:` and
`data:` links) is removed when the content is set, pasted, dropped and read, so the value is safe to store and show with
`innerHTML`; links get `rel="noopener noreferrer"`. Toolbar buttons: `bold`, `italic`, `underline`, `strike`, `h2`, `h3`,
`quote`, `ul`, `ol`, `link`, `unlink`, `clear`, `undo`, `redo`. The editor is built on `contenteditable` and
`document.execCommand`, which every browser still supports; sanitize on the server as well, as with any HTML you accept.

Files are sent as a multipart POST (`fieldName`, `headers` are configurable). Without `url` the files are only collected,
read them with `getFiles()`.

### Session

```js
login: async ({ username, password, remember }) => {
    const user = await api.login(username, password);
    setSession({ user, token: user.token, remember });   // a session cookie, or `session_days` days when remembered
    router.navigate("/");
}
isLoggedIn(); getSession(); logout();
onSessionChange(session => updateMenu(session));
```

The session lives in a cookie written from script, so any script of the page can read it. Keep only what the UI needs in it
and let the server enforce authorization; a server set `HttpOnly` cookie is the safer place for real credentials.

### Translations

```js
init({ config: { locale: "hu" } });       // English and Hungarian are included
setLocale("en");                          // switch at runtime, texts of new components follow
addMessages("de", { login: "Anmelden", "validation.required": "Pflichtfeld" });
translate("login");
```

Missing texts fall back to English. See `src/libs/core/i18n.js` for all keys.

### Usage from classic scripts

The same API is available as globals (and as `AthenaUI`), so scripts written for earlier versions
keep working. Load `athena-ui.js` with `type="module"` and call the globals after the DOM is ready:

```html
<script>
    var appConfig = { header_title_text: "My App", customLoader: "js/app.js" };
</script>
<script type="module" src="athena-ui/src/athena-ui.js"></script>
<script>
    $(function () {
        init({ theme: { id: 0 } });
    });
</script>
```

The global `appConfig`, `menuItems`, `nav`, `login`, `register` and `lostPassword` are used when the matching `init` option is
not given. `appConfig.athenaUIFolder` is not needed anymore, paths are resolved relative to
`athena-ui.js`.

## Themes

A theme is a single stylesheet. Register it in `src/res/themes/themes.js` and select it with
`theme: { id }`, or pass any stylesheet directly with `theme: { href: "css/my-theme.css" }`.
The default theme is in `src/res/themes/default/style.css`; `{ id: 1 }` is a dark theme. All colors are CSS variables
(`--athena-bg`, `--athena-fg`, `--athena-accent`, ...), so a custom theme can import the default one and override them:

```css
@import url("athena-ui/src/res/themes/default/style.css");
:root { --athena-accent: #8e44ad; }
```

Switch themes at runtime with `setTheme({ id: 1 })`.

## Tests

```sh
npm test              # unit tests of the pure modules, run in Node
npm run test:browser  # the components in headless Chrome
```

The unit tests cover validation, translations, router matching, CSV, pagination, formatting, virtual scrolling math, date ranges and the URL check.
The browser tests start a small static server, open `tests/browser/index.html` in headless Chrome, Chromium or Edge and run every
component: forms, dialogs, navigation, submenus, inputs, rich text (sanitizing, toolbar, paste), tables (resizing, virtual scrolling), router,
session, themes. Set `CHROME_PATH` if the browser is not found, and `JQUERY_URL` to load jQuery from somewhere else than the CDN
(the machine needs internet access otherwise). `DEBUG=1` prints the browser log when the page does not report results.

## Project structure

```
src/
  athena-ui.js              entry point, exports the whole API
  index.html, example.js    example page
  libs/
    config/                 default configuration, application hooks
    core/                   DOM / focus helpers, validation, translations, CSV, formatting, sanitizer, table math
    hephaestus/             script and theme loader, generators (layout, menu, forms, charts, tables, feedback,
                            dialogs, navigation, components, inputs), router, session
    crypto-js/, js-cookie/  submodules
    libs.js                 classic scripts loaded at runtime
  res/themes/               default and dark theme
tests/                      unit tests (Node) and browser tests (headless Chrome)
```

## Authors

* **Csaba Tóth** - *Initial work* - [csabatibortoth](https://github.com/csabatibortoth)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details

## Releases

 ### 1.0.0
  #### Added:
   1. Stable public API (semantic versioning from this release on)
   2. README: status, known limits and quick links
  #### Changed:
   1. Version bumped to 1.0.0, no breaking changes since 0.7.0

 ### 0.7.0
  #### Added:
   1. Menus with submenus: `children` on a menu item, with keyboard support
   2. Tables: resizable columns (mouse and keyboard) and virtual scrolling (`virtual`) for thousands of rows
   3. `generateDateRange` and the `daterange` form field
   4. `generateRichText` / `createRichText` and the `richtext` form field, with an allow-list sanitizer (`sanitizeHtml`, `isSafeUrl`)
   5. Browser tests in headless Chrome (`npm run test:browser`), more unit tests
  #### Changed:
   1. English and Hungarian texts for the new components

 ### 0.6.0
  #### Added:
   1. Form builder (`generateForm`, `generateField`, `generateButton`) with validation, textarea, select, radio / checkbox groups, switch, autocomplete and multi select
   2. Feedback: `showToast`, `generateAlert`, `generateSpinner`, `generateProgress`; dialogs: `alertDialog`, `confirmDialog`, `promptDialog`, `showDialog`
   3. Navigation: tabs, accordion, dropdown, sidebar, breadcrumbs, pagination; `createRouter`
   4. Components: card, grid, section, badge, avatar, stat, tooltip, link
   5. `generateFileUpload` with progress, `generateStepper`
   6. Tables: row selection, inline editing, CSV export
   7. Session handling, change password form, "Remember me" in the login form
   8. Dark theme, `setTheme`, CSS variables, responsive styles
   9. Translations (English, Hungarian), `translate`, `setLocale`, `addMessages`
   10. Unit tests (`npm test`)
  #### Changed:
   1. Modals trap the focus, close with Esc and restore the focus
   2. The texts of the forms and of the table go through `translate`; the registration form checks its fields with the shared validator
   3. `init` accepts the `changePassword` callback

 ### 0.5.0
  #### Added:
   1. `generateChart`: bar, line, pie and donut charts as inline SVG
   2. `generateTable`: sortable, filterable, paginated tables
   3. `generateRegistrationForm` and `generateLostPasswordForm`, with the `register` / `lostPassword` callbacks and the `registration_enabled` / `lost_password_enabled` settings
   4. Example page shows all of them

 ### 0.4.1
  #### Changed:
   1. HTMLControlGenerator v0.4.0, HTMLElementGenerator v0.3.0, js-cookie updated to the latest master
   2. HTMLElementGenerator is imported as an ES module instead of being loaded as a classic script
   3. crypto-js follows the `master` branch, which holds the built release files
  #### Added:
   1. `HTMLElementGenerator` is exported from `athena-ui.js` (and stays available as a global)
  #### Bugfix:
   1. The label of a menu item without an `id` is not appended to the page body

 ### 0.4.0
  #### Changed:
   1. Rewritten as ES modules (no more chained `$.getScript` loading, no implicit globals)
   2. JQuery v4.0.0, js-cookie v3.0.8, crypto-js v4.2.0
   3. Libraries and theme load in parallel, the layout is generated when all of them are ready
   4. Theme CSS merged into a single file
   5. `init()` returns a Promise and accepts `config`, `nav`, `login`, `menuItems`
  #### Bugfix:
   1. Theme option (`theme` / `themes`) is respected, unknown theme falls back to the default
   2. Menu class does not start with "undefined"
   3. Modal script does not fail when the page has no modal
   4. Login data is not written to the console

 ### 0.3.6
  #### Added
   1. submodule update

 ### 0.3.4
  #### Added:
   1. support for custom JS loading
  #### Bugfix:
   1. Theme name fix

 ### 0.3.3
  #### Added:
   1. Modal support

 ### 0.3.2
  #### Added:
  1. title change
  2. copyright text change

 ### 0.3.1
  #### Added:
  1. Header element container added

 ### 0.3.0
  #### Added:
   1. Navigation Function call for menu

 ### 0.2.9
  #### Bugfix:
   1. Login form generation bugfix 2

 ### 0.2.8
  #### Bugfix:
   1. Login form generation bugfix

 ### 0.2.7
 #### Added:
  1. Basic layout div clear functions

 ### 0.2.6
 #### Added:
  1. Header Logo
  2. Updated Submodules

 ### 0.2.5
 #### Added
  1. JS-Cookie

 ### 0.2.4
 #### Added
  1. Crypto-JS
  2. Password encryption support

 #### Bugfixes
  1. Login form generation

 ### 0.2.3
 #### Bugfixes
  1. Bugfixes on login form generation

 ### 0.2.2
 #### Added:
  1. Login Form generation

 #### Bugfix:
  1. Config loading error fixed

 ### 0.2.1
 #### Bugfix:
  1. Some bugfixes on element generation

 ### 0.2.0
 #### Added:
  1. Element generation from external configuration

 ### 0.1.1
 #### Added:
  1. Fixes

 ### 0.1.0
 #### Added:
  1. basic html layout generation
  2. header generation
  3. footer generation
 
