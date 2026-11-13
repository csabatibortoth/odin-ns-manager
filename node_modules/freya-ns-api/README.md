# freya-ns-api

Management API for the Freya DNS server, version 2.3.1. It is the administrative
side of the name server: the place where the people who run it are managed,
where the zones and records it serves and the domains it blocks are managed, and
where what it did can be looked up.

- **Zones and records** - create, change and delete DNS zones and their A, AAAA,
  CNAME, MX, NS, PTR, SRV and TXT records. The SOA record and its serial are
  kept for you.
- **Standalone records** - records that belong to no zone, for the names that
  need no zone of their own, such as the machines of a home network.
- **Blocking** - block lists downloaded from a URL, such as the
  [StevenBlack hosts file](https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts),
  and domains blocked or allowed by hand.
- **Users** - accounts with an `admin` or `user` role, and passwords.
- **Monitoring** - the queries the name server answered, its clients, and
  hourly metrics.
- **Export and import** - everything as one JSON document, to move it to
  another system.
- **Authentication** - login with a token, logout, and immediate revocation.
  Nothing but the login can be used without signing in.
- **Swagger UI** - the whole API, described and ready to try, at `/api/docs`.
- **HTTPS** - with a certificate from Let's Encrypt that renews itself, or with
  one of your own.

The server is built on Express 5 and MongoDB (Mongoose 9). The zones and records
are stored in MongoDB and checked with the validators of
[njord-ns-server](https://github.com/csabatibortoth/njord-ns-server), so
everything that is stored is something that name server can send. See
[Serving the zones with njord-ns-server](#serving-the-zones-with-njord-ns-server)
for the other half.

## Requirements

- Node.js 22 or newer
- A MongoDB server the API can reach

## Getting started

```
npm install
npm start        # or: npm run dev, which restarts on every change
```

By default the API listens on `http://localhost:45451` and connects to MongoDB
at `127.0.0.1:27017`.

On the first start, when there are no users yet, an admin account named `admin`
is created. Set `FREYA_ADMIN_PWD` beforehand to choose its password; otherwise a
random password is printed once to the console. Sign in with it and change it.

From there, three requests put a name on the air: log in, create a zone, and add
a record to it.

```
curl -X POST http://localhost:45451/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<password>"}'

curl -X POST http://localhost:45451/api/zones \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name":"example.com","soa":{"host":"ns1.example.com"}}'

curl -X POST http://localhost:45451/api/zones/<zoneId>/records \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name":"www","type":"A","data":{"target":"192.0.2.1"}}'
```

The first answer holds the `token`, the second the `id` of the zone.

The same can be done from the browser: open `http://localhost:45451/api/docs`,
log in with `POST /auth/login`, press **Authorize** and paste the token.

## Configuration

Defaults live in `config/config.js`. Every value can be overridden with an
environment variable, so secrets do not have to be stored in the file.

| Variable | Default | Purpose |
| --- | --- | --- |
| `FREYA_TYPE` | `DEV` | Environment type. Anything other than `DEV` requires a private `FREYA_SECRET` |
| `FREYA_SECRET` | `Test` | Key used to sign login tokens |
| `FREYA_TOKEN_EXPIRES_IN` | `1h` | Lifetime of a login token |
| `FREYA_HTTP_ENABLED` / `FREYA_HTTP_PORT` | `true` / `45451` | Plain HTTP listener |
| `FREYA_HTTPS_ENABLED` / `FREYA_HTTPS_PORT` | `false` / `45452` | HTTPS listener; takes precedence over HTTP when enabled. See [HTTPS](#https) |
| `FREYA_HTTPS_CERT_SOURCE` | `letsencrypt` | Where the certificate comes from: `letsencrypt` or `custom` |
| `FREYA_HTTPS_DOMAINS` | – | `letsencrypt`: the public names of this server, comma separated. Required |
| `FREYA_ACME_EMAIL` | – | `letsencrypt`: an address for the account at the certificate authority. Optional |
| `FREYA_ACME_DIRECTORY` | `production` | `letsencrypt`: `production`, `staging`, or the directory URL of another ACME certificate authority |
| `FREYA_ACME_HTTP_PORT` | `80` | `letsencrypt`: the port that answers the challenge of the certificate authority |
| `FREYA_ACME_FOLDER` | `sslcert/letsencrypt` | `letsencrypt`: where the account key, the private key and the certificate are kept |
| `FREYA_HTTPS_KEY` / `FREYA_HTTPS_CERT` | `sslcert/server.key` / `sslcert/server.crt` | `custom`: the private key and the certificate, in PEM. The certificate may be followed by its chain |
| `FREYA_HTTPS_KEY_PASSPHRASE` | – | `custom`: the passphrase of the private key, when it is encrypted |
| `FREYA_DB_URI` | – | Full MongoDB connection string; overrides the separate settings below |
| `FREYA_DB_ADDRESS` / `FREYA_DB_PORT` / `FREYA_DB_NAME` | `127.0.0.1` / `27017` / `freya-ns-api-1` | MongoDB location |
| `FREYA_DB_USER` / `FREYA_DB_PWD` | `Test` / `Test` | MongoDB credentials; set the user to an empty value to connect without authentication |
| `FREYA_ADMIN_USER` / `FREYA_ADMIN_EMAIL` / `FREYA_ADMIN_PWD` | `admin` / `admin@localhost` / random | The admin account created on first start |
| `FREYA_LOGGING_ENABLED` / `FREYA_LOG_FOLDER` | `true` / `services/logService/logs` | File logging |
| `FREYA_AUTH_ENABLED` | `true` | Set to `false` to skip token checks. For local development only: every request is then treated as an admin |
| `FREYA_DNS_WRITE_ROLES` | `admin` | Roles that may change zones, records and the blocking, comma separated, e.g. `admin,user`. Every signed-in user may read them |
| `FREYA_BLOCKLIST_REFRESH_CRON` | `0 4 * * *` | When the block lists are downloaded again, as a cron expression. Set it to an empty value to download only on request |
| `FREYA_BLOCKLIST_MAX_SIZE_MB` | `64` | A block list that is larger than this is refused |
| `FREYA_DOCS_ENABLED` | `true` | Set to `false` to switch off the Swagger UI at `/api/docs` |
| `FREYA_MONITORING_ROLES` | `admin` | Roles that may record and read the queries, the clients and the metrics, comma separated |
| `FREYA_QUERY_LOG_RETENTION_DAYS` | `30` | How long a recorded query is kept. `0`: the queries are counted, but not stored |
| `FREYA_METRICS_RETENTION_DAYS` | `365` | How long the hourly metrics are kept. `0`: forever |
| `FREYA_IMPORT_MAX_SIZE_MB` | `50` | An import that is larger than this is refused |
| `FREYA_SERVER_NAME` / `FREYA_COMPANY_NAME` | `freya-ns-api-1` / `YourCompany` | Shown in the welcome message |

## HTTPS

Set `FREYA_HTTPS_ENABLED=true` to serve the API over HTTPS, on port 45452 by
default. The plain HTTP listener is not started then. The certificate comes
from one of two sources, chosen with `FREYA_HTTPS_CERT_SOURCE`.

### Let's Encrypt

The default. The server requests a certificate from
[Let's Encrypt](https://letsencrypt.org) on the first start, and renews it by
itself when it has less than 30 days left, without a restart.

```
FREYA_HTTPS_ENABLED=true
FREYA_HTTPS_DOMAINS=dns.example.com
FREYA_ACME_EMAIL=admin@example.com      # optional
```

What it takes:

- Every name in `FREYA_HTTPS_DOMAINS` must lead to this server in the public
  DNS. Wildcards and IP addresses are not possible.
- **Port 80 must reach this server from the internet.** Let's Encrypt checks
  each name by asking for a token over plain HTTP on port 80. The server
  answers on `FREYA_ACME_HTTP_PORT`, only while a certificate is being
  requested, and serves nothing else there. Where the process may not open
  port 80, forward it to another port and set `FREYA_ACME_HTTP_PORT` to that.
- Requesting a certificate means accepting the
  [Subscriber Agreement](https://letsencrypt.org/repository/) of Let's Encrypt.

Try it first with `FREYA_ACME_DIRECTORY=staging`: the staging certificates are
not trusted by a browser, but the strict
[rate limits](https://letsencrypt.org/docs/rate-limits/) of production do not
apply while the setup is being worked out. `FREYA_ACME_DIRECTORY` also takes
the directory URL of any other certificate authority that speaks ACME.

The account key, the private key and the certificate are kept in
`FREYA_ACME_FOLDER`, in one folder per certificate authority, and are used
again on the next start. Keep that folder private and out of version control;
`sslcert/` is in `.gitignore`.

When the first certificate cannot be obtained, the server does not start, and
says why. A renewal that fails is written to the error log and tried again
after six hours; the certificate that is there keeps being served.

### Custom certificate

A certificate from anywhere else: your own certificate authority, a commercial
one, or a self-signed one.

```
FREYA_HTTPS_ENABLED=true
FREYA_HTTPS_CERT_SOURCE=custom
FREYA_HTTPS_KEY=sslcert/server.key
FREYA_HTTPS_CERT=sslcert/server.crt
```

Both files are PEM. The certificate file may hold the chain after the
certificate. The server does not start without them, or when the key does not
belong to the certificate.

It can be replaced while the server runs, in two ways:

- Send the new one to `PUT /api/certificate`. It is checked, written to the
  two files, and served at once.
- Overwrite the two files, as a tool that renews them would. The server
  notices within the hour; `POST /api/certificate/renew` reads them right away.
  Files that cannot be used are left alone, and the certificate that is served
  stays.

### The certificate endpoints

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/certificate` | admin | The source, and the certificate that is served |
| PUT | `/certificate` | admin | Replace the custom certificate: `{ certificate, privateKey }`, both in PEM |
| POST | `/certificate/renew` | admin | Let's Encrypt: request a new certificate now. Custom: read the files again |

```
{
  "enabled": true,
  "source": "letsencrypt",
  "domains": ["dns.example.com"],
  "automaticRenewal": true,
  "certificate": {
    "subject": "CN=dns.example.com",
    "issuer": "C=US, O=Let's Encrypt, CN=E7",
    "altNames": ["dns.example.com"],
    "validFrom": "2026-11-13T09:12:44.000Z",
    "validTo": "2027-02-11T09:12:43.000Z",
    "daysLeft": 89,
    "serialNumber": "05A1...",
    "fingerprint256": "68:7B:A8:..."
  },
  "lastCheckAt": "2026-11-13T10:23:00.000Z",
  "lastError": null
}
```

The private key is never part of an answer. `PUT /certificate` answers 409
when the source is `letsencrypt`, and 400 for a certificate that is expired or
does not match its key. `POST /certificate/renew` answers 502 when the
certificate authority refused, with its reason.

## API

All paths are under `/api`. Requests and responses are JSON. After logging in,
send the token with every request as `Authorization: Bearer <token>`.

Every endpoint requires signing in, except `POST /auth/login`. Without a valid
token the answer is 401, also for a path that does not exist.

The API is described in OpenAPI 3: `/api/docs` shows it with Swagger UI, and
`/api/docs/openapi.json` serves it for other tools. These two hold no data and
are open without signing in; set `FREYA_DOCS_ENABLED=false` to switch them off.

### Authentication

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/` | signed in | Welcome message and version |
| POST | `/auth/login` | anyone | `{ username, password }` returns a token. The username may also be the e-mail address |
| GET | `/auth/me` | signed in | The current user |
| POST | `/auth/logout` | signed in | Revokes every token of the current user |

### Users

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/users` | admin | List users |
| POST | `/users` | admin | Create a user: `{ username, email, password, displayName?, role?, active? }` |
| GET | `/users/:id` | admin or self | Read one user |
| PATCH | `/users/:id` | admin or self | Update a user. Self: `email`, `displayName`. Admin also: `username`, `role`, `active` |
| PUT | `/users/:id/password` | admin or self | `{ newPassword, currentPassword }`. `currentPassword` is required when changing your own password |
| DELETE | `/users/:id` | admin | Delete a user |

`GET /users` accepts these query parameters:

| Parameter | Meaning |
| --- | --- |
| `page`, `limit` | Paging; `limit` defaults to 20 and is capped at 100 |
| `q` | Text search in username, e-mail and display name |
| `role` | `admin` or `user` |
| `active` | `true` or `false` |
| `sort` | Field to sort by, prefixed with `-` for descending, e.g. `-createdAt` |

Rules worth knowing:

- There are two roles, `admin` and `user`. New users get `user` unless stated otherwise.
- Passwords must be 8 to 128 characters long.
- The last active admin cannot be deleted, demoted or deactivated.
- Changing a password, logging out, deactivating or deleting a user invalidates
  that user's tokens immediately.

### Zones

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/zones` | signed in | List zones |
| POST | `/zones` | admin | Create a zone: `{ name, soa: { host, ... }, ttl?, active? }` |
| GET | `/zones/:zoneId` | signed in | Read one zone |
| PATCH | `/zones/:zoneId` | admin | Update `soa`, `ttl` or `active`. The fields of `soa` that are left out keep their value |
| DELETE | `/zones/:zoneId` | admin | Delete a zone **and all of its records** |

"admin" stands for the roles in `FREYA_DNS_WRITE_ROLES`.

A zone looks like this:

```
{
  "id": "6af57c22d39258fa75d366fa",
  "name": "example.com",
  "ttl": 3600,
  "active": true,
  "soa": {
    "host": "ns1.example.com",
    "admin": "hostmaster.example.com",
    "serial": 2026111200,
    "refresh": 3600,
    "retry": 600,
    "expire": 604800,
    "ttl": 3600
  }
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `name` | required | The domain of the zone. Cannot be changed afterwards |
| `ttl` | `3600` | TTL, in seconds, of the records that do not set their own |
| `active` | `true` | An inactive zone is kept, but is not meant to be served |
| `soa.host` | required | Host name of the primary name server |
| `soa.admin` | `hostmaster.<name>` | Mailbox of the administrator, written as a domain name. An e-mail address is converted |
| `soa.serial` | today, as `YYYYMMDD00` | Raised automatically on every change to the zone or its records. May be set by hand |
| `soa.refresh` / `soa.retry` / `soa.expire` / `soa.ttl` | `3600` / `600` / `604800` / `3600` | The timers of the SOA record, in seconds |

The `soa` object has the properties of the `SOARecord` of njord-ns-server:
`new named.SOARecord(zone.soa.host, zone.soa)`.

`GET /zones` accepts `page`, `limit`, `q` (text search in the name), `active`
and `sort` (`name`, `active`, `ttl`, `createdAt`, `updatedAt`), with the same
meaning as for `GET /users`.

### Records

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/zones/:zoneId/records` | signed in | List the records of a zone |
| POST | `/zones/:zoneId/records` | admin | Create a record: `{ name, type, data, ttl?, active? }` |
| GET | `/zones/:zoneId/records/:recordId` | signed in | Read one record |
| PATCH | `/zones/:zoneId/records/:recordId` | admin | Update `name`, `data`, `ttl` or `active`. The fields of `data` that are left out keep their value |
| DELETE | `/zones/:zoneId/records/:recordId` | admin | Delete a record |

| Field | Default | Meaning |
| --- | --- | --- |
| `name` | required | The owner of the record: `@` for the zone itself, a name relative to the zone (`www`), or a fully qualified name (`www.example.com`). The first label may be `*`. Stored fully qualified |
| `type` | required | One of the types below. Cannot be changed afterwards |
| `data` | required | The value of the record; its fields depend on the type |
| `ttl` | `null` | TTL in seconds; `null` means the TTL of the zone |
| `active` | `true` | An inactive record is kept, but is not meant to be served |

The fields of `data` are the properties of the record classes of njord-ns-server:

| Type | `data` |
| --- | --- |
| `A` | `{ target }` - an IPv4 address |
| `AAAA` | `{ target }` - an IPv6 address |
| `CNAME`, `NS`, `PTR` | `{ target }` - a fully qualified host name |
| `MX` | `{ exchange, priority? }` - host name of the mail server; `priority` defaults to 0 |
| `SRV` | `{ target, port, priority?, weight? }` - `priority` defaults to 0, `weight` to 10 |
| `TXT` | `{ target }` - the text |

The SOA record is not in this list: it is the `soa` of the zone.

`GET /zones/:zoneId/records` accepts `page`, `limit`, `type`, `name`, `active`,
`q` (text search in the name and the target) and `sort` (`name`, `type`, `ttl`,
`active`, `createdAt`, `updatedAt`).

A record looks like this:

```
{
  "id": "6af57c22d39258fa75d366fc",
  "zone": "6af57c22d39258fa75d366fa",
  "name": "www.example.com",
  "type": "A",
  "ttl": null,
  "data": { "target": "192.0.2.1" },
  "active": true
}
```

Rules worth knowing:

- Host names in `data` must be fully qualified; they are not completed with the zone.
- A name that has a CNAME record cannot have any other record, and the name of
  a zone cannot be a CNAME. This holds across the zones and the standalone
  records.
- Two identical records (same name, type and data) cannot exist in a zone.
- Every change to a record raises the serial of its zone.

### Standalone records

A record does not need a zone. The standalone records are for the names that
are answered without being an authority for their domain: the machines of a
home network, or a single name that is overridden.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/records` | signed in | List the standalone records |
| POST | `/records` | admin | Create a record: `{ name, type, data, ttl?, active? }` |
| GET | `/records/:recordId` | signed in | Read one record |
| PATCH | `/records/:recordId` | admin | Update `name`, `data`, `ttl` or `active` |
| DELETE | `/records/:recordId` | admin | Delete a record |

```
curl -X POST http://localhost:45451/api/records \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name":"nas.home.lan","type":"A","data":{"target":"192.168.1.10"}}'
```

They work as the records of a zone, with the same types, `data`, query
parameters and rules. The differences:

- `name` must be fully qualified, as there is no zone to complete it with. It
  may be a single label (`nas`), and its first label may be `*`.
- `zone` is `null`.
- `ttl: null` means the default TTL of the name server, as there is no zone to
  take it from.
- There is no SOA record and no serial.

`/records` only holds the standalone records; the records of a zone are read
and changed under their zone.

### Blocking

The name server can refuse to resolve unwanted domains: advertising, trackers,
malware. What is blocked comes from two places:

- **Block lists** - lists of domains that are downloaded from a URL.
- **Block rules** - single domains that are blocked, or allowed, by hand.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/blocking/settings` | signed in | Read the settings |
| PATCH | `/blocking/settings` | admin | Update `enabled` or `mode` |
| GET | `/blocking/check?domain=` | signed in | Tell whether a domain is blocked, and why |
| GET | `/blocking/lists` | signed in | List the block lists |
| POST | `/blocking/lists` | admin | Add a block list: `{ name, url, description?, active? }` |
| GET | `/blocking/lists/:listId` | signed in | Read one block list |
| PATCH | `/blocking/lists/:listId` | admin | Update `name`, `url`, `description` or `active` |
| DELETE | `/blocking/lists/:listId` | admin | Delete a block list **and all of its domains** |
| POST | `/blocking/lists/:listId/refresh` | admin | Download the list again, and wait for it |
| POST | `/blocking/lists/refresh` | admin | Download every active list again, in the background |
| GET | `/blocking/lists/:listId/entries` | signed in | List the domains of a block list |
| GET | `/blocking/rules` | signed in | List the block rules |
| POST | `/blocking/rules` | admin | Create a rule: `{ domain, action, includeSubdomains?, comment?, active? }` |
| GET | `/blocking/rules/:ruleId` | signed in | Read one rule |
| PATCH | `/blocking/rules/:ruleId` | admin | Update a rule |
| DELETE | `/blocking/rules/:ruleId` | admin | Delete a rule |

"admin" stands for the roles in `FREYA_DNS_WRITE_ROLES` here as well.

#### Block lists

```
curl -X POST http://localhost:45451/api/blocking/lists \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name":"StevenBlack","url":"https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"}'
```

The answer comes at once, with the status `pending`; the list is downloaded in
the background. Read the list again to see how it went:

```
{
  "id": "6af6bca9beb489c32450fe0b",
  "name": "StevenBlack",
  "url": "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
  "description": "",
  "active": true,
  "status": "ok",
  "lastError": null,
  "refreshedAt": "2026-11-13T04:00:03.512Z",
  "entryCount": 78215,
  "refreshing": false
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `name` | required | A name for the list, of at most 100 characters |
| `url` | required | Where the list is downloaded from, with `http` or `https`. A URL can be added once |
| `description` | empty | A note, of at most 500 characters |
| `active` | `true` | The domains of an inactive list are kept, but are not blocked |
| `status` | | `pending`: not downloaded yet. `ok` or `error`: the outcome of the last download |
| `lastError` | | Why the last download failed |
| `refreshedAt` | | The time of the last successful download |
| `entryCount` | | The number of domains of the list |
| `refreshing` | | Whether the list is being downloaded right now |

Three formats are understood, and may be mixed in one list:

| Format | Line |
| --- | --- |
| hosts file | `0.0.0.0 ads.example.com` - an address followed by one or more names |
| list of domains | `ads.example.com` |
| adblock rule | `\|\|ads.example.com^` |

Comments (`#`, `!`), the `localhost` names of a hosts file, and the adblock
rules of any other form are skipped.

Rules worth knowing:

- The active lists are downloaded again on the schedule of
  `FREYA_BLOCKLIST_REFRESH_CRON`, every day at 04:00 by default.
- A download only writes what changed, so a domain that stays on the list is
  blocked without a gap.
- A download that fails, or that holds no domains, keeps the domains the list
  had, and sets `status` to `error`. `POST .../refresh` answers with 200 in
  this case too: look at the `status` of the answer.
- Changing the `url` downloads the list again right away.
- A list is matched by the exact name: `ads.example.com` on a list does not
  block `www.ads.example.com`.
- The API downloads whatever URL it is given, from where it runs. Leave the
  write roles to the people who are trusted with that.

`GET /blocking/lists` accepts `page`, `limit`, `q` (text search in the name,
url and description), `active`, `status` and `sort` (`name`, `url`, `active`,
`status`, `entryCount`, `refreshedAt`, `createdAt`, `updatedAt`).
`GET /blocking/lists/:listId/entries` accepts `page`, `limit` and `q` (a part
of the domain); its items are the domains, as text.

#### Block rules

A rule blocks or allows one domain by hand, and wins over the block lists.

```
{
  "id": "6af6bcaabeb489c32450fe1a",
  "domain": "ads.example.com",
  "action": "allow",
  "includeSubdomains": false,
  "comment": "needed by the TV",
  "active": true
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `domain` | required | A fully qualified domain name. A domain can have one rule |
| `action` | required | `block`, or `allow` to take a domain out of the block lists |
| `includeSubdomains` | `false` | Whether the rule holds for every name below the domain as well |
| `comment` | empty | A note, of at most 500 characters |
| `active` | `true` | An inactive rule is kept, but is not applied |

`GET /blocking/rules` accepts `page`, `limit`, `q` (text search in the domain
and the comment), `action`, `active` and `sort` (`domain`, `action`, `active`,
`createdAt`, `updatedAt`).

#### Settings, and how a name is decided

```
{ "enabled": true, "mode": "NULL_IP" }
```

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | The switch of all blocking. When `false` nothing is blocked, and the lists and rules are kept |
| `mode` | `NULL_IP` | How a blocked name is answered: `NULL_IP` with `0.0.0.0` and `::`, `NXDOMAIN` as a name that does not exist |

Whether a name is blocked is decided in this order:

1. When the blocking is not enabled, it is not blocked.
2. The active rule of the name itself decides, or else that of the nearest
   domain above it that has `includeSubdomains`.
3. Without such a rule, the name is blocked when an active block list holds it.

`GET /blocking/check?domain=ads.example.com` makes this decision and shows what
it is based on:

```
{
  "domain": "ads.example.com",
  "blocked": true,
  "enabled": true,
  "mode": "NULL_IP",
  "rule": null,
  "lists": [{ "id": "6af6bca9beb489c32450fe0b", "name": "StevenBlack" }]
}
```

### Monitoring

What the name server did: the queries it answered, the clients that sent them,
and the metrics of every hour. The name server reports its queries to
`POST /monitoring/queries`; the clients and the metrics are derived from them.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/monitoring/queries` | Record queries: `{ queries: [{ client, name, type, ... }] }` |
| GET | `/monitoring/queries` | List the recorded queries, the newest first |
| DELETE | `/monitoring/queries` | Delete the recorded queries: all, or those `before` a time |
| GET | `/monitoring/metrics` | The counters of a period, as totals and as a series over time |
| GET | `/monitoring/top` | The most asked and most blocked names, and the busiest clients |
| GET | `/monitoring/clients` | List the clients, the last seen first |
| GET | `/monitoring/clients/:clientId` | Read one client |
| PATCH | `/monitoring/clients/:clientId` | Give a client a name: `{ name }` |
| DELETE | `/monitoring/clients/:clientId` | Forget a client and its counters |

The queries show what every client looks up, so all of the monitoring is for
the roles in `FREYA_MONITORING_ROLES` only, `admin` by default; other signed-in
users get 403.

#### Recording queries

```
curl -X POST http://localhost:45451/api/monitoring/queries \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"queries":[{"client":"192.168.1.5","name":"www.example.com","type":"A","durationMs":4}]}'
```

| Field | Default | Meaning |
| --- | --- | --- |
| `client` | required | The IPv4 or IPv6 address of the client |
| `name` | required | The name that was asked for |
| `type` | required | The record type that was asked for, e.g. `A` |
| `time` | now | When the query was answered |
| `status` | `NOERROR` | The response code of the answer, e.g. `NXDOMAIN` or `SERVFAIL` |
| `blocked` | `false` | Whether the name was blocked |
| `durationMs` | `null` | How long the answer took, in milliseconds |

Up to 5000 queries are taken in one request, so the name server can collect
them and send them every few seconds. A batch with a query that is not valid is
refused as a whole, and the answer says which ones. The name server needs an
account with a monitoring role, and has to log in again when its token expires
(`FREYA_TOKEN_EXPIRES_IN`). A name server that runs beside the API can skip
HTTP and call `recordQueries` of `services/monitoringService/monitoringService.js`
with the same object.

`GET /monitoring/queries` accepts `page`, `limit`, `client`, `name`, `q` (a
part of the name), `type`, `status`, `blocked`, `from`, `to` and `sort`
(`time`, `client`, `name`, `type`, `status`, `durationMs`; `-time` by default).

#### Metrics

`GET /monitoring/metrics` accepts `from` and `to` (the last 24 hours when left
out) and `interval` (`hour` or `day`; days are those of UTC):

```
{
  "from": "2026-11-12T10:00:00.000Z",
  "to": "2026-11-13T10:00:00.000Z",
  "interval": "hour",
  "totals": {
    "queries": 18230,
    "blocked": 2311,
    "blockedPercent": 12.68,
    "averageDurationMs": 3.41,
    "clients": 14,
    "statuses": { "NOERROR": 17650, "NXDOMAIN": 580 },
    "types": { "A": 11020, "AAAA": 6900, "HTTPS": 310 }
  },
  "series": [
    { "time": "2026-11-12T10:00:00.000Z", "queries": 640, "blocked": 71, "averageDurationMs": 3.2 }
  ]
}
```

The series has a point for every hour or day of the period, also for those
without queries. `clients` is the number of clients that were seen in the
period.

`GET /monitoring/top` accepts `from`, `to` and `limit` (10 by default, at most
100), and answers with `domains`, `blockedDomains` (`{ name, count }`) and
`clients` (`{ address, name, count }`).

#### Clients

A client is an address that sent at least one query. It is listed by itself
when its first query is recorded:

```
{
  "id": "6af6c1d2beb489c32450fe31",
  "address": "192.168.1.5",
  "name": "Living room TV",
  "firstSeenAt": "2026-11-02T18:04:11.000Z",
  "lastSeenAt": "2026-11-13T09:58:40.000Z",
  "queries": 48211,
  "blocked": 9120
}
```

Only the `name` is set by hand. `GET /monitoring/clients` accepts `page`,
`limit`, `q` (text search in the address and the name) and `sort` (`address`,
`name`, `firstSeenAt`, `lastSeenAt`, `queries`, `blocked`).

#### How long it is kept

| What | Kept for | Setting |
| --- | --- | --- |
| Queries | 30 days | `FREYA_QUERY_LOG_RETENTION_DAYS`. With `0` the queries are counted in the metrics and the clients, but not stored |
| Metrics | 365 days | `FREYA_METRICS_RETENTION_DAYS`. With `0` they are kept forever |
| Clients | until deleted | |

What is too old is deleted every hour. The metrics are counted when a query is
recorded, so they stay when the queries are deleted; `top` is counted from the
stored queries, and reaches back only as far as those are kept. The counters of
a client are counted since it was first seen.

### Export and import

Moves the configuration of a system to another one. Both are for the `admin`
role only.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/backup/export` | Everything as one JSON document |
| POST | `/backup/import` | Read such a document into this system |

```
curl -H "Authorization: Bearer <token>" \
  "http://old:45451/api/backup/export?include=zones,records,blocking,users" -o export.json

curl -X POST "http://new:45451/api/backup/import" \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  --data-binary @export.json
```

`include` chooses the sections of the export, comma separated:

| Section | Contents | In the export by default |
| --- | --- | --- |
| `zones` | The zones, each with its SOA record and its records | yes |
| `records` | The standalone records | yes |
| `blocking` | The settings, the block lists and the block rules | yes |
| `users` | The users, **with their password hashes** | no |

The export looks like this:

```
{
  "format": "freya-ns-api-export",
  "formatVersion": 1,
  "version": "2.3.1",
  "exportedAt": "2026-11-13T10:15:00.000Z",
  "data": {
    "zones": [{ "name": "example.com", "ttl": 3600, "active": true, "soa": { ... }, "records": [ ... ] }],
    "records": [{ "name": "nas.home.lan", "type": "A", "ttl": null, "data": { "target": "192.168.1.10" }, "active": true }],
    "blocking": { "settings": { ... }, "lists": [ ... ], "rules": [ ... ] },
    "users": [ ... ]
  }
}
```

The import reads the sections that are in the document, so a document can be
cut down, or written by hand, to import only a part. `existing` says what
happens to what this system has already:

| `existing` | Meaning |
| --- | --- |
| `skip` (default) | What is there already is kept as it is; only what is missing is created |
| `overwrite` | What is there already is updated from the export |

What counts as "there already": a zone with the same name, a record with the
same name, type and data (in the same zone), a block list with the same URL, a
block rule with the same domain, and a user with the same username.

The answer tells what was done:

```
{
  "existing": "skip",
  "zones": { "created": 2, "updated": 0, "skipped": 0, "failed": 0 },
  "records": { "created": 41, "updated": 0, "skipped": 0, "failed": 1 },
  "blockSettings": "updated",
  "blockLists": { "created": 1, "updated": 0, "skipped": 0, "failed": 0 },
  "blockRules": { "created": 3, "updated": 0, "skipped": 0, "failed": 0 },
  "users": { "created": 4, "updated": 0, "skipped": 1, "failed": 0 },
  "errors": [
    { "section": "records", "item": "A www in example.com", "error": "Validation failed", "details": { "data.target": "data.target must be an IPv4 address" } }
  ]
}
```

Rules worth knowing:

- An import never deletes anything.
- An import is not all-or-nothing. An item that is refused is counted as
  `failed` and listed in `errors` (the first 100), and the others are imported.
  Only a document that is not an export at all is refused as a whole, with 400.
- Everything is checked with the same rules as when it is created by hand.
- A zone that is created by the import keeps the serial it was exported with.
  The records that are missing from a zone that is there already are added to
  it, also with `skip`.
- The domains of the block lists are not exported. An imported list is
  downloaded by the new system right away.
- The block settings are imported when this system has never changed its own,
  or with `overwrite`.
- An imported user logs in with the password it had. The account that runs the
  import is never changed by it, and the last active admin cannot be demoted or
  deactivated.
- An export with users holds password hashes: keep the file as safe as the
  database itself.
- The monitoring data - the queries, the clients and the metrics - is not
  exported.
- An import may be up to `FREYA_IMPORT_MAX_SIZE_MB` large, 50 MB by default.

### Errors

Errors are returned with a matching HTTP status and this body:

```
{ "error": "Validation failed", "details": { "email": "email is not valid" } }
```

| Status | Meaning |
| --- | --- |
| 400 | The request is malformed or a value is not valid |
| 401 | Not signed in, wrong credentials, or the token is expired or revoked |
| 403 | Signed in, but not allowed to do this |
| 404 | No such path, user, zone, record, block list, block rule or client |
| 413 | The request body is too large |
| 502 | The certificate authority did not issue a certificate |
| 409 | The username, e-mail, zone name, block list URL or block rule domain is already taken, the record already exists or conflicts with a CNAME, or the change would remove the last admin |

## Serving the zones with njord-ns-server

This API only manages the zones and records; answering DNS queries is the work
of [njord-ns-server](https://github.com/csabatibortoth/njord-ns-server). That
server keeps no records of its own, so it looks them up in the `zones` and
`records` collections this API writes. The stored fields are the constructor
arguments of its record classes:

```javascript
const named = require('njord-ns-server');
const { connectToDB, Zone, Record } = require('./model/mongoDB/manager');

const server = named.createServer();
const build = {
  MX: (data) => new named.MXRecord(data.exchange, data),
  SRV: (data) => new named.SRVRecord(data.target, data.port, data),
};
const toRecord = ({ type, data }) =>
  (build[type] ? build[type](data) : new named[`${type}Record`](data.target));

server.on('query', async (query) => {
  const name = query.name().toLowerCase();
  if (query.type() === 'SOA') {
    const zone = await Zone.findOne({ name, active: true }).lean();
    if (zone) query.addAnswer(name, new named.SOARecord(zone.soa.host, zone.soa), zone.soa.ttl);
  } else {
    const records = await Record.find({ name, type: query.type(), active: true })
      .populate('zone', 'ttl active')
      .lean();
    for (const record of records) {
      // A standalone record has no zone: it is served by itself, with a default TTL.
      if (!record.zone) query.addAnswer(name, toRecord(record), record.ttl ?? 3600);
      else if (record.zone.active) query.addAnswer(name, toRecord(record), record.ttl ?? record.zone.ttl);
    }
  }
  server.send(query);
});

connectToDB().then(() => server.listen(9999, '127.0.0.1'));
```

This is the smallest server that works, not a complete one: wildcard names,
following a CNAME, answers for names that do not exist and zone transfers are
left to the server. The `active` flag of a zone or a record has no effect by
itself either; it is the server that must skip what is inactive, as above.

The same goes for the blocking: this API stores what is blocked, in the
`blockentries` (`{ list, domain }`), `blocklists`, `blockrules` and
`blocksettings` collections, and the name server is what must refuse the name
before it answers. `check` in `services/blockingService/blockingService.js` is
the decision to follow, and can be called as it is from a server that runs
beside the API:

```javascript
const { check } = require('./services/blockingService/blockingService');

// at the top of the query handler
const { blocked, mode } = await check(query.name());
if (blocked) {
  if (mode === 'NULL_IP' && query.type() === 'A') query.addAnswer(name, new named.ARecord('0.0.0.0'), 60);
  if (mode === 'NULL_IP' && query.type() === 'AAAA') query.addAnswer(name, new named.AAAARecord('::'), 60);
  // NXDOMAIN: set the response code the way your version of the server does it
  return server.send(query);
}
```

## Logs

When logging is enabled, three files are written per day to the log folder:
`log-<date>.log` (general), `error-<date>.log` (failures) and
`security-<date>.log` (logins and every change to a user). Changes to zones and
records are written to the general log, with the name of the user who made them.
So are the changes to the blocking and every download of a block list; a
download that fails is written to the error log.

## Project layout

| Path | Contents |
| --- | --- |
| `api.js` | Entry point: connects to the database and starts the server |
| `app.js` | Express application, routes and error handling |
| `config/` | Configuration |
| `routes/` | HTTP endpoints |
| `docs/` | The OpenAPI description behind `/api/docs`. Written by hand: change it together with the routes |
| `services/` | Authentication, users, zones and records, blocking, monitoring, export and import, the certificate of HTTPS, logging and server start-up |
| `model/mongoDB/` | Database connection and data models |

## Release notes

### 2.3.1

New in this release:

- **HTTPS with Let's Encrypt**: with `FREYA_HTTPS_ENABLED=true` and
  `FREYA_HTTPS_DOMAINS`, the server requests its certificate from Let's Encrypt
  and renews it by itself. See [HTTPS](#https).
- **Custom certificates**: `FREYA_HTTPS_CERT_SOURCE=custom` serves a private
  key and a certificate from anywhere else. They can be replaced without a
  restart, through the API or by overwriting the files.
- **The certificate endpoints**: `/api/certificate`, to see the certificate
  that is served, to send a custom one, and to renew it on request.

Changed, and worth checking before updating:

- **Let's Encrypt is the default source of the certificate.** A server that
  already runs with `FREYA_HTTPS_ENABLED=true` and its own files in
  `FREYA_HTTPS_KEY` / `FREYA_HTTPS_CERT` has to set
  `FREYA_HTTPS_CERT_SOURCE=custom`, or it does not start. Nothing changes for a
  server that runs over plain HTTP.
- The key and the certificate are checked on start: a key that does not belong
  to the certificate stops the server with a message, instead of failing at the
  first connection.

Updating:

- Run `npm install`: `acme-client` is a new dependency.
- No data has to be migrated.
- New settings, all with a default except the first: `FREYA_HTTPS_DOMAINS`
  (required for Let's Encrypt), `FREYA_HTTPS_CERT_SOURCE`, `FREYA_ACME_EMAIL`,
  `FREYA_ACME_DIRECTORY`, `FREYA_ACME_HTTP_PORT`, `FREYA_ACME_FOLDER` and
  `FREYA_HTTPS_KEY_PASSPHRASE`.
- The keys are kept under `sslcert/`, which is now in `.gitignore`.

### 2.3.0

New in this release:

- **Standalone records**: `/api/records`, for records that belong to no zone.
- **Blocking**: `/api/blocking`, with block lists that are downloaded from a
  URL and refreshed on a schedule, block and allow rules for single domains, a
  switch for all blocking, and a check of a domain.
- **Monitoring**: `/api/monitoring`, where the name server records the queries
  it answered, and where the queries, the clients and the hourly metrics are
  read.
- **Export and import**: `/api/backup/export` and `/api/backup/import`, to
  move the zones, records, blocking and users to another system.
- **Swagger UI** at `/api/docs`, and the OpenAPI description at
  `/api/docs/openapi.json`.

Changed, and worth checking before updating:

- Every endpoint requires signing in, except `POST /api/auth/login`.
  **`GET /api/` now needs a token as well**, and a path that does not exist
  answers 401 instead of 404 to a request without one. A health check that
  calls `GET /api/` without a token has to be changed.
- A CNAME record is now refused when its name has records anywhere, not only in
  the same zone.
- The `zone` of a record can be `null`: a name server that reads the `records`
  collection must expect the standalone records. The example in
  [Serving the zones with njord-ns-server](#serving-the-zones-with-njord-ns-server)
  shows how.

Updating:

- Run `npm install`: `swagger-ui-express` is a new dependency.
- No data has to be migrated. The new collections and their indexes are created
  on the first start, and the existing records keep their zone.
- New settings, all with a default: `FREYA_BLOCKLIST_REFRESH_CRON`,
  `FREYA_BLOCKLIST_MAX_SIZE_MB`, `FREYA_DOCS_ENABLED`,
  `FREYA_MONITORING_ROLES`, `FREYA_QUERY_LOG_RETENTION_DAYS`,
  `FREYA_METRICS_RETENTION_DAYS` and `FREYA_IMPORT_MAX_SIZE_MB`.
- The blocking and the monitoring store what the name server needs and
  reports; njord-ns-server has to be taught to use them. See
  [Blocking](#blocking) and [Monitoring](#monitoring).

### 2.2.0

- Zones: `/api/zones`, with the SOA record of the zone and a serial that is
  raised on every change.
- Records: `/api/zones/:zoneId/records`, for A, AAAA, CNAME, MX, NS, PTR, SRV
  and TXT records, validated with njord-ns-server 2.1.0.
- `FREYA_DNS_WRITE_ROLES` chooses the roles that may change zones and records.
- New dependency: `njord-ns-server`, installed from GitHub. Run `npm install`
  after updating.

Nothing changes for the existing endpoints, and no data has to be migrated: the
two new collections and their indexes are created on the first start.

### 2.0.0

- All packages updated; rebuilt on Express 5 and Mongoose 9.
- User management and token authentication.

## License

MIT
