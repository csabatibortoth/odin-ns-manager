// Seeds a throwaway Odin (auth on) with data and DNS traffic for the screenshots of the README.
// node odin-seed.mjs <http port> <dns port> <server log> <minutes of traffic>
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Resolver } from "node:dns";

const [httpPort, dnsPort, logFile, minutes = "16"] = process.argv.slice(2);
const base = `http://127.0.0.1:${httpPort}/api`;
const password = /Created default admin "admin" with password: (\S+)/.exec(readFileSync(logFile, "utf8"))?.[1];
if (!password) throw new Error("no password in the log");

// a block list served from here
const names = Array.from({ length: 1800 }, (_, i) => `${["ads", "track", "metrics", "pixel", "banner", "telemetry"][i % 6]}${i}.${["adnet", "trackerhub", "popcorn-ads", "statsfarm"][i % 4]}.test`);
const listServer = createServer((request, response) => {
    response.setHeader("Content-Type", "text/plain");
    response.end(names.map(name => `0.0.0.0 ${name}`).join("\n"));
}).listen(45470, "127.0.0.1");

const call = async (method, path, body, token) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) console.log("seed: ", method, path, response.status, JSON.stringify(data).slice(0, 150));
    return data;
};
const login = await call("POST", "/auth/login", { username: "admin", password });
const token = login.token;
await call("PATCH", `/users/${login.user.id}`, { displayName: "Administrator" }, token);

const zone = await call("POST", "/zones", { name: "home.lan", soa: { host: "ns1.home.lan", admin: "hostmaster.home.lan" }, ttl: 3600, active: true }, token);
for (const [name, type, data] of [
    ["nas.home.lan", "A", { target: "192.168.2.20" }], ["printer.home.lan", "A", { target: "192.168.2.31" }], ["router.home.lan", "A", { target: "192.168.2.1" }],
    ["media.home.lan", "CNAME", { target: "nas.home.lan" }], ["home.lan", "MX", { exchange: "mail.home.lan", priority: 10 }], ["mail.home.lan", "A", { target: "192.168.2.25" }],
    ["home.lan", "TXT", { target: "v=spf1 mx -all" }], ["_ssh._tcp.home.lan", "SRV", { target: "nas.home.lan", priority: 0, weight: 5, port: 22 }]]) {
    await call("POST", `/zones/${zone.id}/records`, { name, type, data, active: true }, token);
}
await call("POST", "/zones", { name: "lab.example", soa: { host: "ns1.lab.example" }, ttl: 600, active: true }, token);
await call("POST", "/zones", { name: "old-office.lan", soa: { host: "ns1.old-office.lan" }, ttl: 3600, active: false }, token);
for (const [name, type, data] of [["camera.lan", "A", { target: "192.168.2.44" }], ["vpn.lan", "A", { target: "192.168.2.2" }], ["pi.lan", "A", { target: "192.168.2.50" }], ["pi.lan", "AAAA", { target: "fd00::50" }]]) {
    await call("POST", "/records", { name, type, data, active: true }, token);
}
await call("POST", "/blocking/lists", { name: "Ads and trackers", url: `http://127.0.0.1:45470/hosts.txt`, description: "Names of ad networks", active: true }, token);
await call("POST", "/blocking/rules", { domain: "tracking.example.com", action: "block", includeSubdomains: true, comment: "Tracks the whole family", active: true }, token);
await call("POST", "/blocking/rules", { domain: "popcorn-ads.test", action: "allow", includeSubdomains: false, comment: "The film site needs it", active: true }, token);
await call("POST", "/blocking/rules", { domain: "social.example.net", action: "block", includeSubdomains: true, comment: "", active: true }, token);
await call("POST", "/users", { username: "anna", email: "anna@home.lan", displayName: "Anna Kovács", password: "Seed-password-1", role: "user", active: true }, token);
await call("POST", "/users", { username: "bela", email: "bela@home.lan", displayName: "Béla Nagy", password: "Seed-password-2", role: "admin", active: true }, token);
await call("POST", "/blocking/lists/refresh", {}, token);
console.log("seeded; the block list is being downloaded");

// traffic: a few clients (127.0.0.2 ...), own names, forwarded names and blocked names
const clients = ["127.0.0.2", "127.0.0.3", "127.0.0.4", "127.0.0.5", "127.0.0.6"].map(address => {
    const resolver = new Resolver({ timeout: 3000, tries: 1 });
    resolver.setServers([`127.0.0.1:${dnsPort}`]);
    resolver.setLocalAddress(address);
    return resolver;
});
const own = ["nas.home.lan", "printer.home.lan", "router.home.lan", "media.home.lan", "mail.home.lan", "camera.lan", "vpn.lan", "pi.lan"];
const outside = ["github.com", "wikipedia.org", "cloudflare.com", "npmjs.com", "microsoft.com", "ubuntu.com", "mozilla.org", "debian.org", "openstreetmap.org", "kernel.org", "python.org", "rust-lang.org", "nodejs.org", "iana.org", "archive.org", "gnu.org"];
const pick = list => list[Math.floor(Math.random() * list.length)];
const end = Date.now() + Number(minutes) * 60000;
let sent = 0;
while (Date.now() < end) {
    const burst = 2 + Math.floor(Math.random() * 10 * (1 + Math.sin(Date.now() / 90000)));
    for (let i = 0; i < burst; i++) {
        const roll = Math.random();
        const name = roll < 0.3 ? pick(own) : roll < 0.8 ? pick(outside) : pick(names);
        clients[Math.floor(Math.random() * clients.length)].resolve4(name, () => {});
        sent++;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
}
console.log("traffic done:", sent, "queries");
listServer.close();
