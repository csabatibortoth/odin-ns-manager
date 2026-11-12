# Athena UI

A small jQuery based UI framework for development and education purposes. It generates a page
layout (header, menu, content wrapper, footer), a login form and modal support from a single
`init()` call, and loads its own libraries and theme.

Current version: **0.4.1**

## Features

- Generated page layout: container, header (logo, title, menu), wrapper, footer (menu, copyright text)
- Menus built from your own item lists, with a navigation callback
- Login form with optional SHA-256 password hashing
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

### Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `header_title_text` | `"Athena UI"` | Title in the header |
| `header_img_url` | | Header logo URL |
| `copyright` | placeholder text | Footer text, the version is appended |
| `version` | `"0.4.1"` | Version shown in the footer |
| `bordered` | `true` | Draw a border around the layout blocks |
| `generateHeader`, `generateFooter` | `true` | Generate the header / footer block |
| `generateHeadercontent`, `generateFooterContent`, `generateWrappercontent` | `true` | Generate the content of the block |
| `login_enabled` | `false` | Call the `login` callback from the login form |
| `enable_encrypt_password` | `false` | SHA-256 hash the password before it is passed to `login` |
| `customLoader` | | URL of an extra classic script, loaded before the layout is generated |
| `container_class`, `header_class`, `header_menu_class`, `wrapper_class`, `footer_class`, `footer_menu_class`, `loginForm_class` | | CSS classes of the generated blocks |

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
| `openModal(id)`, `closeModal(id)` | Show / hide a `.modal` element (default id: `myModal`). Elements with the `close` class close their modal. |
| `loadScript(src)` | Load a classic script once, returns a Promise |
| `Cookies` | The [js-cookie](https://github.com/js-cookie/js-cookie) API |
| `HTMLElementGenerator(options)` | The [HTMLElementGenerator](https://github.com/csabatibortoth/HTMLElementGenerator) function |

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

The global `appConfig`, `menuItems`, `nav` and `login` are used when the matching `init` option is
not given. `appConfig.athenaUIFolder` is not needed anymore, paths are resolved relative to
`athena-ui.js`.

## Themes

A theme is a single stylesheet. Register it in `src/res/themes/themes.js` and select it with
`theme: { id }`, or pass any stylesheet directly with `theme: { href: "css/my-theme.css" }`.
The default theme is in `src/res/themes/default/style.css`.

## Project structure

```
src/
  athena-ui.js              entry point, exports the whole API
  index.html, example.js    example page
  libs/
    config/                 default configuration, application hooks
    hephaestus/             script and theme loader, layout / menu / form / modal generators
    crypto-js/, js-cookie/  submodules
    libs.js                 classic scripts loaded at runtime
  res/themes/               themes
```

## Authors

* **Csaba Tóth** - *Initial work* - [csabatibortoth](https://github.com/csabatibortoth)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details

## Releases

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
 
