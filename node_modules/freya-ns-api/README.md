# freya-ns-api

Management API for the Freya DNS server, version 2.2.0. It is the administrative
side of the name server: the place where the people who run it are managed, and
where the zones and records it serves are managed.

- **Zones and records** - create, change and delete DNS zones and their A, AAAA,
  CNAME, MX, NS, PTR, SRV and TXT records. The SOA record and its serial are
  kept for you.
- **Users** - accounts with an `admin` or `user` role, and passwords.
- **Authentication** - login with a token, logout, and immediate revocation.

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

## Configuration

Defaults live in `config/config.js`. Every value can be overridden with an
environment variable, so secrets do not have to be stored in the file.

| Variable | Default | Purpose |
| --- | --- | --- |
| `FREYA_TYPE` | `DEV` | Environment type. Anything other than `DEV` requires a private `FREYA_SECRET` |
| `FREYA_SECRET` | `Test` | Key used to sign login tokens |
| `FREYA_TOKEN_EXPIRES_IN` | `1h` | Lifetime of a login token |
| `FREYA_HTTP_ENABLED` / `FREYA_HTTP_PORT` | `true` / `45451` | Plain HTTP listener |
| `FREYA_HTTPS_ENABLED` / `FREYA_HTTPS_PORT` | `false` / `45452` | HTTPS listener; takes precedence over HTTP when enabled |
| `FREYA_HTTPS_KEY` / `FREYA_HTTPS_CERT` | `sslcert/server.key` / `sslcert/server.crt` | Certificate files for HTTPS |
| `FREYA_DB_URI` | – | Full MongoDB connection string; overrides the separate settings below |
| `FREYA_DB_ADDRESS` / `FREYA_DB_PORT` / `FREYA_DB_NAME` | `127.0.0.1` / `27017` / `freya-ns-api-1` | MongoDB location |
| `FREYA_DB_USER` / `FREYA_DB_PWD` | `Test` / `Test` | MongoDB credentials; set the user to an empty value to connect without authentication |
| `FREYA_ADMIN_USER` / `FREYA_ADMIN_EMAIL` / `FREYA_ADMIN_PWD` | `admin` / `admin@localhost` / random | The admin account created on first start |
| `FREYA_LOGGING_ENABLED` / `FREYA_LOG_FOLDER` | `true` / `services/logService/logs` | File logging |
| `FREYA_AUTH_ENABLED` | `true` | Set to `false` to skip token checks. For local development only: every request is then treated as an admin |
| `FREYA_DNS_WRITE_ROLES` | `admin` | Roles that may change zones and records, comma separated, e.g. `admin,user`. Every signed-in user may read them |
| `FREYA_SERVER_NAME` / `FREYA_COMPANY_NAME` | `freya-ns-api-1` / `YourCompany` | Shown in the welcome message |

## API

All paths are under `/api`. Requests and responses are JSON. After logging in,
send the token with every request as `Authorization: Bearer <token>`.

### Authentication

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/` | anyone | Welcome message and version |
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
- A name that has a CNAME record cannot have any other record, and the zone
  itself cannot be a CNAME.
- Two identical records (same name, type and data) cannot exist in a zone.
- Every change to a record raises the serial of its zone.

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
| 404 | No such path, user, zone or record |
| 409 | The username, e-mail or zone name is already taken, the record already exists or conflicts with a CNAME, or the change would remove the last admin |

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
      if (record.zone.active) query.addAnswer(name, toRecord(record), record.ttl ?? record.zone.ttl);
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

## Logs

When logging is enabled, three files are written per day to the log folder:
`log-<date>.log` (general), `error-<date>.log` (failures) and
`security-<date>.log` (logins and every change to a user). Changes to zones and
records are written to the general log, with the name of the user who made them.

## Project layout

| Path | Contents |
| --- | --- |
| `api.js` | Entry point: connects to the database and starts the server |
| `app.js` | Express application, routes and error handling |
| `config/` | Configuration |
| `routes/` | HTTP endpoints |
| `services/` | Authentication, users, zones and records, logging and server start-up |
| `model/mongoDB/` | Database connection and data models |

## Release notes

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
