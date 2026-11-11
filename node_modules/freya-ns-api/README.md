# freya-ns-api

Management API for the Freya DNS server. It is the administrative side of the
name server: the place where the people who run it are managed, and where the
DNS entries it serves will be managed.

| Area | Status |
| --- | --- |
| User management (accounts, roles, passwords) | Available |
| Authentication (login, logout, token revocation) | Available |
| DNS entry management (zones and records) | Planned |

The server is built on Express 5 and MongoDB (Mongoose 9).

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

```
curl -X POST http://localhost:45451/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<password>"}'
```

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

### DNS entries

Not available yet. Managing the zones and records served by the DNS server is
the next part of this API.

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
| 404 | No such path or user |
| 409 | The username or e-mail is already taken, or the change would remove the last admin |

## Logs

When logging is enabled, three files are written per day to the log folder:
`log-<date>.log` (general), `error-<date>.log` (failures) and
`security-<date>.log` (logins and every change to a user).

## Project layout

| Path | Contents |
| --- | --- |
| `api.js` | Entry point: connects to the database and starts the server |
| `app.js` | Express application, routes and error handling |
| `config/` | Configuration |
| `routes/` | HTTP endpoints |
| `services/` | Authentication, users, logging and server start-up |
| `model/mongoDB/` | Database connection and data models |

## License

MIT
