// Screenshots of the Odin user interface: node odin-shots.mjs <output folder> [port]
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, until } from "./cdp.mjs";

const out = process.argv[2];
const port = process.argv[3] ?? "45461";
const base = `http://127.0.0.1:${port}`;
mkdirSync(out, { recursive: true });

const call = async (method, path, body) => {
    const response = await fetch(`${base}/api${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return response.json().catch(() => ({}));
};

// data to look at
let zones = await call("GET", "/zones");
let zone = (zones.items ?? zones)[0];
if (!zone) {
    zone = await call("POST", "/zones", { name: "example.test", soa: { host: "ns1.example.test", admin: "hostmaster.example.test" }, ttl: 3600, active: true });
    for (const [name, type, data] of [["www.example.test", "A", { target: "192.0.2.10" }], ["mail.example.test", "A", { target: "192.0.2.25" }], ["example.test", "MX", { exchange: "mail.example.test", priority: 10 }], ["alias.example.test", "CNAME", { target: "www.example.test" }]]) {
        await call("POST", `/zones/${zone.id}/records`, { name, type, data, active: true });
    }
    await call("POST", "/zones", { name: "lan.test", soa: { host: "ns1.lan.test" }, ttl: 600, active: false });
}

const pages = ["dashboard", "zones", `zones/${zone.id}`, "records", "blocking", "lookup", "queries", "clients", "users", "logs", "backup", "certificate", "sync", "plugins", "settings", "account"];
const browser = await launch();
const problems = [];
try {
    const page = await browser.newPage({ front: true });
    const shot = async name => {
        const { data } = await page.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64"));
    };
    const settle = async () => {
        await page.eval(`new Promise(resolve => setTimeout(resolve, 900))`);
    };
    for (const mode of ["light", "dark"]) {
        await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
        await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }, { name: "prefers-reduced-motion", value: "reduce" }] });
        await page.goto(`${base}/#/dashboard`);
        await page.eval(`localStorage.setItem("odin.appearance", JSON.stringify({ theme: "default", mode: "${mode}" })); location.reload()`).catch(() => {});
        await until(async () => page.eval(`Boolean(document.querySelector("#header_menu .menu-item"))`).catch(() => false), { timeout: 60000, message: "the menu" });
        for (const route of pages) {
            await page.eval(`location.hash = "#/${route}"`);
            await settle();
            await shot(`${mode}-${route.replace("/", "-").replace(/[0-9a-f]{24}/, "id")}`);
        }
        // dialogs and menus
        await page.eval(`location.hash = "#/zones"`);
        await settle();
        await page.clickText("Add zone").catch(error => problems.push("Add zone: " + error.message));
        await settle();
        await shot(`${mode}-dialog-add-zone`);
        await page.press("Escape", "Escape", 27);
        await settle();
        await page.click("#header_menu .has-submenu > button").catch(error => problems.push("submenu: " + error.message));
        await settle();
        await shot(`${mode}-menu-open`);
        await page.press("Escape", "Escape", 27);
        await page.click("#header_tools .dropdown-toggle").catch(error => problems.push("appearance: " + error.message));
        await settle();
        await shot(`${mode}-appearance-open`);
        await page.press("Escape", "Escape", 27);
    }
    // a phone
    await page.send("Emulation.setDeviceMetricsOverride", { width: 420, height: 820, deviceScaleFactor: 1, mobile: true });
    await page.eval(`location.hash = "#/zones"`);
    await settle();
    await shot("phone-zones");
    await page.click("#header_menu .has-submenu > button").catch(() => {});
    await settle();
    await shot("phone-menu-open");
    problems.push(...page.problems.map(item => "page: " + item));
} finally {
    await browser.close();
}
console.log(problems.length ? problems.join("\n") : "no problems reported by the page");
