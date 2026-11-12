# odin-ns-manager

The manager service of the Odin name server stack. It runs the DNS server, the
management API, its user interface and the DNS client side in one process. The
zones and records that are managed in the browser or through the API are stored
in MongoDB, and answered by the DNS server.

Current version: **2.2.0** - see the [release notes](#release-notes).

![The dashboard of the manager](docs/screenshots/dashboard.png)

It brings four packages together:

| Package | Role in the manager |
| --- | --- |
| [njord-ns-server](https://github.com/csabatibortoth/njord-ns-server) | The DNS server: answers queries over UDP and TCP, and looks up unknown names at upstream DNS servers. Its record classes and validators are what the zones are built of |
| [freya-ns-api](https://github.com/csabatibortoth/freya-ns-api) | The management API: zones and records, users, authentication, logging and the MongoDB connection |
| [bragi-ns-client](https://github.com/csabatibortoth/bragi-ns-client) | The DNS client: a cached replacement of `dns.lookup` for outgoing connections |
| [athena-ui-js](https://github.com/csabatibortoth/athena-ui) | The user interface: page layout, menu, login form and dialogs |

## Status

| Area | Status |
| --- | --- |
| DNS server over UDP and TCP | Available |
| Forwarding of unknown names to upstream DNS servers | Available |
| In-memory cache of answers | Available |
| Management API: users and authentication | Available |
| Zones and records stored in MongoDB, answered from memory | Available |
| Management of zones and records through the API | Available |
| Standalone records: single names without a zone | Available |
| Blocklists: names that are not looked up, from lists such as hosts files | Available |
| Settings changed by the admins in the browser | Available |
| Graphs of the queries, the answer time, the memory and the cache | Available |
| Zone transfers (AXFR) to secondary servers | Planned |
| User interface in the browser | Available |

A query for a name of one of its own zones is answered by the server itself;
every other query is forwarded to the upstream DNS servers. The zones, the users
and the service itself are managed in the browser, or through the API.

## Requirements

- Node.js 22 or newer
- A MongoDB server the manager can reach, for the management API and the zones.
  Without it the DNS server runs as a forwarder only.

## Getting started

```
npm install
npm start        # or: npm run dev, which restarts on every change
```

By default the DNS server listens on `127.0.0.1:53` (UDP and TCP), and the
user interface and the management API on `http://localhost:45451`, with MongoDB
at `127.0.0.1:27017`.

Port 53 usually needs administrator rights and may be in use already. To try
the server on another port:

```
ODIN_NS_PORT=5300 npm start
nslookup -port=5300 example.com 127.0.0.1
```

When MongoDB is not reachable at the start, the error is logged and the DNS
server keeps running as a forwarder: no zones are served and the management API
is not started until the next start.

On the first start, when there are no users yet, an admin account named `admin`
is created. Set `FREYA_ADMIN_PWD` beforehand to choose its password; otherwise a
random password is printed once to the console. Open `http://localhost:45451`,
sign in with it, and change it on the **Account** page.

Without the browser, three requests put a name on the air: log in, create a zone, and add
a record to it.

```
curl -X POST http://localhost:45451/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<password>"}'

curl -X POST http://localhost:45451/api/zones \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name":"example.test","soa":{"host":"ns1.example.test"}}'

curl -X POST http://localhost:45451/api/zones/<zoneId>/records \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name":"www","type":"A","data":{"target":"192.0.2.1"}}'

nslookup www.example.test 127.0.0.1
```

The first answer holds the `token`, the second the `id` of the zone.

## Configuration

Defaults live in `config/config.js`. Every value can be overridden with an
environment variable, so secrets do not have to be stored in the file.

Admins can also change most of the settings in the browser, on the
[Settings](#settings) page. The value of a setting is, in this order: its
environment variable, what was saved in the browser, its default.

### General

| Variable | Default | Purpose |
| --- | --- | --- |
| `ODIN_TYPE` | `DEV` | Environment type. Queries are printed to the console in `DEV`. Anything else requires a private `ODIN_SECRET` |
| `ODIN_SECRET` | `Test` | Key used to sign the login tokens of the API |
| `ODIN_SERVER_NAME` / `ODIN_COMPANY_NAME` | `odin-ns-manager-1` / `YourCompany` | Shown in the welcome message of the API |
| `ODIN_LOGGING_ENABLED` / `ODIN_LOG_FOLDER` | `true` / `C:\Temp\Odin\Logs` | File logging |

### DNS server

| Variable | Default | Purpose |
| --- | --- | --- |
| `ODIN_NS_ADDRESS` / `ODIN_NS_PORT` | `127.0.0.1` / `53` | Where the DNS server listens |
| `ODIN_NS_TCP_ENABLED` | `true` | Listen on TCP next to UDP |
| `ODIN_NS_ZONES_ENABLED` | `true` | Answer the zones and records of the database. Set to `false` to forward every query |
| `ODIN_NS_ZONE_REFRESH` | `10` | Seconds between two checks of the database for changed zones |
| `ODIN_NS_UPSTREAM` | `1.1.1.1,1.0.0.1` | Comma separated DNS servers that are asked for unknown names. Empty means the DNS servers of the system |
| `ODIN_NS_UPSTREAM_TIMEOUT` / `ODIN_NS_UPSTREAM_TRIES` | `2000` / `2` | Milliseconds to wait for an upstream answer, and the number of attempts |
| `ODIN_NS_CACHE_ENABLED` | `true` | Keep answers in memory |
| `ODIN_NS_CACHE_MAX_ENTRIES` | `10000` | Size of the cache; the oldest entry is dropped when it is full |
| `ODIN_NS_NEGATIVE_CACHE_TTL` | `30` | Seconds a "no such name" or "no such record" answer is kept |
| `ODIN_NS_BLOCKING_ENABLED` | `true` | Block the names of the [blocklists](#blocklists) |
| `ODIN_NS_BLOCK_MODE` | `null` | The answer for a blocked name: `null` for the address `0.0.0.0`, `nxdomain` for "no such name" |
| `ODIN_NS_BLOCKLIST_REFRESH` | `24` | Hours between two downloads of a blocklist |

### Management API

| Variable | Default | Purpose |
| --- | --- | --- |
| `ODIN_API_ENABLED` | `true` | Start the management API. Set to `false` to run the DNS server only; the zones of the database are still served |
| `ODIN_HTTP_ENABLED` / `ODIN_HTTP_PORT` | `true` / `45451` | Plain HTTP listener |
| `ODIN_HTTPS_ENABLED` / `ODIN_HTTPS_PORT` | `false` / `45452` | HTTPS listener; takes precedence over HTTP when enabled |
| `ODIN_AUTH_ENABLED` | `true` | Set to `false` to skip token checks. For local development only |
| `ODIN_UI_ENABLED` | `true` | Serve the user interface next to the API |
| `ODIN_DNS_WRITE_ROLES` | `admin` | Roles that may change zones and records, comma separated, e.g. `admin,user`. Every signed-in user may read them |
| `ODIN_DB_ADDRESS` / `ODIN_DB_PORT` / `ODIN_DB_NAME` | `127.0.0.1` / `27017` / `odin-ns-manager-1` | MongoDB location |
| `ODIN_DB_USER` / `ODIN_DB_PWD` | `Test` / `Test` | MongoDB credentials; set the user to an empty value to connect without authentication |

These settings are handed to freya-ns-api as its own `FREYA_*` variables. A
`FREYA_*` variable that is set explicitly wins, and is also the way to reach
the settings that have no `ODIN_*` counterpart, such as `FREYA_DB_URI`,
`FREYA_TOKEN_EXPIRES_IN`, `FREYA_HTTPS_KEY` / `FREYA_HTTPS_CERT` and
`FREYA_ADMIN_USER` / `FREYA_ADMIN_EMAIL` / `FREYA_ADMIN_PWD`. See the
[freya-ns-api documentation](https://github.com/csabatibortoth/freya-ns-api#configuration).

### Settings

The Settings page of the user interface shows every setting with its value and
where the value comes from, and lets the admins change them. What is saved
there is written to `config/settings.json` (`ODIN_SETTINGS_FILE` names another
file), which is not part of the repository.

- **At once** – the name of the server and the company, the upstream servers
  with their timeout and attempts, the cache, the blocking, and the time
  between two checks of the database change while the server runs. A change of the upstream
  empties the cache.
- **After a restart** – the addresses, ports and listeners, the roles, logging
  and the environment type are saved, and take effect at the next start. The
  page shows the saved value next to the one the server still runs with.
- **Fixed by the environment** – a setting that has its environment variable
  set can not be changed in the browser.
- **Not in the browser** – `ODIN_SECRET`, the database connection,
  `ODIN_API_ENABLED` and `ODIN_UI_ENABLED` are only set in the environment.
  Changes that would lock everybody out are refused: switching both HTTP and
  HTTPS off, or leaving `DEV` with the default secret.

Every change is written to the security log, with the name of the admin.

![The settings of the DNS server and of the forwarding](docs/screenshots/settings.png)

### Build number

The footer of the user interface and the dashboard show the build next to the
version: the number of commits of the repository, and its last commit. An
installation that is deployed without its git repository takes them from
`build.json`, which `npm run build-info` writes before the deployment, or from
`ODIN_BUILD_NUMBER`, `ODIN_BUILD_COMMIT` and `ODIN_BUILD_DATE`.

![The build on the dashboard and in the footer](docs/screenshots/dashboard-state.png)

## DNS server

### Own zones

A query for a name that is in one of the active zones of the database is
answered by the server itself, as an authoritative answer, and is never sent to
the upstream. When zones overlap, the one with the longest matching name
answers: `www.sub.example.com` belongs to `sub.example.com` when that zone
exists, and to `example.com` otherwise.

- **Records** – the active A, AAAA, CNAME, MX, NS, PTR, SRV and TXT records of
  the name, with their own TTL or the TTL of the zone, and the SOA record of the
  zone itself.
- **Aliases** – a CNAME record is answered together with the records of its
  target, which are looked up in the zones, or at the upstream when the target
  is outside of them.
- **Wildcards** – a `*` record stands for the names below it that do not exist.
- **No such name** – a name that is not in the zone is answered with "no such
  name"; a name that exists without records of the asked type gets an empty
  answer.
- **Inactive** zones and records are not served. The names of an inactive zone
  are forwarded to the upstream like any other name.

The zones are kept in memory, so a query never waits for the database. A change
that is made through the API of this process is served as soon as the request
is done. Changes that are made elsewhere, such as by another manager on the same
database, are noticed by the serial of the zone, within `ODIN_NS_ZONE_REFRESH`
seconds. When the database can not be read, the zones in memory are served on.

Zone transfers (AXFR) are refused, and responses have no authority section yet.

### Standalone records

A record does not need a zone: a standalone record is a single name the server
answers itself, such as `nas.home.example A 10.0.0.5`, without a SOA record
and name servers around it. They are for the names of a local network, and for
giving a name of somebody else another answer on this server.

- **The name is answered whole** – a name with standalone records is not
  forwarded any more, also not for the types it has no record of: those get an
  empty answer. The names around it are forwarded as before.
- **Types, aliases, TTL** – the same record types as in a zone. A CNAME is
  answered together with the records of its target. Every record has its own
  TTL, 3600 seconds by default.
- **Wildcards** – `*.dev.example` stands for every name below `dev.example`
  that has no standalone records of its own.
- **Zones come first** – a name inside one of the zones belongs to the zone,
  and the API refuses a standalone record for it.

They are kept in memory and refreshed together with the zones.

![The standalone records](docs/screenshots/records.png)

### Blocklists

A blocklist is a list of names the server does not look up: advertising,
trackers, malware. It is given by its address, such as
`https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts`, on the
Blocklists page or through `/api/blocklists`. The server downloads it, keeps
its names in MongoDB, and answers them from memory.

- **Formats** – the lines of a hosts file (`0.0.0.0 ads.example.com`), plain
  names, and the `||ads.example.com^` lines of the filter lists of ad
  blockers. The names a hosts file has for the machine itself, such as
  `localhost`, are left out.
- **The answer** – a blocked name gets the address `0.0.0.0` (`::` for AAAA,
  and an empty answer for the other types), or "no such name" with
  `ODIN_NS_BLOCK_MODE=nxdomain`. It is not sent to the upstream.
- **Exact names** – a hosts file names every name itself, so only the names of
  the list are blocked. A list can be set to block the names below its names as
  well.
- **Allowed names** – a name that is allowed, and every name below it, is
  looked up even when a list blocks it.
- **Own names come first** – the names of the zones and the standalone records
  are never blocked.
- **Refresh** – a list is downloaded again every `ODIN_NS_BLOCKLIST_REFRESH`
  hours, and on request. When a download fails, the names of the last one stay
  in use, the reason is shown with the list, and it is tried again 15 minutes
  later.

Only admins add and change the lists, as the server downloads from the
addresses they give. A download is limited to 64 MB.

### Forwarding

Every other query is answered with the records the upstream DNS servers have
for it. The A, AAAA, CNAME, MX, NS, PTR, SOA, SRV and TXT records can be looked
up; a query for another type is answered with "not implemented".

- **Cache** – an answer is kept in memory until its TTL runs out, and is sent
  with the TTL that is left of it. The upstream only reports the TTL of A and
  AAAA records; the other records are kept for 60 seconds.
- **Negative cache** – names and records that do not exist are remembered for
  `ODIN_NS_NEGATIVE_CACHE_TTL` seconds. Timeouts and other failures are not.
- **One lookup per name** – queries for the same name and type that arrive
  while a lookup is in flight wait for that lookup instead of sending their own.

The cache lives in the memory of the process and is empty after a restart. It
is only for the answers of the upstream; the own zones are not in it.

## User interface

The user interface is served by the HTTP(S) server of the management API, at
`http://localhost:45451` by default, and works with the same accounts. It is
built on [Athena UI](https://github.com/csabatibortoth/athena-ui) and jQuery,
which are served from their packages: the page loads nothing from other servers.
It follows the light or dark mode of the system.

| Page | Who | What it does |
| --- | --- | --- |
| Dashboard | signed in | Graphs of the queries per minute, the answer time, the memory and the cache, over the last 15 minutes to 24 hours; and the state of the service, the DNS server, the zones and the upstream servers. Admins can reload the zones and clear the cache |
| Zones | signed in | List and search the zones; add, edit and delete them |
| *a zone* | signed in | The SOA record and the records of a zone; add, edit and delete records |
| Records | signed in | The standalone records, which belong to no zone; add, edit and delete them |
| Blocklists | signed in | The blocklists with their state, and the allowed names. Admins add, update and delete them |
| Lookup | signed in | Asks the DNS server for a name, and shows where the answer came from: a zone, the standalone records, a blocklist or the upstream |
| Users | admin | List, add, edit and delete users, and set their passwords |
| Logs | admin | The general, error and security log of a day |
| Settings | admin | The configuration of the server; see [Settings](#settings) |
| Account | signed in | Your own account: display name, e-mail and password, and for admins the username. Also reached by the name at the top of the page |

Zones and records can be changed by the roles in `ODIN_DNS_WRITE_ROLES`; the
other users see them read-only.

The history behind the graphs is kept in memory: a sample every 10 seconds for
the last hour, and one per minute for the last day. It starts empty after a
restart. Every graph has its values as a table below it.

![The values of a graph, at the pointer and as a table](docs/screenshots/dashboard-graph.png)

### Screenshots

The screenshots are of a demo installation with sample zones and records, and generated queries.

| | |
| --- | --- |
| ![Sign in](docs/screenshots/login.png) **Sign in** | ![Dashboard](docs/screenshots/dashboard.png) **Dashboard**: figures and graphs of the chosen period |
| ![The values of a graph](docs/screenshots/dashboard-graph.png) **A graph**: the values at the pointer, and all of them as a table | ![The state of the service](docs/screenshots/dashboard-state.png) **Dashboard**, further down: the state of the service, with its build |
| ![Zones](docs/screenshots/zones.png) **Zones** | ![The records of a zone](docs/screenshots/zone-records.png) **The records of a zone** |
| ![Adding a record](docs/screenshots/add-record.png) **Adding a record**: the fields follow the type | ![A record that is not valid](docs/screenshots/record-validation.png) **A value that is not valid** is marked at its field |
| ![The record is added](docs/screenshots/record-added.png) **Saved**: the serial of the zone is raised | ![Lookup](docs/screenshots/lookup.png) **Lookup**, answered from an own zone |
| ![Standalone records](docs/screenshots/records.png) **Records**: the standalone records, without a zone | ![Adding a standalone record](docs/screenshots/add-standalone-record.png) **Adding a standalone record**, with its whole name |
| ![Settings](docs/screenshots/settings.png) **Settings**: where a value comes from, and when a change applies | ![Editing settings](docs/screenshots/settings-edit.png) **Editing the settings** of a group |
| ![Users](docs/screenshots/users.png) **Users** | ![Account](docs/screenshots/account.png) **Account**: the profile and the password of the signed-in user |
| ![Logs](docs/screenshots/logs.png) **Logs** | ![Dark mode](docs/screenshots/zones-dark.png) **Dark mode** |
| ![The dashboard in dark mode](docs/screenshots/dashboard-dark.png) **Dashboard** in dark mode |  |

## Management API

All paths are under `/api`. Requests and responses are JSON. After logging in,
send the token with every request as `Authorization: Bearer <token>`.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/` | anyone | Welcome message |
| POST | `/auth/login` | anyone | `{ username, password }` returns a token |
| GET | `/auth/me` | signed in | The current user |
| POST | `/auth/logout` | signed in | Revokes every token of the current user |
| GET, POST | `/users` | admin | List and create users |
| GET, PATCH, DELETE | `/users/:id` | admin or self | Read, update and delete a user |
| PUT | `/users/:id/password` | admin or self | Change a password |
| GET, POST | `/zones` | signed in, admin | List and create zones: `{ name, soa: { host, ... }, ttl?, active? }` |
| GET, PATCH, DELETE | `/zones/:zoneId` | signed in, admin | Read, update and delete a zone. Deleting a zone deletes its records |
| GET, POST | `/zones/:zoneId/records` | signed in, admin | List and create records: `{ name, type, data, ttl?, active? }` |
| GET, PATCH, DELETE | `/zones/:zoneId/records/:recordId` | signed in, admin | Read, update and delete a record |

Zones and records can be read by every signed-in user, and changed by the roles
in `ODIN_DNS_WRITE_ROLES`. The SOA record of a zone and its serial are kept by
the API; the serial is raised on every change.

```
curl -X POST http://localhost:45451/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<password>"}'
```

These endpoints are the ones of freya-ns-api; see its
[documentation](https://github.com/csabatibortoth/freya-ns-api#api) for the
details of every endpoint.

The manager adds these, for the standalone records, the blocklists and the service itself:

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET, POST | `/records` | signed in, admin | List and create standalone records: `{ name, type, data, ttl?, active? }`, with a fully qualified name |
| GET, PATCH, DELETE | `/records/:recordId` | signed in, admin | Read, update and delete a standalone record |
| GET, POST | `/blocklists` | signed in, admin | List and create blocklists: `{ name, url, subdomains?, active? }`. A new list is downloaded at once |
| GET, PATCH, DELETE | `/blocklists/:listId` | signed in, admin | Read, update and delete a blocklist |
| POST | `/blocklists/:listId/update` | admin | Downloads the list now |
| GET, POST | `/blocklists/allowed` | signed in, admin | List and add allowed names: `{ name, note? }` |
| DELETE | `/blocklists/allowed/:allowedId` | admin | Removes an allowed name |
| GET | `/service/info` | anyone | Name, version and build, and whether signing in is needed |
| GET | `/service/status` | signed in | The state of the service, the DNS server, the zones and the cache |
| GET | `/service/metrics?range=` | signed in | The history of the queries, the answer time, the memory and the cache: `15m`, `1h`, `6h` or `24h` |
| GET | `/service/config` | admin | Every setting, with its value and where it comes from |
| PATCH | `/service/config` | admin | Changes settings: `{ key: value }`; `null` brings a setting back to its default |
| GET | `/service/lookup?name=&type=` | signed in | Asks the DNS server of the manager for a name |
| POST | `/service/zones/reload` | admin | Reads the zones from the database now |
| POST | `/service/cache/clear` | admin | Empties the cache of upstream answers |
| GET | `/service/logs?target=&date=&lines=` | admin | The end of a log file: `log`, `error` or `security`, of a day written as `YYYY-MM-DD` |

## Logs

When logging is enabled, three files are written per day to the log folder:
`log-<date>.log` (general), `error-<date>.log` (failures) and
`security-<date>.log` (logins and every change to a user). Changes to zones and
records, and every (re)load of the zones by the DNS server, are written to the
general log.

## Tests

```
npm test
```

The tests ask a DNS server on a local port for the names of zones, standalone
records and blocklists that are held in memory, and change the settings in a
temporary file; they need no database.

## Project layout

| Path | Contents |
| --- | --- |
| `server.js` | Entry point: starts the DNS server, the management API and the user interface |
| `config/` | Configuration: the settings, their defaults, and the file the admins save them to |
| `model/mongoDB/standaloneRecordModel.js` | The standalone records in MongoDB |
| `model/mongoDB/blocklistModel.js` | The blocklists and the allowed names in MongoDB |
| `services/serverService/blockService.js` | The blocklists: downloading, loading from MongoDB and answering from memory |
| `services/serverService/zoneService.js` | The own zones and standalone records: loading from MongoDB and answering from memory |
| `services/serverService/searchService.js` | Upstream lookups and the in-memory cache |
| `services/serverService/statusService.js` | Counters of the DNS server and their history, for the dashboard |
| `services/serverService/buildInfo.js` | The build number of the running server |
| `services/apiService/apiService.js` | Database connection, start and stop of the management API, logging |
| `services/apiService/serviceRoutes.js` | The `/api/service` endpoints |
| `services/apiService/recordRoutes.js` | The `/api/records` endpoints of the standalone records |
| `services/apiService/blocklistRoutes.js` | The `/api/blocklists` endpoints |
| `services/uiService/uiService.js` | Serves the user interface |
| `ui/` | The user interface: page, theme and scripts |
| `docs/screenshots/` | Screenshots of the user interface |
| `test/` | Tests |

## Release notes

### Unreleased

#### Added

- **Standalone records.** DNS records that belong to no zone: single names
  the server answers itself. Managed on the new Records page and through
  `/api/records`. See [Standalone records](#standalone-records).
- **Blocklists.** Lists of names that are not looked up, downloaded from
  their address: hosts files such as the one of StevenBlack, lists of names,
  and filter lists. With allowed names for the exceptions, a "Blocked" series
  on the dashboard, and the settings `ODIN_NS_BLOCKING_ENABLED`,
  `ODIN_NS_BLOCK_MODE` and `ODIN_NS_BLOCKLIST_REFRESH`. See
  [Blocklists](#blocklists).
- **Settings page.** Admins change the configuration of the server in the
  browser. The settings of the upstream, the cache and the refresh of the zones
  apply at once; the others after a restart. See [Settings](#settings).
- **Graphs on the dashboard.** The Status page is now the Dashboard, with the
  queries per minute, the average answer time, the memory and the cached
  answers of the last 15 minutes to 24 hours, kept up to date while it is open.
- **Build number** in the footer and on the dashboard. See
  [Build number](#build-number).
- **Account page** with the profile and the password as forms on the page.
  Admins can change their own username; the name at the top of the page leads
  to it.
- **Service endpoints:** `/api/service/metrics` and `/api/service/config`.

#### Changed

- The saved settings are read from `config/settings.json`, after the
  environment and before the defaults.
- A name with a standalone record is no longer forwarded.
- The database is also connected when only the blocking needs it.
- The address of the first page is `#/dashboard`; `#/status` leads there.

### 2.2.0

#### Added

- **Own zones.** The DNS server answers the names of the active zones and
  records in MongoDB itself, as authoritative answers: every record type of the
  API, the SOA record, CNAME chains, wildcard records, and "no such name" for
  the names that do not exist in a zone. Every other name is forwarded, as
  before. See [Own zones](#own-zones).
- **Zones kept in memory.** A query never waits for the database. A change made
  through the API is served when the request is done; other changes are picked
  up by the serial of the zone within `ODIN_NS_ZONE_REFRESH` seconds. When the
  database can not be read, the zones in memory are served on.
- **Management of zones and records** through the API (`/api/zones`), from
  freya-ns-api 2.2.0.
- **User interface** in the browser, built on athena-ui-js and jQuery: status,
  zones and records, lookup, users, logs and account. See
  [User interface](#user-interface).
- **Service endpoints** under `/api/service`: info, status, lookup, zone reload,
  cache clear and logs.
- **Settings:** `ODIN_NS_ZONES_ENABLED`, `ODIN_NS_ZONE_REFRESH`,
  `ODIN_DNS_WRITE_ROLES` and `ODIN_UI_ENABLED`.
- **Tests:** `npm test` checks the answers of the own zones over a real DNS
  server on a local port.

#### Changed

- freya-ns-api 2.0.0 → 2.2.0. New dependencies: athena-ui-js 0.4.1 and jQuery
  4.0.0. njord-ns-server is pinned to the npm registry with an `overrides`
  entry, as freya-ns-api asks for it from GitHub.
- The database is connected once at the start, for the zones and the API
  together. When it can not be reached, the DNS server runs as a forwarder only.
  The database is also used when `ODIN_API_ENABLED` is `false`, unless
  `ODIN_NS_ZONES_ENABLED` is `false` too.

#### Upgrading from 2.0.0

- No data has to be migrated: the `zones` and `records` collections and their
  indexes are created on the first start.
- The user interface is served on the port of the API by default. Set
  `ODIN_UI_ENABLED=false` to keep the API only.
- Names of an active zone are no longer forwarded. A zone that is created for a
  name that also exists elsewhere takes it over on this server; mark the zone
  inactive to forward its names again.

#### Not yet included

- Zone transfers (AXFR) are refused, and responses have no authority section.

### 2.0.0

- All packages updated; Node.js 22 or newer.
- freya-ns-api 2.0.0 as the management API: users, authentication, logging and
  the MongoDB connection.
- Unknown names forwarded to upstream DNS servers, with an in-memory cache of
  the answers, a negative cache, and one lookup per name and type.
- Every setting can be overridden with an `ODIN_*` environment variable.

## License

MIT
