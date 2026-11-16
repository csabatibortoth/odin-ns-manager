# Plugins

A plugin is a folder in the plugins folder of the server (`plugins` by default,
`ODIN_PLUGINS_FOLDER`). It runs when its name is in the setting *Plugins that
run* (`ODIN_PLUGINS_ENABLED`); a change needs a restart.

> A plugin is code that runs with the rights of the server, in its process.
> There is no sandbox. Enable only plugins whose code you have read.

```
plugins/my-plugin/
    plugin.json     the description
    index.js        exports activate(api), and optionally deactivate()
    public/ui.js    optional: the page of the plugin in the menu
    data/           created for the plugin, to keep its files in (not in git)
```

## plugin.json

```json
{
    "name": "my-plugin",
    "version": "1.0.0",
    "description": "What it does",
    "main": "index.js",
    "roles": ["admin"],
    "ui": { "label": "My plugin", "script": "ui.js", "group": "Plugins" }
}
```

| Field | |
| --- | --- |
| `name` | Has to be the name of the folder: letters, digits, `_` and `-` |
| `main` | The script, inside the folder. Default `index.js` |
| `roles` | Who may use the routes and the page: `admin`, `user`. Default `["admin"]` |
| `ui` | Optional. A menu entry; `script` is a file of `public/` |

## index.js

```js
exports.activate = async (api) => {
    api.router.get('/hello', (req, res) => res.json({ hello: req.user.username }));
    api.on('dnsChange', () => api.log.info('The DNS data changed'));
    api.every(60, () => { /* every minute */ });
};

exports.deactivate = async () => { /* optional: the server stops */ };
```

If `activate` throws, the plugin is marked failed (see the Plugins page) and the
others keep running. An error in a handler or a job is logged and does not stop
the server.

### The api

| | |
| --- | --- |
| `api.name`, `api.version` | From `plugin.json` |
| `api.server` | `{ name, company, version }` of the server |
| `api.folder`, `api.dataFolder` | The folder of the plugin, and one to keep files in |
| `api.log.info(...)`, `api.log.error(...)` | Write to the log of the server, with the name of the plugin |
| `api.router` | An express router, at `/api/plugins/<name>`. Signed in users of the `roles` only; `req.user` is `{ id, username, role }`. JSON bodies are read |
| `api.on(event, handler)` | `dnsChange`: a zone, record or the blocking was changed through the API. `sync`: a synchronization imported something (gets its report) |
| `api.every(seconds, handler)` | A job, stopped when the server stops |
| `api.mail.configured()` | Is e-mail set up? |
| `api.mail.send({ to, subject, text })` | Sends a mail; rejects when it can not be sent |
| `api.mail.notify(subject, text)` | Mails the addresses of *Notify these addresses*. Never rejects |

## The page

The files of `public/` are served at `/plugins/<name>/`, without a sign in, so
keep nothing secret in them; the data comes from the routes of the plugin.

```js
// public/ui.js
export async function render($page, { api, session, ui }) {
    const data = await api('GET', '/plugins/my-plugin/hello');
    $page.append(ui.head('My plugin'), ui.card('Hello', [['User', data.hello]]));
}
```

`$page` is a jQuery element. `api(method, path, { query, body })` calls `/api/<path>` with the
token of the user. `ui` holds the building blocks of the interface: `el`,
`button`, `table`, `card`, `head`, `badge`, `notice`, `formDialog`, `confirmDialog`,
`formatDate` and the others exported by `ui/js/ui.js`.

## Example

`plugins/example` uses all of the above. Add `example` to the plugins that run.
