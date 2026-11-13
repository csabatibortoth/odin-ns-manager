# bragi-ns-client

A drop-in replacement for the Node.js `dns.lookup` method that caches addresses for their DNS TTL and never
touches the libuv thread pool.

- **No thread pool** – uses `dns.resolve4` / `dns.resolve6` instead of `getaddrinfo`
- **TTL aware** – addresses are cached exactly as long as the DNS record allows
- **Round-robin** – every call returns the next address of the host
- **One query per host** – parallel lookups of the same host share a single DNS query
- **DNSSEC** – optional: answers are validated by the package itself, or by a DNS server you trust
- **Zero dependencies**

## Table of contents

- [Motivation](#motivation)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [API](#api)
- [Errors](#errors)
- [Round-robin](#round-robin)
- [DNSSEC](#dnssec)
- [Implementation](#implementation)
- [Development](#development)
- [Credits](#credits)
- [License](#license)

---

## Motivation

`dns.lookup` is what `http`, `https`, `net` and most HTTP clients use to turn a hostname into an IP address.
It calls `getaddrinfo`, which is a synchronous system call, so Node.js runs it on the libuv thread pool. The pool has
only four threads by default and is shared with file system and crypto operations. Under load, slow DNS responses
occupy those threads and everything else has to wait.
See [Node.js DNS implementation considerations](https://nodejs.org/api/dns.html#implementation-considerations).

`dns.lookup` also does not cache anything: every new connection asks the system resolver again. And it gives no
way to know if an answer is authentic.

This package resolves hostnames over the network with `dns.resolve4` / `dns.resolve6`, which do not use the thread
pool, and keeps the answers in memory until their DNS TTL runs out. Since 2.1.0 it can also validate the answers
with [DNSSEC](#dnssec).

[back to top](#table-of-contents)

---

## Requirements

Node.js 20 or newer.

[back to top](#table-of-contents)

---

## Installation

```sh
npm install bragi-ns-client
```

or straight from GitHub:

```sh
npm install csabatibortoth/bragi-ns-client
```

[back to top](#table-of-contents)

---

## Quick start

Pass `lookup` to anything that accepts a custom `lookup` function:

```js
const https = require('node:https');
const {lookup} = require('bragi-ns-client');

// One request
https.get('https://example.com', {lookup}, response => {
    // ...
});

// Every request made through an agent
const agent = new https.Agent({keepAlive: true, lookup});

https.get('https://example.com', {agent}, response => {
    // ...
});
```

```js
const net = require('node:net');
const {lookup} = require('bragi-ns-client');

const socket = net.connect({host: 'example.com', port: 80, lookup});
```

With [DNSSEC](#dnssec) validation, so a forged DNS answer cannot redirect the connection:

```js
const https = require('node:https');
const {createLookup} = require('bragi-ns-client');

const lookup = createLookup({dnssec: 'validate'});

https.get('https://example.com', {lookup}, response => {
    // ...
});
```

Or call it directly:

```js
const {lookup} = require('bragi-ns-client');

lookup('example.com', {family: 4}, (error, address, family) => {
    // address === '93.184.216.34'
    // family === 4
});
```

[back to top](#table-of-contents)

---

## API

### `lookup(hostname[, options], callback)`

Has the same signature as [`dns.lookup`](https://nodejs.org/api/dns.html#dnslookuphostname-options-callback).

| Param            | Type                 | Description                                                                |
|------------------|----------------------|----------------------------------------------------------------------------|
| `hostname`       | `string`             | Host to resolve                                                            |
| `options`        | `Object` or `number` | Optional. A number is treated as `family`                                  |
| `options.family` | `4` or `6`           | IP version to look for. Both are queried if it is not set, IPv4 goes first |
| `options.all`    | `boolean`            | Return all addresses instead of one. Default: `false`                      |
| `callback`       | `Function`           | `(error, address, family)`, or `(error, addresses)` if `all` is `true`     |

```js
lookup('example.com', {all: true}, (error, addresses) => {
    // IPv4 addresses are listed first, then IPv6.
    //
    // addresses === [
    //     {address: '1.2.3.4', family: 4},
    //     {address: '5.6.7.8', family: 4},
    //     {address: '2001:db8::1', family: 6}
    // ]
});
```

```js
lookup('example.com', (error, address, family) => {
    // IPv4 address if the host has one, IPv6 address otherwise.
});
```

```js
lookup('example.com', 6, (error, address, family) => {
    // IPv6 only. Fails with ENOTFOUND if the host has no AAAA records.
});
```

If you only need one IP version, set `family` explicitly. It saves a useless DNS query for the other one.

### `createLookup([options])`

Returns a new `lookup` function with its own cache and settings. This is how [DNSSEC](#dnssec) is turned on.

| Option          | Type                            | Description                                                                             |
|-----------------|---------------------------------|-----------------------------------------------------------------------------------------|
| `dnssec`        | `'validate'`, `'trust-ad'`, `false` | DNSSEC mode, see [DNSSEC](#dnssec). `true` means `'validate'`. Default: `false`     |
| `requireSecure` | `boolean`                       | Fail for the hosts that are not protected by DNSSEC. Default: `false`                   |
| `servers`       | `string[]`                      | DNS servers to ask, in the format of `dns.getServers()`. Default: `dns.getServers()`    |
| `timeout`       | `number`                        | Milliseconds to wait for a response of a server. Default: `2000`                        |
| `tries`         | `number`                        | How many times to go through the list of servers. Default: `3`                          |

All the options except `dnssec` can be used only together with it.

### Differences from `dns.lookup`

- `hints`, `order` and `verbatim` options are not supported. Without `family` IPv4 addresses always go first.
- `/etc/hosts` and other OS level resolver configuration (for example `nsswitch.conf`) are not used, because
  `getaddrinfo` is not called. Hosts that exist only there, including `localhost` on some systems, cannot be
  resolved.
- Invalid arguments are reported with a plain `Error` thrown synchronously.
- A falsy `hostname` produces `null` (or `[]` with `all: true`) without an error, the same way `dns.lookup` does.

[back to top](#table-of-contents)

---

## Errors

The error object has the same fields as the one `dns.lookup` produces, only `syscall` is different.

Node.js `dns.lookup`:

```js
dns.lookup('host-without-ipv6.example', {family: 6}, console.log);

// Error: getaddrinfo ENOTFOUND host-without-ipv6.example
//   code: 'ENOTFOUND',
//   errno: 'ENOTFOUND',
//   syscall: 'getaddrinfo',
//   hostname: 'host-without-ipv6.example'
```

`bragi-ns-client`:

```js
lookup('host-without-ipv6.example', {family: 6}, console.log);

// Error: queryAaaa ENOTFOUND host-without-ipv6.example
//   code: 'ENOTFOUND',
//   errno: 'ENOTFOUND',
//   syscall: 'queryAaaa',
//   hostname: 'host-without-ipv6.example'
```

Failed lookups are not cached, the next call sends a new DNS query.

[back to top](#table-of-contents)

---

## Round-robin

If a hostname resolves to several addresses, every call returns the next one:

```js
// example.com resolves to [1.2.3.4, 5.6.7.8, 9.10.11.12]

lookup('example.com', {family: 4}, (error, address) => {
    // address === '1.2.3.4'
});

lookup('example.com', {family: 4}, (error, address) => {
    // address === '5.6.7.8'
});

lookup('example.com', {family: 4}, (error, address) => {
    // address === '9.10.11.12'
});

lookup('example.com', {family: 4}, (error, address) => {
    // address === '1.2.3.4'
});
```

The order starts over when the cached addresses expire and the host is resolved again.

[back to top](#table-of-contents)

---

## DNSSEC

DNSSEC lets a resolver check that a DNS answer is the one the owner of the domain has published, so a forged
answer cannot send your connection to somebody else's server. It is off by default. Turn it on with `createLookup`:

```js
const https = require('node:https');
const {createLookup, DNSSEC_BOGUS} = require('bragi-ns-client');

const lookup = createLookup({dnssec: 'validate'});

https.get('https://example.com', {lookup}, response => {
    // ...
}).on('error', error => {
    if (error.code === DNSSEC_BOGUS) {
        // The DNS answer was forged or the DNSSEC setup of the domain is broken
    }
});
```

### Modes

| Mode         | Who validates   | What you have to trust                                         | Cost                                      |
|--------------|-----------------|----------------------------------------------------------------|-------------------------------------------|
| `'validate'` | This package    | The root zone keys only                                        | Up to a few extra queries per new domain  |
| `'trust-ad'` | The DNS server  | The DNS server and the network between it and your application | One query, as without DNSSEC              |

**`validate`** fetches the signatures and the keys and verifies the whole chain of trust by itself: the answer must be
signed by a key of its zone, and the keys of every zone must be vouched for by the parent zone, up to the root keys
that are built in. Nothing between the application and the authoritative servers can change an answer unnoticed.
The DNS server only has to hand over the DNSSEC records, which nearly every resolver does. Keys of the zones are
cached, so the extra queries are sent only for the first lookup in a domain.

**`trust-ad`** asks the DNS server to validate and believes the AD ("authentic data") flag of its response. Use it
only with a validating resolver you reach over a network you trust, like one on `localhost`. Anybody who can change
the packets between the server and the application can set the flag too.

### What happens with an answer

| Answer                                    | Result                                                                    |
|-------------------------------------------|---------------------------------------------------------------------------|
| Signed and valid                          | Addresses                                                                 |
| The domain is not signed                  | Addresses. With `requireSecure: true`: `EDNSSEC_INSECURE` error           |
| Forged, expired or broken signatures      | `validate`: `EDNSSEC_BOGUS` error. `trust-ad`: `ESERVFAIL` from the server |
| The host does not exist                   | `ENOTFOUND`, the proof of it is validated too                             |

Most domains are not signed, so by default they keep working as before. In the `validate` mode an attacker cannot
pass a signed domain off as an unsigned one: the parent zone has to prove that the domain is not signed.

`requireSecure: true` is for the applications that talk only to the hosts known to be signed. In the `trust-ad` mode
it is the only setting that adds protection: without it a response with no AD flag is accepted like any other.

With `{all: true}` every address tells if it is protected:

```js
const lookup = createLookup({dnssec: 'validate'});

lookup('example.com', {all: true}, (error, addresses) => {
    // addresses === [
    //     {address: '1.2.3.4', family: 4, secure: true},
    //     {address: '2001:db8::1', family: 6, secure: true}
    // ]
});
```

The error codes are exported as `DNSSEC_BOGUS` and `DNSSEC_INSECURE`. The message of a bogus error tells what is
wrong:

```js
createLookup({dnssec: 'validate'})('dnssec-failed.org', 4, console.log);

// Error: queryA EDNSSEC_BOGUS dnssec-failed.org: DNSKEY records of dnssec-failed.org are not signed by a trusted key
//   code: 'EDNSSEC_BOGUS',
//   errno: 'EDNSSEC_BOGUS',
//   syscall: 'queryA',
//   hostname: 'dnssec-failed.org'
```

### Details

- With DNSSEC the package talks to the DNS servers by itself (UDP with a fallback to TCP), because `node:dns` gives
  no access to the DNSSEC records and flags. It still has no dependencies, and the thread pool is still not used.
- Supported signature algorithms: RSA/SHA-1, RSA/SHA-256, RSA/SHA-512, ECDSA P-256 and P-384, Ed25519 and Ed448.
  A zone signed only with something else is treated as not signed, as the DNSSEC standard tells.
- CNAME and DNAME records, wildcards, NSEC and NSEC3 (with opt-out) are supported.
- An answer is cached for its TTL, but never longer than its signatures are valid.
- The `validate` mode needs a correct system clock, because signatures have a validity period.
- If the DNS server strips the DNSSEC records, the `validate` mode fails with `EDNSSEC_BOGUS` for every host. The
  error message mentions this possibility. Pass another server with the `servers` option then.
- The root keys (KSK-2017 and KSK-2024) are built in. They change once in several years; a new one will need an
  update of the package.

[back to top](#table-of-contents)

---

## Implementation

- Addresses are requested with `dns.resolve4` / `dns.resolve6` and the `{ttl: true}` option.
- The answer is cached per hostname and IP version until the smallest TTL among its addresses runs out. Expired
  entries are removed on the next lookup of that host.
- While a DNS query is in flight, every other lookup of the same host and IP version waits for that query instead of
  sending its own.
- Without `family` the `A` and `AAAA` queries run in parallel. With `{all: true}` the result is one flat array,
  IPv4 addresses first. Otherwise an IPv4 address is returned, or an IPv6 address if the host has no IPv4 ones.
- The cache lives in memory of the current process and is shared by everything that imports the package. Every
  function made with `createLookup` has a cache of its own.
- With [DNSSEC](#dnssec) the package sends the queries by itself instead of calling `dns.resolve4` / `dns.resolve6`,
  and validates the answers before they get into the cache. Everything else works the same way.

[back to top](#table-of-contents)

---

## Development

```sh
npm install

npm run lint            # eslint
npm run unit-test       # unit tests, no network needed
npm run func-test       # functional tests, real DNS queries are sent
npm test                # unit and functional tests
npm run test:coverage   # all tests with the coverage report
```

Changes are listed in the [changelog](CHANGELOG.md).

[back to top](#table-of-contents)

---

## Credits

This project is based on [dns-lookup-cache](https://github.com/LCMApps/dns-lookup-cache) by LCMApps.

[back to top](#table-of-contents)

---

## License

[MIT](LICENSE.md)
