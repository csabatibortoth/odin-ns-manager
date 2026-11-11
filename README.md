# odin-ns-manager

The manager service of the Odin name server stack. It runs the DNS server, the
management API and the DNS client side in one process, and is the place where
the NS records of the server are kept.

It brings three packages together:

| Package | Role in the manager |
| --- | --- |
| [njord-ns-server](https://github.com/csabatibortoth/njord-ns-server) | The DNS server: answers queries over UDP and TCP, and looks up unknown names at upstream DNS servers |
| [freya-ns-api](https://github.com/csabatibortoth/freya-ns-api) | The management API: users, authentication, logging and the MongoDB connection |
| [bragi-ns-client](https://github.com/csabatibortoth/bragi-ns-client) | The DNS client: a cached replacement of `dns.lookup` for outgoing connections |

## Status

| Area | Status |
| --- | --- |
| DNS server over UDP and TCP | Available |
| Forwarding of unknown names to upstream DNS servers | Available |
| In-memory cache of answers | Available |
| Management API: users and authentication | Available |
| NS records stored in MongoDB | Planned |
| Management of zones and records through the API | Planned |
| GUI for users | Planned |

Today every query is answered by forwarding it to the upstream DNS servers.
Records of its own, stored in MongoDB and served from the in-memory cache, and
a GUI to manage them, are the next parts of this project.

## Requirements

- Node.js 22 or newer
- A MongoDB server the manager can reach, for the management API. The DNS
  server runs without it.

## Getting started

```
npm install
npm start        # or: npm run dev, which restarts on every change
```

By default the DNS server listens on `127.0.0.1:53` (UDP and TCP), and the
management API on `http://localhost:45451`, with MongoDB at `127.0.0.1:27017`.

Port 53 usually needs administrator rights and may be in use already. To try
the server on another port:

```
ODIN_NS_PORT=5300 npm start
nslookup -port=5300 example.com 127.0.0.1
```

When the management API can not start, for example because MongoDB is not
reachable, the error is logged and the DNS server keeps running.

On the first start, when there are no users yet, an admin account named `admin`
is created. Set `FREYA_ADMIN_PWD` beforehand to choose its password; otherwise a
random password is printed once to the console. Sign in with it and change it.

## Configuration

Defaults live in `config/config.js`. Every value can be overridden with an
environment variable, so secrets do not have to be stored in the file.

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
| `ODIN_NS_UPSTREAM` | `1.1.1.1,1.0.0.1` | Comma separated DNS servers that are asked for unknown names. Empty means the DNS servers of the system |
| `ODIN_NS_UPSTREAM_TIMEOUT` / `ODIN_NS_UPSTREAM_TRIES` | `2000` / `2` | Milliseconds to wait for an upstream answer, and the number of attempts |
| `ODIN_NS_CACHE_ENABLED` | `true` | Keep answers in memory |
| `ODIN_NS_CACHE_MAX_ENTRIES` | `10000` | Size of the cache; the oldest entry is dropped when it is full |
| `ODIN_NS_NEGATIVE_CACHE_TTL` | `30` | Seconds a "no such name" or "no such record" answer is kept |

### Management API

| Variable | Default | Purpose |
| --- | --- | --- |
| `ODIN_API_ENABLED` | `true` | Start the management API. Set to `false` to run the DNS server only |
| `ODIN_HTTP_ENABLED` / `ODIN_HTTP_PORT` | `true` / `45451` | Plain HTTP listener |
| `ODIN_HTTPS_ENABLED` / `ODIN_HTTPS_PORT` | `false` / `45452` | HTTPS listener; takes precedence over HTTP when enabled |
| `ODIN_AUTH_ENABLED` | `true` | Set to `false` to skip token checks. For local development only |
| `ODIN_DB_ADDRESS` / `ODIN_DB_PORT` / `ODIN_DB_NAME` | `127.0.0.1` / `27017` / `odin-ns-manager-1` | MongoDB location |
| `ODIN_DB_USER` / `ODIN_DB_PWD` | `Test` / `Test` | MongoDB credentials; set the user to an empty value to connect without authentication |

These settings are handed to freya-ns-api as its own `FREYA_*` variables. A
`FREYA_*` variable that is set explicitly wins, and is also the way to reach
the settings that have no `ODIN_*` counterpart, such as `FREYA_DB_URI`,
`FREYA_TOKEN_EXPIRES_IN`, `FREYA_HTTPS_KEY` / `FREYA_HTTPS_CERT` and
`FREYA_ADMIN_USER` / `FREYA_ADMIN_EMAIL` / `FREYA_ADMIN_PWD`. See the
[freya-ns-api documentation](https://github.com/csabatibortoth/freya-ns-api#configuration).

## DNS server

A query is answered with the records the upstream DNS servers have for it. The
A, AAAA, CNAME, MX, NS, PTR, SOA, SRV and TXT records can be looked up; a query
for another type is answered with "not implemented".

- **Cache** – an answer is kept in memory until its TTL runs out, and is sent
  with the TTL that is left of it. The upstream only reports the TTL of A and
  AAAA records; the other records are kept for 60 seconds.
- **Negative cache** – names and records that do not exist are remembered for
  `ODIN_NS_NEGATIVE_CACHE_TTL` seconds. Timeouts and other failures are not.
- **One lookup per name** – queries for the same name and type that arrive
  while a lookup is in flight wait for that lookup instead of sending their own.

The cache lives in the memory of the process and is empty after a restart.

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

```
curl -X POST http://localhost:45451/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<password>"}'
```

The API is the one of freya-ns-api; see its
[documentation](https://github.com/csabatibortoth/freya-ns-api#api) for the
details of every endpoint.

## Logs

When logging is enabled, three files are written per day to the log folder:
`log-<date>.log` (general), `error-<date>.log` (failures) and
`security-<date>.log` (logins and every change to a user).

## Project layout

| Path | Contents |
| --- | --- |
| `server.js` | Entry point: starts the DNS server and the management API |
| `config/` | Configuration |
| `services/serverService/searchService.js` | Upstream lookups and the in-memory cache |
| `services/apiService/apiService.js` | Start and stop of the management API, logging |
| `model/` | Data models (planned) |

## License

MIT
