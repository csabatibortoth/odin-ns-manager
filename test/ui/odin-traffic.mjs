// Only the traffic of odin-seed.mjs: node odin-traffic.mjs <dns port> <minutes>
import { Resolver } from "node:dns";

const [dnsPort, minutes = "20"] = process.argv.slice(2);
const names = Array.from({ length: 1800 }, (_, i) => `${["ads", "track", "metrics", "pixel", "banner", "telemetry"][i % 6]}${i}.${["adnet", "trackerhub", "popcorn-ads", "statsfarm"][i % 4]}.test`);
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
        clients[Math.floor(Math.random() * clients.length)].resolve4(roll < 0.3 ? pick(own) : roll < 0.8 ? pick(outside) : pick(names), () => {});
        sent++;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
}
console.log("traffic done:", sent);
