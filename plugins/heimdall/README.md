# heimdall

A plugin that makes this server an agent of the
[Heimdall Monitoring System](https://gitlab.com/heimdall-monitoring-system): it measures the DNS server,
the zones, the blocking and the cache on a schedule, notes what changed, and sends it to Heimdall, where
it shows up as metrics and logs next to the other agents.

Version 1.0.0. It runs inside the server (plugins have the rights of the server), so it needs no
installation of its own, and no dependencies: only Node.js 22 or newer, which the server needs anyway.

## Setting it up

1. **In Heimdall**, open *Agents* and create an agent. Copy the address of Heimdall, the **UID** and the
   **license key** (the key is shown only once).
2. **Enable the plugin**: add `heimdall` to *Plugins that run* (Settings, group Plugins), or set
   `ODIN_PLUGINS_ENABLED=heimdall`, and restart the server.
3. **In the menu** open *Plugins > Heimdall*, press *Settings*, and enter the address, the UID and the key.
   It starts at once; *Send now* measures and sends a round right away and shows what came of it.

The address is the one of the Heimdall web server, without a path: `https://heimdall.example.com`. Only
`https` is accepted, and `http` for this machine (`localhost`); an unencrypted connection to another
machine has to be allowed by a tick in the settings, as the license key could be read on the way.

To keep the credentials out of a file, set them in the environment of the server instead: `HEIMDALL_URL`,
`HEIMDALL_AGENT_UID` and `HEIMDALL_LICENSE_KEY`. They win over the file and can not be changed on the page.

## What it sends

**Metrics** (every `Measure every` seconds, 60 by default). The name of this server in Heimdall (the
*source*) is its host name, or what you enter. Counters only go up: draw them with the aggregation `rate`.

| Metric | Type | |
| --- | --- | --- |
| `aesir.up` | gauge | 1 while the server runs. When the metrics stop, Heimdall shows the agent as silent |
| `aesir.uptime`, `aesir.memory.rss` | gauge | Seconds since the start; the memory of the process in bytes |
| `aesir.dns.queries` | counter | Answered queries, with the label `kind`: `total`, `zones`, `records`, `blocked`, `forwarded`, `failed` |
| `aesir.dns.answer_time` | gauge | Milliseconds an answer took (the last sample; not sent when nothing was asked) |
| `aesir.zones`, `aesir.zones.records`, `aesir.zones.standalone_records` | gauge | What the DNS server answers from |
| `aesir.zones.failing` | gauge | 1 when the zones could not be read from the database |
| `aesir.blocking.enabled`, `.lists`, `.names`, `.rules`, `.failing` | gauge | The blocking |
| `aesir.cache.entries`, `aesir.cache.max_entries` | gauge | The cache of the upstream answers |
| `aesir.querylog.recorded`, `aesir.querylog.dropped` | counter | The query log; `aesir.querylog.failing` is a gauge |
| `aesir.certificate.days_left` | gauge | Days until the certificate of HTTPS expires (only when HTTPS is on). A rule in Heimdall can warn at 14 days |
| `aesir.certificate.renewal_failing` | gauge | 1 when the last renewal of the certificate failed |

**Logs** (switch off with *Send logs*): when the DNS data or a synchronization changed (one line for a
burst of changes), when the zones, the blocking or the query log start to fail and when they work again,
and when the plugin starts and when the server stops. They are JSON records with the `service`
(the name of this server) and an `event`, and the `app` `odin-ns-manager`.

**Never sent:** the names that clients asked for, the addresses of the clients, users and passwords. The
query log of Odin is personal data; this plugin only reads its counters.

## When Heimdall can not be reached

Rounds that could not be sent wait in memory (at most 200 batches of 500 points, the oldest are dropped
first) and are sent in order when Heimdall answers again, with a pause that grows from 10 seconds to 5
minutes. A restart of the server forgets what was waiting: unlike the agents of Heimdall, this plugin keeps
no spool on disk. A batch that Heimdall refuses for good (HTTP 400, 413) is dropped, not repeated. The page
shows the state, the last error (a wrong key, an ended subscription, a limit) and the counts. Redirects are
never followed, so the key can not be sent to another address.

## Security

- Only administrators can open the page and its routes (`roles` in `plugin.json`).
- The license key is kept in `settings.json` of the data folder of the plugin (`plugin-data/heimdall` next to the settings of the server, `/var/lib/odin-ns-manager/plugin-data/heimdall` on an installation) with the mode 600, is never
  returned by the API of the plugin, never shown on the page and never written to the log.
- The page is made of text nodes of the plugin API: nothing from Heimdall is ever inserted as HTML.

## Files

```
plugin.json        the description (name, roles, menu entry)
index.js           activate: the routes /status, /settings, /send, the events and the schedule
lib/settings.js    the settings: checks, the file, the environment
lib/collect.js     what is measured (and the real sources: the services of this server)
lib/reporter.js    the schedule, the notes about changes, what the page shows
lib/sender.js      the delivery, the waiting batches, the pauses
public/ui.js       the page of the plugin
plugin-data/heimdall/   not in this folder (it is read-only on an installation): the settings, created when they are saved
```

Tests: `test/heimdall-plugin.test.js` of the server, with a fake Heimdall.
