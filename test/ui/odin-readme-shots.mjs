// The screenshots of the README of Odin NS Manager. node odin-readme-shots.mjs <http port> <server log> <output folder> [only,these,names]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { launch } from "./cdp.mjs";

const [port, logFile, out, only] = process.argv.slice(2);
const wanted = only ? new Set(only.split(",")) : null;
const base = `http://127.0.0.1:${port}`;
const password = /Created default admin "admin" with password: (\S+)/.exec(readFileSync(logFile, "utf8"))?.[1];
mkdirSync(out, { recursive: true });
const failures = [];

// the name of the service, as in the earlier screenshots
const login = await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password }) })).json();
await fetch(`${base}/api/service/config`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` }, body: JSON.stringify({ serverName: "odin-demo" }) });

const browser = await launch();
try {
    const page = await browser.newPage({ front: true });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "light" }] });
    const desktop = () => page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
    const phone = () => page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 1, mobile: true });
    await desktop();
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const shot = async name => {
        const { data } = await page.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64"));
    };
    const go = async route => {
        await page.eval(`location.hash = "#/${route}"`);
        await pause(1500);
    };
    const appearance = (theme, mode) => page.eval(`localStorage.setItem("odin.appearance", JSON.stringify({ theme: ${JSON.stringify(theme)}, mode: ${JSON.stringify(mode)} })); setTimeout(() => location.reload(), 50)`).then(() => pause(3500));
    const dismiss = () => page.eval(`document.querySelectorAll(".toast .alert-close").forEach(button => button.click())`);
    const closeDialog = async () => { await page.press("Escape", "Escape", 27); await pause(300); };
    // scrolls so that the element with this text is near the top of the window
    const scrollTo = (text, offset = 80, selector = "h2, h3, .card, summary, button") => page.eval(`(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim().startsWith(${JSON.stringify(text)})); if (!node) return false; window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top - ${offset}); return true; })()`);
    const step = async (name, fn) => {
        if (wanted && !wanted.has(name)) return;
        try {
            await fn();
        } catch (error) {
            failures.push(`${name}: ${error.message.split("\n")[0].slice(0, 200)}`);
        }
    };
    const signIn = async () => {
        await page.waitFor(`document.querySelector("#loginForm")`, { timeout: 60000 });
        await page.fill("#loginForm-username-control", "admin");
        await page.fill("#loginForm-password-control", password);
        await page.click("#loginForm-submit-login");
        await page.waitFor(`document.querySelectorAll("#header_menu .menu-item").length > 3`, { timeout: 30000 });
        await pause(800);
        await dismiss();
    };
    const fillIn = (selector, value) => page.fill(selector, value);

    await page.goto(`${base}/#/login`);
    await pause(1500);
    await appearance("default", "light");
    await pause(2500);
    await step("login", async () => { await page.waitFor(`document.querySelector("#loginForm")`); await shot("login"); });
    await signIn();

    // ---------------------------------------------------------------- dashboard
    await go("dashboard");
    await page.eval(`(() => { const select = document.querySelector(".page select"); if (select) { select.value = "15m"; select.dispatchEvent(new Event("change", { bubbles: true })); } })()`);
    await pause(2500);
    await step("dashboard", async () => { await page.eval("window.scrollTo(0, 0)"); await shot("dashboard"); });
    await step("dashboard-top", async () => { await scrollTo("Most asked names"); await pause(300); await shot("dashboard-top"); });
    await step("dashboard-graph", async () => {
        await page.eval("window.scrollTo(0, 0)");
        await scrollTo("Queries", 80, ".chart");
        await page.eval(`document.querySelector(".chart summary")?.click()`);
        await pause(600);
        const box = await page.eval(`(() => { const r = document.querySelector(".chart svg").getBoundingClientRect(); return { x: r.left + r.width * 0.42, y: r.top + r.height * 0.55 }; })()`);
        await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
        await pause(500);
        await shot("dashboard-graph");
        await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
    });
    await step("dashboard-state", async () => { await page.eval("window.scrollTo(0, document.body.scrollHeight)"); await pause(400); await shot("dashboard-state"); });

    // ---------------------------------------------------------------- zones and records
    await go("zones");
    await step("zones", async () => { await shot("zones"); });
    await step("zone-records", async () => {
        await page.eval(`[...document.querySelectorAll("a")].find(link => link.textContent.trim() === "home.lan").click()`);
        await page.waitFor(`document.body.innerText.includes("nas")`, { timeout: 15000 });
        await pause(800);
        await shot("zone-records");
    });
    await step("add-record", async () => {
        await page.clickText("Add record");
        await page.waitFor(`document.querySelector("dialog.dialog[open]")`);
        await page.click(`dialog.dialog[open] [name="name"]`);
        await page.type("blog.home.lan");
        await fillIn(`dialog.dialog[open] [name="data.target"]`, "192.168.2.60");
        await pause(300);
        await shot("add-record");
    });
    await step("record-validation", async () => {
        await fillIn(`dialog.dialog[open] [name="data.target"]`, "192.168.2.999");
        await page.clickText("Save", "dialog.dialog[open]");
        await pause(1200);
        await shot("record-validation");
        await fillIn(`dialog.dialog[open] [name="data.target"]`, "192.168.2.60");
    });
    await step("record-added", async () => {
        await page.clickText("Save", "dialog.dialog[open]");
        await page.waitFor(`!document.querySelector("dialog.dialog")`, { timeout: 15000 });
        await pause(1200);
        await shot("record-added");
        await dismiss();
    });

    await go("records");
    await step("records", async () => { await shot("records"); });
    await step("add-standalone-record", async () => {
        await page.clickText("Add record");
        await page.waitFor(`document.querySelector("dialog.dialog[open]")`);
        await page.click(`dialog.dialog[open] [name="name"]`);
        await page.type("printer2.lan");
        await fillIn(`dialog.dialog[open] [name="data.target"]`, "192.168.2.32");
        await pause(300);
        await shot("add-standalone-record");
        await closeDialog();
    });

    // ---------------------------------------------------------------- blocking
    await go("blocking");
    await step("blocking", async () => { await shot("blocking"); });
    await step("blocking-check", async () => {
        await page.fill("#check_domain", "ads0.adnet.test");
        await page.eval(`document.querySelector("#check_domain").closest("form").requestSubmit()`);
        await pause(1500);
        await page.eval("window.scrollTo(0, 60)");
        await shot("blocking-check");
    });
    await step("blocking-rules", async () => { await scrollTo("Rules", 60, "h2, h3"); await pause(300); await shot("blocking-rules"); });
    await step("add-blocklist", async () => {
        await page.eval("window.scrollTo(0, 0)");
        await page.clickText("Add block list");
        await page.waitFor(`document.querySelector("dialog.dialog[open]")`);
        await page.click(`dialog.dialog[open] [name="name"]`);
        await page.type("StevenBlack hosts");
        await fillIn(`dialog.dialog[open] [name="url"]`, "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts");
        await fillIn(`dialog.dialog[open] [name="description"]`, "Advertising and malware");
        await pause(300);
        await shot("add-blocklist");
        await closeDialog();
    });
    await step("add-rule", async () => {
        await scrollTo("Rules", 60, "h2, h3");
        await page.clickText("Add rule");
        await page.waitFor(`document.querySelector("dialog.dialog[open]")`);
        await page.click(`dialog.dialog[open] [name="domain"]`);
        await page.type("google-analytics.com");
        await fillIn(`dialog.dialog[open] [name="action"]`, "allow");
        await fillIn(`dialog.dialog[open] [name="comment"]`, "The shop needs it");
        await page.eval(`(() => { const box = document.querySelector('dialog.dialog[open] [name="includeSubdomains"]'); if (box && !box.checked) box.click(); })()`);
        await pause(300);
        await shot("add-rule");
        await closeDialog();
    });

    // ---------------------------------------------------------------- lookup
    const lookupOf = async name => {
        await go("lookup");
        await page.fill("#lookup_name", name);
        await page.click("input[type=submit]");
        await pause(3500);
    };
    await go("lookup");
    await step("lookup", async () => { await lookupOf("nas.home.lan"); await shot("lookup"); });
    await step("lookup-blocked", async () => { await lookupOf("ads0.adnet.test"); await shot("lookup-blocked"); });
    await step("lookup-dnssec", async () => { await lookupOf("cloudflare.com"); await shot("lookup-dnssec"); });

    // ---------------------------------------------------------------- monitoring and service
    for (const [name, route] of [["queries", "queries"], ["clients", "clients"], ["users", "users"], ["logs", "logs"], ["backup", "backup"], ["settings", "settings"], ["account", "account"]]) {
        await go(route);
        await step(name, async () => { await shot(name); });
    }
    await go("settings");
    await step("settings-edit", async () => {
        await page.eval(`(() => { const button = [...document.querySelectorAll("button")].find(node => node.textContent.trim() === "Edit"); button?.click(); })()`);
        await page.waitFor(`document.querySelector("dialog.dialog[open]")`);
        await pause(400);
        await shot("settings-edit");
        await closeDialog();
    });

    // ---------------------------------------------------------------- looks
    await go("zones");
    await step("appearance-menu", async () => { await page.click("#header_tools .dropdown-toggle"); await pause(500); await shot("appearance-menu"); await page.press("Escape", "Escape", 27); });
    await appearance("default", "dark");
    await go("zones");
    await step("zones-dark", async () => { await shot("zones-dark"); });
    await go("blocking");
    await step("blocking-dark", async () => { await shot("blocking-dark"); });
    await go("dashboard");
    await page.eval(`(() => { const select = document.querySelector(".page select"); if (select) { select.value = "15m"; select.dispatchEvent(new Event("change", { bubbles: true })); } })()`);
    await pause(2500);
    await step("dashboard-dark", async () => { await shot("dashboard-dark"); });
    await appearance("aesir", "dark");
    await go("zones");
    await step("theme-aesir-dark", async () => { await shot("theme-aesir-dark"); });
    await appearance("aesir", "light");
    await go("zones");
    await step("theme-aesir", async () => { await shot("theme-aesir"); });

    // ---------------------------------------------------------------- a phone
    await appearance("default", "light");
    await phone();
    await go("dashboard");
    await page.eval(`(() => { const select = document.querySelector(".page select"); if (select) { select.value = "15m"; select.dispatchEvent(new Event("change", { bubbles: true })); } })()`);
    await pause(2500);
    await step("mobile-dashboard", async () => { await shot("mobile-dashboard"); });
    await step("mobile-menu", async () => {
        await page.eval(`[...document.querySelectorAll("#header_menu .has-submenu > button")].find(node => node.textContent.includes("DNS")).click()`);
        await pause(500);
        await shot("mobile-menu");
        await page.eval(`document.querySelector("#header_menu .has-submenu > button[aria-expanded=true]")?.click()`);
    });
    await go("queries");
    await step("mobile-queries", async () => { await shot("mobile-queries"); });
    await go("records");
    await step("mobile-records", async () => { await shot("mobile-records"); });
    const problems = page.problems.filter(item => !/favicon|status of (400|401|409)/.test(item));
    if (problems.length) failures.push("page problems: " + problems.slice(0, 4).join(" | "));
} finally {
    await browser.close();
}
console.log(failures.length ? "FAILED:\n" + failures.join("\n") : "all shots taken");
