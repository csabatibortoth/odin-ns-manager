# odin-ns-manager

The manager service of the Odin name server stack. It runs the DNS server, the
management API, its user interface and the DNS client side in one process. The
zones and records that are managed in the browser or through the API are stored
in MongoDB, and answered by the DNS server.

Current version: **2.8.1** - see the [release notes](#release-notes).

![The dashboard of the manager](docs/screenshots/dashboard.png)

It brings four packages together:

| Package | Role in the manager |
| --- | --- |
| [njord-ns-server](https://github.com/csabatibortoth/njord-ns-server) | The DNS server: answers queries over UDP and TCP, and looks up unknown names at upstream DNS servers. Its record classes and validators are what the zones are built of |
| [freya-ns-api](https://github.com/csabatibortoth/freya-ns-api) | The management API: zones and records, standalone records, blocking, monitoring, export and import, the HTTPS certificate, users, authentication, logging and the MongoDB connection |
| [bragi-ns-client](https://github.com/csabatibortoth/bragi-ns-client) | The DNS client: a cached replacement of `dns.lookup` for outgoing connections, and the DNSSEC validation of the forwarded addresses |
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
| Blocking: names that are not looked up, from block lists such as hosts files and from rules set by hand | Available |
| Monitoring: the query log, the clients and the most asked names | Available |
| DNSSEC validation of the forwarded addresses | Available, off by default |
| Export and import of the configuration | Available |
| HTTPS with a certificate of Let's Encrypt, or one of your own | Available |
| Swagger UI of the API at `/api/docs` | Available |
| Settings changed by the admins in the browser | Available |
| Graphs of the queries, the answer time, the memory and the cache | Available |
| Synchronization of several servers, secondaries copying from a primary | Available |
| E-mail: notifications and lost password links | Available |
| Plugins that extend the server | Available |
| Reporting to a Heimdall Monitoring System, as the plugin `heimdall` | Available |
| Zone transfers (AXFR) to secondary servers | Planned |
| User interface in the browser | Available |
| Themes: Default and Aesir, each in a light and a dark mode | Available |

A query for a name of one of its own zones is answered by the server itself;
every other query is forwarded to the upstream DNS servers. The zones, the users
and the service itself are managed in the browser, or through the API.

## Requirements

- Node.js 22 or newer
- A MongoDB server the manager can reach, for the management API and the zones.
  Without it the DNS server runs as a forwarder only.

## Installing as a service

The installers in `install/` set up a machine from nothing: they install
Node.js and MongoDB where they are missing, download the manager, ask the
questions of the configuration, and run it as a service that starts with the
system. The same script updates and uninstalls it.

**Linux** - Debian, Ubuntu, Raspberry Pi OS, CentOS / RHEL / Rocky / Alma (8 or
newer) and Alpine:

```
curl -fsSLO https://raw.githubusercontent.com/csabatibortoth/odin-ns-manager/master/install/install.sh
sudo sh install.sh install
```

**Windows** - 10, 11 or Server 2016 and newer, in PowerShell:

```
Invoke-WebRequest https://raw.githubusercontent.com/csabatibortoth/odin-ns-manager/master/install/install.ps1 -OutFile install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1 install
```

| Command | What it does |
| --- | --- |
| `install` | Installs what is missing, asks the questions, and starts the service |
| `update` | Brings the program to the newest version of its branch, and restarts it. The settings and the data stay |
| `configure` | Asks the questions again, with the current values as the defaults |
| `status` | The version, the addresses and the state of the service |
| `uninstall` | Removes the service and the program. Asks before the settings, the logs or the database are removed |

Without a command the script shows a menu. `--branch develop` (`-Branch` on
Windows) installs another branch, a tag or a commit; `--source <folder>`
installs from a copy of the project instead of the repository; `--yes` asks
nothing, and takes its answers from the `ODIN_*` variables that the head of
each script lists.

The questions are: the name of the server, the address and port of the DNS
server, the upstream servers, DNSSEC, the query log, the port of the user
interface or HTTPS with Let's Encrypt, where the database is, and the first
admin account. Their answers are saved as settings, so they can be changed on
the Settings page afterwards; only the key of the tokens, the database and the
folders are fixed in `odin.env`.

| | Linux | Windows |
| --- | --- | --- |
| Program | `/opt/odin-ns-manager` | `C:Program FilesOdinNsManager` |
| `odin.env` | `/etc/odin-ns-manager` | `C:ProgramDataOdinNsManager` |
| Settings, certificates | `/var/lib/odin-ns-manager` | `C:ProgramDataOdinNsManager` |
| Logs | `/var/log/odin-ns-manager` | `C:ProgramDataOdinNsManagerlogs` |
| Service | systemd, or OpenRC on Alpine; the user `odin` | A task of the Task Scheduler, as Local Service |
| Node.js | NodeSource packages; `apk` on Alpine; the build of nodejs.org on 32-bit ARM | winget, or the installer of nodejs.org |

Where MongoDB comes from depends on the system, as its makers do not build it
for all of them:

| System | MongoDB |
| --- | --- |
| Ubuntu (x86-64, ARM64), Debian (x86-64), CentOS / RHEL family | The packages of repo.mongodb.org, when they exist for the release; or a Docker container |
| Raspberry Pi OS 64-bit, Debian on ARM64, Alpine | A Docker container. MongoDB 4.4 on a processor without ARMv8.2 (Raspberry Pi 4) or without AVX |
| Raspberry Pi OS 32-bit | A MongoDB server on another machine |
| Windows | winget (`MongoDB.Server`) |

A MongoDB server that runs already, on the machine or elsewhere, can always
be chosen instead.

On Linux, when the DNS server is to listen on port 53 of every address, the
installer offers to switch off the listener of systemd-resolved, which holds
`127.0.0.53:53`; uninstalling switches it on again. It also offers to open the
ports in ufw, firewalld or the Windows firewall.

## Getting started

To run the manager from its folder, as for development:

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
| `ODIN_NS_RECURSION_ALLOWED` | loopback and private networks | Comma separated addresses and CIDR ranges of the clients that may use this server as a resolver. Everybody else gets `REFUSED` for names that are not in one of your own zones. See [Who may use the resolver](#who-may-use-the-resolver) |
| `ODIN_NS_UPSTREAM_TIMEOUT` / `ODIN_NS_UPSTREAM_TRIES` | `2000` / `2` | Milliseconds to wait for an upstream answer, and the number of attempts |
| `ODIN_NS_CACHE_ENABLED` | `true` | Keep answers in memory |
| `ODIN_NS_CACHE_MAX_ENTRIES` | `10000` | Size of the cache; the oldest entry is dropped when it is full |
| `ODIN_NS_NEGATIVE_CACHE_TTL` | `30` | Seconds a "no such name" or "no such record" answer is kept |
| `ODIN_NS_DNSSEC` | `off` | [DNSSEC](#dnssec) for the forwarded addresses: `off`, `validate` (the signatures are verified here) or `trust-ad` (the validation of the upstream is trusted) |
| `ODIN_NS_BLOCKLIST_REFRESH` | `24` | Hours between two downloads of a block list. The switch of the [blocking](#blocking) and its answer are kept in the database, and set on the Blocking page |
| `ODIN_NS_QUERY_LOG_ENABLED` | `true` | Record the queries for the [monitoring](#monitoring) |
| `ODIN_QUERY_LOG_RETENTION_DAYS` | `30` | Days a recorded query is kept. `0`: the queries are counted, but not stored |
| `ODIN_METRICS_RETENTION_DAYS` | `365` | Days the hourly metrics are kept. `0`: forever |

### Management API

| Variable | Default | Purpose |
| --- | --- | --- |
| `ODIN_API_ENABLED` | `true` | Start the management API. Set to `false` to run the DNS server only; the zones of the database are still served |
| `ODIN_HTTP_ENABLED` / `ODIN_HTTP_PORT` | `true` / `45451` | Plain HTTP listener |
| `ODIN_HTTPS_ENABLED` / `ODIN_HTTPS_PORT` | `false` / `45452` | HTTPS listener; takes precedence over HTTP when enabled. See [HTTPS](#https) |
| `ODIN_HTTPS_CERT_SOURCE` | `custom` | Where the certificate comes from: `custom` (files of your own) or `letsencrypt` |
| `ODIN_HTTPS_KEY` / `ODIN_HTTPS_CERT` | `sslcert/server.key` / `sslcert/server.crt` | `custom`: the private key and the certificate, in PEM |
| `ODIN_HTTPS_KEY_PASSPHRASE` | – | `custom`: the passphrase of the private key, when it is encrypted |
| `ODIN_HTTPS_DOMAINS` | – | `letsencrypt`: the public names of this server, comma separated. Required |
| `ODIN_ACME_EMAIL` / `ODIN_ACME_DIRECTORY` | – / `production` | `letsencrypt`: the e-mail of the account, and `production`, `staging` or the directory URL of another ACME authority |
| `ODIN_ACME_HTTP_PORT` / `ODIN_ACME_FOLDER` | `80` / `sslcert/letsencrypt` | `letsencrypt`: the port that answers the challenge, and where the keys are kept |
| `ODIN_ACME_CHALLENGE` | `http-01` | `letsencrypt`: how the names are proven: `http-01` (port 80), `dns-01` (a TXT record; wildcards), or `auto` (DNS for a wildcard, HTTP for the rest) |
| `ODIN_ACME_DNS_PROVIDER` | `zones` | `dns-01`: where the record is written: `zones` (a zone of this server), `delegation` (a CNAME at any DNS to a zone of this server), `cloudflare` |
| `ODIN_ACME_DELEGATION_ZONE` | – | `delegation`: a zone hosted on this server, e.g. `acme.example.net` |
| `ODIN_ACME_CLOUDFLARE_TOKEN` / `ODIN_ACME_CLOUDFLARE_TOKEN_FILE` / `ODIN_ACME_CLOUDFLARE_ZONE_ID` | – | `cloudflare`: an API token limited to one zone (`Zone: DNS: Edit`, `Zone: Zone: Read`), or a file whose first line is the token (only from the environment); the zone id is optional |
| `ODIN_ACME_DNS_WAIT` | `120` | `dns-01`: seconds to wait until the record is answered |
| `ODIN_DOCS_ENABLED` | `true` | The Swagger UI of the API at `/api/docs` |
| `ODIN_MONITORING_ROLES` | `admin` | Roles that may read the query log, the clients and the metrics |
| `ODIN_AUTH_ENABLED` | `true` | Set to `false` to skip token checks. For local development only |
| `ODIN_UI_ENABLED` | `true` | Serve the user interface next to the API |
| `ODIN_DNS_WRITE_ROLES` | `admin` | Roles that may change zones, records and the blocking, comma separated, e.g. `admin,user`. Every signed-in user may read them |
| `ODIN_DB_ADDRESS` / `ODIN_DB_PORT` / `ODIN_DB_NAME` | `127.0.0.1` / `27017` / `odin-ns-manager-1` | MongoDB location |
| `ODIN_DB_USER` / `ODIN_DB_PWD` | `Test` / `Test` | MongoDB credentials; set the user to an empty value to connect without authentication |

These settings are handed to freya-ns-api as its own `FREYA_*` variables. A
`FREYA_*` variable that is set explicitly wins, and is also the way to reach
the settings that have no `ODIN_*` counterpart, such as `FREYA_DB_URI`,
`FREYA_TOKEN_EXPIRES_IN`, `FREYA_BLOCKLIST_MAX_SIZE_MB`, `FREYA_IMPORT_MAX_SIZE_MB` and
`FREYA_ADMIN_USER` / `FREYA_ADMIN_EMAIL` / `FREYA_ADMIN_PWD`. See the
[freya-ns-api documentation](https://github.com/csabatibortoth/freya-ns-api#configuration).

### Settings

The Settings page of the user interface shows every setting with its value and
where the value comes from, and lets the admins change them. What is saved
there is written to `config/settings.json` (`ODIN_SETTINGS_FILE` names another
file), which is not part of the repository.

- **At once** – the name of the server and the company, the upstream servers
  with their timeout and attempts, DNSSEC, the cache, the recording of the queries, and the time
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
  answered together with the records of its target. A record has its own
  TTL, or 3600 seconds.
- **Wildcards** – `*.dev.example` stands for every name below `dev.example`
  that has no standalone records of its own.
- **Zones come first** – a name inside one of the zones is answered by the
  zone: a standalone record for it is not served, so add it to the zone.

They are the standalone records of freya-ns-api (`/api/records`): the records
without a zone. A record without a TTL of its own is answered with 3600
seconds. They are kept in memory and refreshed together with the zones.

![The standalone records](docs/screenshots/records.png)

### Blocking

The server does not look up unwanted names: advertising, trackers, malware.
What is blocked is the blocking of freya-ns-api, managed on the Blocking page
or through `/api/blocking`, and comes from two places:

- **Block lists** – lists of names that are downloaded from their address,
  such as `https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts`.
  The lines of a hosts file (`0.0.0.0 ads.example.com`), plain names, and the
  `||ads.example.com^` rules of ad blockers are understood. A list is matched
  by the exact name.
- **Rules** – single domains that are blocked, or allowed, by hand, optionally
  with every name below them. A rule wins over the lists: the rule of the name
  itself decides, or else the nearest one above it that includes its subdomains.

How the server uses them:

- **The answer** – a blocked name gets the address `0.0.0.0` (`::` for AAAA,
  and an empty answer for the other types), or "no such name". It is not sent
  to the upstream. The answer, and the switch of all blocking, are the settings
  of the blocking: they are kept in the database, and changed on the Blocking
  page.
- **From memory** – the names and the rules are kept in memory, so a query
  never waits for the database. A change is picked up when its request is
  done, and within 15 seconds when it was made elsewhere.
- **Own names come first** – the names of the zones and the standalone records
  are never blocked.
- **Refresh** – a list is downloaded again every `ODIN_NS_BLOCKLIST_REFRESH`
  hours, and on request. When a download fails, the names of the last one stay
  in use, the reason is shown with the list, and it is tried again 15 minutes
  later. (`FREYA_BLOCKLIST_REFRESH_CRON` adds a schedule by the clock.)
- **Check** – the Blocking page tells whether a domain is blocked, and why.

The lists and the rules are changed by the roles in `ODIN_DNS_WRITE_ROLES`.
The server downloads whatever address it is given: leave those roles to the
people who are trusted with that. A download is limited to 64 MB.

![The blocking: its switch, the block lists and the rules](docs/screenshots/blocking.png)

### Monitoring

The DNS server reports every query it answered to the monitoring of
freya-ns-api: the client, the name, the type, the response code, whether it was
blocked, and how long the answer took. They are noted in memory and written
every five seconds, so a query never waits for the database.

- **Queries** – the query log, with filters for the name, the client, the type
  and the answer. A name can be blocked or allowed straight from it.
- **Clients** – every address that sent a query, with its counters. A client
  can be given a name.
- **Dashboard** – the totals of the last 24 hours, the most asked and the most
  blocked names, and the busiest clients.

The queries show what every client looks up, so the monitoring can only be
read by the roles in `ODIN_MONITORING_ROLES`. `ODIN_NS_QUERY_LOG_ENABLED=false`
switches the recording off; `ODIN_QUERY_LOG_RETENTION_DAYS` and
`ODIN_METRICS_RETENTION_DAYS` say how long the data is kept.

![The query log](docs/screenshots/queries.png)

### DNSSEC

With `ODIN_NS_DNSSEC` the addresses (A and AAAA) the upstream answers are
checked with the DNSSEC validation of bragi-ns-client before they are passed
on. It is off by default.

| Mode | Who validates | Cost |
| --- | --- | --- |
| `validate` | This server: the signatures are verified up to the root keys | A few extra queries for the first lookup in a domain |
| `trust-ad` | The upstream; its "authentic data" flag is believed. Only for an upstream that validates, over a network you trust | One extra query |

- A **forged or broken** answer of a signed domain is refused: the client gets
  a server failure, as from any validating resolver.
- For a **signed** domain nothing but the validated addresses is answered.
- A domain that is **not signed** – most of them – is answered as before.
- The other record types are not checked, and the answers of this server are
  not signed themselves.

The dashboard counts the checked lookups, and the Lookup page shows what
DNSSEC said about a name. The `validate` mode needs a correct system clock,
and an upstream that hands over the DNSSEC records, which nearly all do.

![Lookup of a signed name: DNSSEC signed and valid](docs/screenshots/lookup-dnssec.png)

### Who may use the resolver

A DNS server that answers recursive questions for everybody who can reach it is
an *open resolver*: it is used to amplify attacks on other networks. So the
names that are **not** in one of your own zones (or standalone records) are
answered only to the clients in `ODIN_NS_RECURSION_ALLOWED`; everybody else gets
`REFUSED`. Your own zones are answered for anybody, which is what an
authoritative server is for, and so is a question from this machine itself.

The default is safe: the loopback range, the private networks (`10.0.0.0/8`,
`172.16.0.0/12`, `192.168.0.0/16`), the shared address space of VPNs such as
Tailscale (`100.64.0.0/10`), link-local addresses, and their IPv6 counterparts
(`::1`, `fc00::/7`, `fe80::/10`). Set the list in the settings (group
*Forwarding*; it applies at once) or in the environment, e.g.
`ODIN_NS_RECURSION_ALLOWED=192.168.1.0/24,203.0.113.7`. An empty list serves
nobody but this machine. To run a public resolver on purpose, add `0.0.0.0/0`
and `::/0`; do that only behind your own rate limiting.

The dashboard counts the refused queries (a tile, a row in the DNS server card, and the
counter `refused` of the Heimdall metric `aesir.dns.queries`). Administrators and
the monitoring roles can see the clients that were refused most often at
`GET /api/service/refused`. That table is kept in memory only (at most 200
clients, it is gone at a restart), and refused queries are not written to the
query log: anybody on the internet can send them.

**When upgrading:** a server that was reachable from the internet and answered
everybody now refuses the public clients. The clients of your own networks are
unaffected. If you serve other public addresses on purpose, add their ranges.

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

## Synchronization

Several installed servers can hold the same zones, records and blocking. One of
them is the **primary**; the others are **secondaries** that copy from it. The
primary needs no setting: it only needs an admin account that the secondaries
sign in with (a dedicated one is best).

On a secondary, open [Settings](#settings), group *Synchronization*, and set:

| Setting | Variable | Meaning |
| --- | --- | --- |
| Copy from a primary server | `ODIN_SYNC_ENABLED` | Switches it on |
| Address of the primary | `ODIN_SYNC_URL` | For example `https://primary.example.com:45452` |
| Admin user / password | `ODIN_SYNC_USER`, `ODIN_SYNC_PASSWORD` | The account on the primary |
| Synchronize every (minutes) | `ODIN_SYNC_INTERVAL` | Default 15 |
| What to copy | `ODIN_SYNC_SECTIONS` | `zones`, `records`, `blocking`, `users` (default: the first three) |
| What is here already | `ODIN_SYNC_EXISTING` | `overwrite` (default) or `skip` |
| Accept a certificate that is not trusted | `ODIN_SYNC_INSECURE` | For a primary with a certificate of its own |

Every run reads `/api/backup/export` of the primary and imports it here, like
the import of the Backup page does. The **Synchronization** page of the
interface shows the last run and can start one at once. The password is better
kept in the environment than in the settings file.

The copy goes one way, and an import never deletes: a zone that was deleted on
the primary has to be deleted on the secondaries as well. Changes made on a
secondary are overwritten by the next run, so change things on the primary.
Copy the users only when the same accounts are wanted everywhere: their
password hashes are copied with them.

## E-mail

The server can send e-mails: notifications to the admins, lost password links,
and what [plugins](#plugins) send. Set it up in [Settings](#settings), group
*E-mail*:

| Setting | Variable | Meaning |
| --- | --- | --- |
| Send e-mails | `ODIN_MAIL_ENABLED` | Switches it on |
| SMTP server, port, connection | `ODIN_MAIL_HOST`, `ODIN_MAIL_PORT`, `ODIN_MAIL_SECURITY` | `starttls` (587), `tls` (465) or `none` |
| SMTP user / password | `ODIN_MAIL_USER`, `ODIN_MAIL_PASSWORD` | Empty for a server without login |
| Sender address | `ODIN_MAIL_FROM` | For example `Odin NS <odin@example.com>` |
| Notify these addresses | `ODIN_MAIL_ADMINS` | Get a mail when the synchronization fails, and when it works again |
| Address of this interface | `ODIN_PUBLIC_URL` | For the links in the mails |

The *Send a test e-mail* button of the group checks the settings.

**Lost password.** When e-mail is set up and the address of the interface is
given, the sign in page offers *Forgot your password?*. The user enters the
e-mail address of their account and gets a link that works for one hour and one
use. The answer does not tell whether the address is known, and the requests
are limited. The links are kept in memory, so a restart makes them invalid.

## Plugins

A plugin is a folder in the `plugins` folder (`ODIN_PLUGINS_FOLDER`). It can
add an API route, a page to the menu, jobs, and react to changes of the DNS
data and to synchronizations. Plugins run with the rights of the server: enable
only code you trust. A plugin runs when its name is in *Plugins that run*
(`ODIN_PLUGINS_ENABLED`, comma separated); changing it needs a restart. The
**Plugins** page lists what was found and what state it is in.
`plugins/example` shows all of it; see [docs/plugins.md](docs/plugins.md) for
the api.

`plugins/heimdall` makes the server an agent of the
[Heimdall Monitoring System](https://gitlab.com/heimdall-monitoring-system): it
sends the counters and the state of the DNS server, the zones, the blocking and
the cache as metrics, and what changed as logs. Add `heimdall` to *Plugins that
run*, restart, and enter the address of Heimdall, the UID and the license key of
the agent on its page (**Plugins > Heimdall**). The names that clients asked
for are never sent. See [plugins/heimdall/README.md](plugins/heimdall/README.md).

## HTTPS

Set `ODIN_HTTPS_ENABLED=true` to serve the API and the user interface over
HTTPS; the plain HTTP listener is not started then. The certificate comes from
one of two sources, `ODIN_HTTPS_CERT_SOURCE`:

- **`custom`** (default) – a private key and a certificate of your own, in
  `sslcert/server.key` and `sslcert/server.crt` of this project. They can be
  replaced without a restart: on the Certificate page, or by overwriting the
  files, which the server notices within the hour.
- **`letsencrypt`** – the server requests a certificate for the names in
  `ODIN_HTTPS_DOMAINS` on the first start, and renews it by itself. Every name
  must lead to this server in the public DNS, and port 80 must reach it from
  the internet. Try it with `ODIN_ACME_DIRECTORY=staging` first.

  With `ODIN_ACME_CHALLENGE=dns-01` (or `auto`) the names are proven through a
  TXT record instead of port 80, which also allows wildcard names such as
  `*.example.com`. The record is written into a zone of this server
  (`zones`), through a CNAME that you add once at any DNS host
  (`delegation`), or through the API of Cloudflare (`cloudflare`). The settings
  are in the group *HTTPS certificate*; they take effect at the next start. The
  Cloudflare token is write-only: it is never shown again, and the settings file
  is readable by its owner only. See the
  [freya-ns-api documentation](https://github.com/csabatibortoth/freya-ns-api#dns-validation-dns-01).
  Needs freya-ns-api 2.4.0 or later.

The Certificate page has a button **Test with Let's Encrypt staging**: it runs a
whole order with the real settings (names, challenge, provider) against the
staging authority, shows every step (`record written`, `record visible`,
`record removed`, `authority validated the names`, ...) and the reason when one
fails, and installs nothing. Use it after changing the names, the challenge or
the provider (needs freya-ns-api 2.5.0 or later; the button is not shown with an
older one).

The Certificate page shows the certificate that is served and when it expires,
how its names are proven, and, for the delegation, the CNAME records to add at
the DNS of your domains. The Heimdall plugin sends `aesir.certificate.days_left`,
and a mail is sent when a renewal fails or fewer than 14 days are left.
The keys are kept under `sslcert/`, which is not part of the repository. See
the [freya-ns-api documentation](https://github.com/csabatibortoth/freya-ns-api#https)
for the details.

## User interface

The user interface is served by the HTTP(S) server of the management API, at
`http://localhost:45451` by default, and works with the same accounts. It is
built on [Athena UI](https://github.com/csabatibortoth/athena-ui) (2.6) and jQuery,
which are served from their packages: the page loads nothing from other servers.
Athena UI itself has no jQuery since 2.0; the manager's own pages and the plugin API (`$page`) still use it.
The pages are made of the components of Athena UI: its menu with submenus,
tabs, cards, stats, badges, buttons, pagination, breadcrumbs, the fields of the
forms, toasts and dialogs, and its router.

The menu has the groups Dashboard, DNS, Monitoring, Service and, for the
signed-in user, their name:

- **On a wide screen** (1000 pixels and more) it is the bar of the header, and
  every group opens as a dropdown. The user menu, with the account and signing
  out, is at the right end of it.
- **On a tablet and a phone** it is a bar of tabs at the bottom of the screen,
  within reach of the thumb. A group opens as a sheet above the bar, and a
  touch anywhere else closes it.

On a phone the rows of the tables are shown as blocks, so nothing has to be
scrolled sideways.

Notices (a saved zone, a failure) appear at the bottom right of the window, above the tabs on a phone, so they never cover the buttons
at the top of a page. The graphs of the dashboard can be read with the keyboard: Tab to the graph, then the arrow keys move from value to value
(Home and End go to the first and the last, Esc hides the value).

| | | |
| --- | --- | --- |
| ![The dashboard on a phone](docs/screenshots/mobile-dashboard.png) | ![The menu on a phone](docs/screenshots/mobile-menu.png) | ![The records of a zone on a phone](docs/screenshots/mobile-records.png) |
| **Dashboard** on a phone | **The menu**: a group opens as a sheet above the bar | **A table**: every row is a block |

### Themes

The button at the right of the header, and the Appearance card of the Account
page, choose the look of the interface: a theme, and a mode.

| Theme | Colors |
| --- | --- |
| **Default** | The look of the releases before 2.5.0: blue and grey |
| **Aesir** | Navy `#000099`, orange `#FFA500` and grey `#71797E`, with white and black. Text is black on white, or white on black; navy is the header and the buttons in the light mode, and orange the buttons and links in the dark one, where navy would not show |

Every theme is made in a light and a dark mode. **Like the system** follows the
light or dark mode of the operating system and changes with it, and is the
default. The choice is kept in the browser, so it is the same on the sign in page,
and is different on every device.

| | |
| --- | --- |
| ![The Aesir theme, light](docs/screenshots/theme-aesir.png) **Aesir**, light | ![The Aesir theme, dark](docs/screenshots/theme-aesir-dark.png) **Aesir**, dark |
| ![The menu of the look of the interface](docs/screenshots/appearance-menu.png) **The menu of the header**: the theme and the mode | |

A theme is a block of colors in `ui/css/themes.css` for each mode, and an entry
in `THEMES` of `ui/js/theme.js`; nothing in the stylesheet `ui/css/theme.css`
has a color of its own. The text and the background of the Aesir theme are
checked against the contrast of WCAG AA (4.5 for text, 3 for lines and markers).

| Page | Who | What it does |
| --- | --- | --- |
| Dashboard | signed in | Graphs of the queries per minute, the answer time, the memory and the cache, over the last 15 minutes to 24 hours; and the state of the service, the DNS server, the zones and the upstream servers. Admins can reload the zones and clear the cache |
| Zones | signed in | List and search the zones; add, edit and delete them |
| *a zone* | signed in | The SOA record and the records of a zone; add, edit and delete records |
| Records | signed in | The standalone records, which belong to no zone; add, edit and delete them |
| Blocking | signed in | The switch and the answer of the blocking, the block lists with their state and their names, the rules, and the check of a domain |
| Lookup | signed in | Asks the DNS server for a name, and shows where the answer came from: a zone, the standalone records, the blocking or the upstream, and what DNSSEC said |
| Queries | monitoring roles | The query log, with its filters; block or allow a name from it |
| Clients | monitoring roles | The clients of the DNS server and their counters; name or forget them |
| Users | admin | List, add, edit and delete users, and set their passwords |
| Logs | admin | The general, error and security log of a day |
| Backup | admin | Export the zones, records, blocking and users as a file, and import such a file |
| Certificate | admin | The certificate of HTTPS; renew it, or replace your own |
| Settings | admin | The configuration of the server; see [Settings](#settings) |
| API docs | signed in | Opens the Swagger UI of the API |
| Account | signed in | Your own account: display name, e-mail and password, and for admins the username |

Zones, records and the blocking can be changed by the roles in `ODIN_DNS_WRITE_ROLES`; the
other users see them read-only.

The history behind the graphs is kept in memory: a sample every 10 seconds for
the last hour, and one per minute for the last day. It starts empty after a
restart. Every graph has its values as a table below it.

![The values of a graph, at the pointer and as a table](docs/screenshots/dashboard-graph.png)

### Screenshots

The screenshots (retaken for 2.7.0) are of a demo installation with sample zones and records, a block list of generated names, and generated queries from a few clients.

| | |
| --- | --- |
| ![Sign in](docs/screenshots/login.png) **Sign in** | ![Dashboard](docs/screenshots/dashboard.png) **Dashboard**: figures and graphs of the chosen period |
| ![The values of a graph](docs/screenshots/dashboard-graph.png) **A graph**: the values at the pointer, and all of them as a table | ![The most asked names](docs/screenshots/dashboard-top.png) **Dashboard**, further down: the last 24 hours, the most asked and most blocked names, the busiest clients |
| ![The state of the service](docs/screenshots/dashboard-state.png) **Dashboard**, at the end: the state of the service, with its build | ![Zones](docs/screenshots/zones.png) **Zones** |
| ![The records of a zone](docs/screenshots/zone-records.png) **The records of a zone** | ![Adding a record](docs/screenshots/add-record.png) **Adding a record**: the fields follow the type |
| ![A record that is not valid](docs/screenshots/record-validation.png) **A value that is not valid** is marked at its field | ![The record is added](docs/screenshots/record-added.png) **Saved**: the serial of the zone is raised |
| ![Standalone records](docs/screenshots/records.png) **Records**: the standalone records, without a zone | ![Adding a standalone record](docs/screenshots/add-standalone-record.png) **Adding a standalone record**, with its whole name |
| ![Blocking](docs/screenshots/blocking.png) **Blocking**: the switch, the answer and the block lists | ![Adding a block list](docs/screenshots/add-blocklist.png) **Adding a block list** by its address |
| ![The check of a domain](docs/screenshots/blocking-check.png) **Is a domain blocked?** The answer, and what decides it | ![The rules](docs/screenshots/blocking-rules.png) **Rules**: domains blocked or allowed by hand |
| ![Adding a rule](docs/screenshots/add-rule.png) **Adding a rule**, for a domain and the names below it | ![Lookup](docs/screenshots/lookup.png) **Lookup**, answered from an own zone |
| ![Lookup of a blocked name](docs/screenshots/lookup-blocked.png) **Lookup** of a name that is blocked | ![Lookup with DNSSEC](docs/screenshots/lookup-dnssec.png) **Lookup** of a signed name, validated with DNSSEC |
| ![Queries](docs/screenshots/queries.png) **Queries**: the query log, with a button to block or allow a name | ![Clients](docs/screenshots/clients.png) **Clients**, with the names they were given |
| ![Backup](docs/screenshots/backup.png) **Backup**: export and import | ![Settings](docs/screenshots/settings.png) **Settings**: where a value comes from, and when a change applies |
| ![Editing settings](docs/screenshots/settings-edit.png) **Editing the settings** of a group | ![Users](docs/screenshots/users.png) **Users** |
| ![Account](docs/screenshots/account.png) **Account**: the profile and the password of the signed-in user | ![Logs](docs/screenshots/logs.png) **Logs** |
| ![Dark mode](docs/screenshots/zones-dark.png) **Dark mode** | ![The dashboard in dark mode](docs/screenshots/dashboard-dark.png) **Dashboard** in dark mode |
| ![The Aesir theme](docs/screenshots/theme-aesir.png) **Aesir** theme, light | ![The Aesir theme in dark mode](docs/screenshots/theme-aesir-dark.png) **Aesir** theme, dark |
| ![The blocking in dark mode](docs/screenshots/blocking-dark.png) **Blocking** in dark mode | ![The query log on a phone](docs/screenshots/mobile-queries.png) **On a phone**: the query log |

## Management API

All paths are under `/api`. Requests and responses are JSON. After logging in,
send the token with every request as `Authorization: Bearer <token>`.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/` | signed in | Welcome message |
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
| GET, POST, PATCH, DELETE | `/records`, `/records/:recordId` | signed in, admin | The standalone records: `{ name, type, data, ttl?, active? }`, with a fully qualified name |
| GET, PATCH | `/blocking/settings` | signed in, admin | The switch and the answer of the blocking: `{ enabled, mode }` |
| GET | `/blocking/check?domain=` | signed in | Whether a domain is blocked, and why |
| GET, POST, PATCH, DELETE | `/blocking/lists`, `/blocking/lists/:listId` | signed in, admin | The block lists: `{ name, url, description?, active? }`; `.../refresh` downloads, `.../entries` lists the names |
| GET, POST, PATCH, DELETE | `/blocking/rules`, `/blocking/rules/:ruleId` | signed in, admin | The rules: `{ domain, action, includeSubdomains?, comment?, active? }` |
| GET, DELETE | `/monitoring/queries` | monitoring roles | The query log |
| GET | `/monitoring/metrics`, `/monitoring/top` | monitoring roles | The counters of a period, and the most asked names and busiest clients |
| GET, PATCH, DELETE | `/monitoring/clients`, `/monitoring/clients/:clientId` | monitoring roles | The clients |
| GET, POST | `/backup/export`, `/backup/import` | admin | Everything as one JSON document, and reading it back |
| GET, PUT | `/certificate`; POST `/certificate/renew` | admin | The certificate of HTTPS |
| GET | `/docs`, `/docs/openapi.json` | anyone | Swagger UI, and the OpenAPI description |

Everything but the login, the docs and `/service/info` needs a token: without one the
answer is 401, also for a path that does not exist.

Zones, records and the blocking can be read by every signed-in user, and changed by the roles
in `ODIN_DNS_WRITE_ROLES`. The SOA record of a zone and its serial are kept by
the API; the serial is raised on every change.

```
curl -X POST http://localhost:45451/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<password>"}'
```

These endpoints are the ones of freya-ns-api; see its
[documentation](https://github.com/csabatibortoth/freya-ns-api#api) for the
details of every endpoint, or open `/api/docs`.

The manager adds these, for the service itself:

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/service/info` | anyone | Name, version and build, and whether signing in is needed |
| GET | `/service/status` | signed in | The state of the service, the DNS server, the zones, the blocking, the monitoring, DNSSEC and the cache |
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
records and blocked names that are held in memory, and change the settings in a
temporary file; they need no database.

## Project layout

| Path | Contents |
| --- | --- |
| `server.js` | Entry point: starts the DNS server, the management API and the user interface |
| `config/` | Configuration: the settings, their defaults, and the file the admins save them to |
| `services/serverService/blockService.js` | The blocking: loading the lists and rules from MongoDB, answering from memory, and the refresh of the lists |
| `services/serverService/queryLogService.js` | Reports the answered queries to the monitoring |
| `services/serverService/zoneService.js` | The own zones and standalone records: loading from MongoDB and answering from memory |
| `services/serverService/searchService.js` | Upstream lookups, their DNSSEC check and the in-memory cache |
| `services/serverService/statusService.js` | Counters of the DNS server and their history, for the dashboard |
| `services/serverService/buildInfo.js` | The build number of the running server |
| `services/apiService/apiService.js` | Database connection, start and stop of the management API, logging |
| `services/apiService/serviceRoutes.js` | The `/api/service` endpoints |
| `services/serverService/syncService.js` | The synchronization with a primary server |
| `services/serverService/mailService.js` | Sending e-mails, and the notifications |
| `services/serverService/passwordResetService.js` | The lost password links |
| `services/pluginService/pluginService.js` | Loads the plugins |
| `plugins/` | The plugins; `example` is one to start from |
| `services/apiService/migration.js` | Carries the data of the releases before 2.3.0 over |
| `services/uiService/uiService.js` | Serves the user interface |
| `install/` | The installers for Linux (`install.sh`) and Windows (`install.ps1`), and what they share: the launcher of the service and the writer of the settings |
| `ui/` | The user interface: page, theme and scripts |
| `docs/screenshots/` | Screenshots of the user interface |
| `test/` | Tests |

## Release notes

### 2.9.0

#### Security

- **No open resolver.** Names that are not in your own zones are answered only to the clients of `ODIN_NS_RECURSION_ALLOWED` (default: loopback and private networks); others get `REFUSED`. Own zones stay open to everybody. See [Who may use the resolver](#who-may-use-the-resolver). **Check this when upgrading** if clients with public addresses use this server.
- The settings file is written readable by its owner only; it holds passwords and tokens.

#### New

- **Let's Encrypt with DNS validation** (needs freya-ns-api 2.4.0): wildcard names and no port 80, through a zone of this server, a CNAME at any DNS host, or Cloudflare. The Certificate page shows how the names are proven and the CNAME records to add.
- **Test button** on the Certificate page: a whole order against the Let's Encrypt staging authority with the real settings, step by step, nothing installed (freya-ns-api 2.5.0).
- **Certificate alerts**: the metrics `aesir.certificate.days_left` and `aesir.certificate.renewal_failing`, and a mail when a renewal fails or fewer than 14 days are left.
- The dashboard counts refused queries; the Heimdall metric `aesir.dns.queries` has the kind `refused`.

### 2.8.1

#### Changed

- **Athena UI 2.7.** Nothing of the pages changes: the library now keeps room for a chart legend, draws no gap under a chart and ships the page-header and field fixes
  that this application did not need a workaround for. The dependency is `^2.7.0`.

### 2.8.0

#### Changed

- **The user interface is built on Athena UI 2.6.** The workarounds that the manager had written around the missing parts of Athena UI are gone
  (about 40 lines of script and 80 of the stylesheet): the menu switches between the bar and the tabs by the option `breakpoint` (1000 pixels, as
  before) instead of its own listener and a rebuild, the tables of a phone are drawn by the option `stack` of Athena UI, and the label of the
  value field of a record no longer has to answer for the empty form.
- **Notices are at the bottom right** (above the tabs on a phone). At the top right they covered the buttons of a page, like Add zone, for
  six seconds after every save.
- **The graphs of the dashboard have no dots** on their lines, so a window that is half filled looks like a full one, the time in the table of values
  is short ("Nov 20, 11:17:57 AM") and the graphs can be read with the keyboard: the arrow keys move from value to value, Home and End go to the first
  and the last, Esc hides the value. A value that stands alone between two gaps has a tooltip of its own.

#### Upgrading from 2.7.0

- Update and restart; nothing has to be changed. Reload the page in the browser once (Ctrl+F5) so it does not keep the old stylesheet.

### 2.7.0

#### Changed

- **The user interface is built on Athena UI 2.4** (it was 1.x). What you see is the same, what is different is underneath: dialogs are native
  `<dialog>` elements (the browser traps the focus, closes them with Esc and draws the backdrop), the dropdown of the appearance menu is a native
  popover, nothing writes an inline style any more (the content security policy of the interface had to be worked around for Athena UI 1.x), and
  the plain controls come back as elements, which the manager wraps in jQuery as before. The plugin API is unchanged: `$page` is still a jQuery element
  and `ui` has the same functions.
- The stylesheet follows: the rules for the old dialog backdrop are gone, the dialog is styled as `dialog.dialog` with the padding of `.dialog-inner`.
- **The manager's own copies of what Athena UI has are gone** (about 400 lines of the interface and 160 of its stylesheet): the theme and mode
  (`createThemeManager`, the same saved choice), the menu (`generateMenu`: a bar in the header, tabs at the bottom of the screen below 1000 pixels), the forms
  (`generateForm` and `showFormDialog`: fields that depend on others, nested names, the messages of the API at their fields), the tables (`generateTable`) and the
  line charts (`generateChart`: a line breaks where nothing was measured, the axis is the whole range that was asked for, a table of the values below).
  The graphs show their values when a point is reached with Tab or the pointer; the arrow keys that moved the crosshair are gone.

#### Fixed

- **The form of a record had no label above the field for its value** (the address of an A record, the target of a CNAME ...): the label depends on the type, and was asked for before there was a type.

#### Upgrading from 2.6.1

- Update and restart; nothing has to be changed. Reload the page in the browser once (Ctrl+F5) so it does not keep the old stylesheet.

### 2.6.1

#### Fixed

- **A plugin could not start on an installation**: `EACCES: permission denied, mkdir '/opt/odin-ns-manager/plugins/heimdall/data'`. The data
  folder of a plugin (`api.dataFolder`) was made inside the plugin folder, which is part of the program and read-only for the service.
  It is now `plugin-data/<name>` next to `settings.json` (`/var/lib/odin-ns-manager/plugin-data/<name>` on an installation), readable by
  the service only. A plugin that already has a `data` folder of its own keeps using it.

#### Upgrading from 2.6.0

- Update and restart. The settings of the heimdall plugin were never saved on an installation (it could not start), so enter the address,
  the agent UID and the license key on its page once more.

### 2.6.0

#### Added

- **The plugin `heimdall`**: reports the server to a Heimdall Monitoring System
  as one of its agents. Metrics of the queries (by kind, as counters), the answer
  time, the memory, the zones, the blocking, the cache and the query log, and
  logs of changes and failures. It has a page of its own for the connection, and
  keeps the license key out of the interface and the log. The names and the
  clients of the queries are never sent. See
  [plugins/heimdall/README.md](plugins/heimdall/README.md).

#### Upgrading from 2.5.1

- There are no new dependencies. The plugin is off until `heimdall` is in
  *Plugins that run* (a restart is needed), and does nothing until it has an
  address, an agent UID and a license key.

### 2.5.1

#### Changed

- **New screenshots** of every page, made of the interface of 2.5: the light and
  the dark mode, the phone, and the Aesir theme.
- On a wide screen the tabs of the settings wrap into a second row instead of
  being scrolled sideways.

#### Upgrading from 2.5.0

- There are no new dependencies, and nothing has to be changed.

### 2.5.0

The user interface is reworked: a new icon, a new menu, themes, and more of
Athena UI in use.

#### Added

- **Themes.** The Default theme, which is the look of the earlier releases, and
  the new Aesir theme in navy, orange and grey. Both are made in a light and a
  dark mode, and the mode can follow the system. The choice is in the header
  and on the Account page, and is kept in the browser. See [Themes](#themes).
- **A new icon:** the rune Ansuz, the rune of the Aesir, as a flat icon.

#### Changed

- **A new menu.** A bar in the header with a dropdown for every group on a wide
  screen, and a bar of tabs at the bottom with sheets for the groups on a
  tablet and a phone, instead of the sidebar and its drawer.
- **More of Athena UI.** The buttons, badges, cards, figures of the dashboard,
  pagination, breadcrumbs, the fields of the forms and the dialogs of the forms
  are the ones of Athena UI, and the settings are in tabs. The pages are routed
  by its router. The stylesheet builds on its default theme.
- The page title shows the page that is open.

#### Not changed

- The tables with buttons and badges in their cells, and the graphs of the
  dashboard, are the manager's own: the table of Athena UI shows text only, and
  its graphs have no tooltip and no table of values.
- The API, the settings and the plugin API (`ui.card`, `ui.button`, ...) are
  the same.

#### Upgrading from 2.4.0

- There are no new dependencies, and nothing has to be changed.

### 2.4.0

Several servers can be kept in step, the server can send e-mails, and plugins
can extend it. Updates athena-ui-js to 1.0.0.

#### Added

- **Synchronization.** A secondary server copies the zones, records, blocking
  and, if wanted, the users of a primary on a schedule, through its export and
  import API. New Synchronization page. See [Synchronization](#synchronization).
- **E-mail.** SMTP settings with a test e-mail, notifications to the admins
  when the synchronization fails and when it works again, and lost password
  links on the sign in page. See [E-mail](#e-mail).
- **Plugins.** Folders in `plugins/` with their own API routes, pages in the
  menu, jobs and events, and a Plugins page. `plugins/example` is a plugin to
  start from. See [Plugins](#plugins) and [docs/plugins.md](docs/plugins.md).
- Secret settings, such as the SMTP password, can be changed on the Settings
  page; their values are never shown.

#### Changed

- athena-ui-js 0.4.1 → 1.0.0. The notices are its toasts, and the questions
  before a delete are its dialogs.
- New settings groups E-mail, Synchronization and Plugins; every setting has an
  `ODIN_*` variable.

#### Upgrading from 2.3.0

- Run `npm install`. Nothing has to be changed: the new features are off until
  they are set up.
- A plugin runs with the rights of the server. Enable only plugins you trust.

#### Not yet included

- The synchronization is one way and never deletes: what is deleted on the
  primary has to be deleted on the secondaries as well.
- The lost password links are kept in memory, so a restart makes them invalid.
- Zone transfers (AXFR) are refused, and responses have no authority section.

### 2.3.0

Updates freya-ns-api to 2.3.1 and bragi-ns-client to 2.1.0, and puts what they
brought to use.

#### Added

- **Monitoring.** The DNS server reports its queries to the monitoring of
  freya-ns-api. New Queries and Clients pages, and the most asked names, the
  most blocked names and the busiest clients on the dashboard. See
  [Monitoring](#monitoring).
- **Block rules.** Single domains blocked or allowed by hand, with or without
  the names below them, and a check that tells why a domain is blocked. The
  names of a block list can be looked through. See [Blocking](#blocking).
- **DNSSEC** for the forwarded addresses, with the validation of
  bragi-ns-client 2.1: `ODIN_NS_DNSSEC`. See [DNSSEC](#dnssec).
- **Backup page:** export and import of the zones, records, blocking and users.
- **HTTPS with Let's Encrypt**, certificates that are replaced without a
  restart, and a Certificate page. See [HTTPS](#https).
- **Swagger UI** of the API at `/api/docs`, linked from the menu.
- **New screenshots** of every page, in the light and the dark mode and on a phone.
- **Installers** for Debian, Ubuntu, Raspberry Pi OS, CentOS, Alpine and
  Windows, which also update and uninstall the service. See
  [Installing as a service](#installing-as-a-service).
- **A menu for every screen.** The menu is a sidebar, grouped by subject; on
  small screens it opens with a menu button, and the tables are readable on a
  phone without scrolling sideways.

#### Changed

- The standalone records and the blocking are the ones of freya-ns-api now,
  instead of our own: `/api/records` answers as before, `/api/blocklists` is
  replaced by `/api/blocking`.
- The switch of the blocking and the answer for a blocked name are kept in the
  database, and set on the Blocking page. `ODIN_NS_BLOCKING_ENABLED` and
  `ODIN_NS_BLOCK_MODE` are no longer settings.
- Block lists are changed by the roles in `ODIN_DNS_WRITE_ROLES`, not only by
  admins, and a new list is downloaded in the background.
- Every endpoint of the API needs a token, except the login, the docs and
  `/api/service/info`: `GET /api/` too.
- The certificate files of HTTPS are looked for in `sslcert/` of this project.
- The address of the Blocklists page is `#/blocking`; `#/blocklists` leads there.

#### Upgrading from 2.2.2

- Run `npm install`.
- The data is carried over at the first start, and the console says what was:
  the standalone records, the block lists (which are downloaded again), the
  allowed names (as rules that allow the name and what is below it), and what
  `ODIN_NS_BLOCKING_ENABLED` and `ODIN_NS_BLOCK_MODE` were set to. Remove those
  two variables afterwards.
- **A block list no longer blocks the names below its names.** A list that had
  this option needs a rule with "also for every name below the domain" for the
  domains that matter.
- A standalone record for a name inside a zone is no longer refused by the
  API; it is not served, as the zone answers the name.
- With HTTPS enabled: the key and the certificate in the folder of
  freya-ns-api are still found, but an update of the package removes them.
  Move them to `sslcert/server.key` and `sslcert/server.crt` of this project.
- A script that calls `/api/blocklists` has to move to `/api/blocking`, and a
  health check that calls `GET /api/` without a token to `/api/service/info`.
- The queries are recorded from now on, and kept for 30 days. Set
  `ODIN_NS_QUERY_LOG_ENABLED=false` if that is not wanted.

#### Not yet included

- Zone transfers (AXFR) are refused, and responses have no authority section.
- A name that is an alias (CNAME) of a blocked name is not blocked.
- DNSSEC is checked for A and AAAA only, and the own answers are not signed.

### 2.2.2

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

#### Upgrading from 2.2.0

- No data has to be migrated: the collections of the standalone records, the
  blocklists and the allowed names, and their indexes, are created on the
  first start.
- Nothing is blocked until a blocklist is added. Set
  `ODIN_NS_BLOCKING_ENABLED=false` to keep the blocking off altogether.
- `config/settings.json` is written when an admin saves a setting in the
  browser. The environment variables keep their precedence, so an installation
  that is configured by them behaves as before.
- The `status` screenshots and the `#/status` address are replaced by the
  dashboard.

#### Not yet included

- Zone transfers (AXFR) are refused, and responses have no authority section.
- A name that is an alias (CNAME) of a blocked name is not blocked.
- The server does not restart itself: the settings that need a restart wait
  for the next start of the service.

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
