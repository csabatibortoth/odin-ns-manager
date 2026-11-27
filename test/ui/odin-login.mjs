// The sign-in flow of the Odin UI against a server with authentication on: node odin-login.mjs <port> <server log> [screenshot folder]
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { launch } from "./cdp.mjs";

const [port, logFile, shots] = [process.argv[2], process.argv[3], process.argv[4]];
const password = /Created default admin "admin" with password: (\S+)/.exec(readFileSync(logFile, "utf8"))?.[1];
assert.ok(password, "the log has the password of the first admin");
if (shots) mkdirSync(shots, { recursive: true });
const results = [];
const step = async (name, fn) => {
    try { await fn(); results.push(`ok    ${name}`); } catch (error) { results.push(`FAIL  ${name}: ${error.message.split("\n")[0].slice(0, 300)}`); }
};
const browser = await launch();
try {
    const page = await browser.newPage({ front: true });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
    const shot = async name => {
        if (!shots) return;
        const { data } = await page.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${shots}/${name}.png`, Buffer.from(data, "base64"));
    };
    const dismiss = () => page.eval(`document.querySelectorAll(".toast .alert-close").forEach(button => button.click())`);
    await page.goto(`http://127.0.0.1:${port}/#/zones`);

    await step("without a session the sign-in form is shown instead of the page", async () => {
        await page.waitFor(`document.querySelector("#loginForm")`, { timeout: 60000 });
        assert.equal(await page.eval(`document.querySelector(".login-page h2")?.textContent`), "Sign in");
        assert.equal(await page.eval(`document.activeElement?.id`), "loginForm-username-control", "the username has the focus");
        assert.equal(await page.eval(`document.querySelectorAll("#header_menu .menu-item").length`), 0, "no menu for a visitor");
        await shot("login");
    });
    await step("a wrong password is refused with a notice and the form stays", async () => {
        await page.type("admin");
        await page.fill("#loginForm-password-control", "not-the-password");
        await page.click("#loginForm-submit-login");
        await page.waitFor(`document.querySelector(".toast")?.textContent.includes("Wrong username or password")`, { timeout: 15000 });
        assert.equal(await page.eval(`Boolean(document.querySelector("#loginForm"))`), true);
        await shot("login-wrong");
    });
    await step("the right password signs in: the page that was asked for opens and the menu appears", async () => {
        await dismiss();
        await page.fill("#loginForm-password-control", password);
        await page.click("#loginForm-submit-login");
        await page.waitFor(`document.querySelectorAll("#header_menu .menu-item").length > 3 && document.querySelector(".page-head h2")?.textContent === "Zones"`, { timeout: 30000 });
        assert.equal(await page.eval(`location.hash`), "#/zones");
        await shot("signed-in");
    });
    await step("the menu has the user's group with the avatar, and signing out shows the form again", async () => {
        assert.equal(await page.eval(`Boolean(document.querySelector("#header_menu .menu-avatar"))`), true, "avatar");
        await page.eval(`document.querySelector("#header_menu .menu-item-end > button").click()`);
        await page.waitFor(`[...document.querySelectorAll("#header_menu .menu-sub-control")].some(item => item.textContent === "Sign out")`, { timeout: 5000 });
        await page.eval(`[...document.querySelectorAll("#header_menu .menu-sub-control")].find(item => item.textContent === "Sign out").click()`);
        await page.waitFor(`document.querySelector("#loginForm") && document.querySelector(".toast")?.textContent.includes("signed out")`, { timeout: 15000 });
        assert.equal(await page.eval(`location.hash`), "#/login");
        await shot("signed-out");
    });
    await step("the page reported no problems (the 401 of the wrong password is expected)", async () => {
        const problems = page.problems.filter(item => !/favicon|status of 401/.test(item));
        assert.deepEqual(problems, [], problems.join("\n"));
    });
} catch (error) {
    results.push("FAIL  setup: " + error.message);
} finally {
    await browser.close();
}
console.log(results.join("\n"));
process.exit(results.some(line => line.startsWith("FAIL")) ? 1 : 0);
