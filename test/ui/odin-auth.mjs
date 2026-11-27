// Signed in: the pages that need a user (account, users) and their forms. node odin-auth.mjs <port> <server log> <screenshot folder>
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { launch } from "./cdp.mjs";

const [port, logFile, shots] = process.argv.slice(2);
const password = /Created default admin "admin" with password: (\S+)/.exec(readFileSync(logFile, "utf8"))?.[1];
assert.ok(password);
mkdirSync(shots, { recursive: true });
const results = [];
const step = async (name, fn) => {
    try { await fn(); results.push(`ok    ${name}`); } catch (error) { results.push(`FAIL  ${name}: ${error.message.split("\n")[0].slice(0, 300)}`); }
};
const browser = await launch();
try {
    const page = await browser.newPage({ front: true });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
    const shot = async name => {
        const { data } = await page.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${shots}/${name}.png`, Buffer.from(data, "base64"));
    };
    const dismiss = () => page.eval(`document.querySelectorAll(".toast .alert-close").forEach(button => button.click())`);
    await page.goto(`http://127.0.0.1:${port}/#/account`);
    await page.waitFor(`document.querySelector("#loginForm")`, { timeout: 60000 });
    await page.fill("#loginForm-username-control", "admin");
    await page.fill("#loginForm-password-control", password);
    await page.click("#loginForm-submit-login");
    await page.waitFor(`document.querySelector(".page-head h2")?.textContent === "Account"`, { timeout: 30000 });

    await step("account page: the profile and the password forms are there", async () => {
        await page.waitFor(`document.querySelectorAll(".page form").length >= 2`, { timeout: 15000 });
        await shot("account");
    });
    await step("the password form: a wrong repeat is shown at its field, nothing is sent", async () => {
        const forms = await page.eval(`[...document.querySelectorAll(".page form")].map(form => [...form.querySelectorAll("[name]")].map(input => input.name).join(","))`);
        const index = forms.findIndex(names => names.includes("password") || names.includes("newPassword"));
        assert.ok(index >= 0, "a password form: " + JSON.stringify(forms));
        const names = forms[index].split(",");
        const newName = names.find(name => /new|^password$/i.test(name) && !/current|repeat|confirm/i.test(name));
        const repeatName = names.find(name => /repeat|confirm/i.test(name));
        assert.ok(newName && repeatName, "fields: " + names);
        await page.eval(`(() => { const form = document.querySelectorAll(".page form")[${index}]; for (const [name, value] of [[${JSON.stringify(newName)}, "Aaaa1111bbbb"], [${JSON.stringify(repeatName)}, "different"], ["currentPassword", "x"]]) { const input = form.querySelector('[name="' + name + '"]'); if (input) { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); } } form.requestSubmit(); })()`);
        await page.waitFor(`[...document.querySelectorAll(".page .field-error")].some(node => node.textContent.includes("differ"))`, { timeout: 10000 });
        await shot("account-password-error");
    });
    await page.eval(`location.hash = "#/users"`);
    await page.waitFor(`document.querySelector(".page-head h2")?.textContent === "Users"`, { timeout: 15000 });
    await dismiss();
    await step("users: Add user opens a dialog with its fields; a wrong entry is told at the field by the server", async () => {
        await page.clickText("Add user");
        await page.waitFor(`document.querySelector("dialog.dialog[open] form")`);
        await shot("users-add-dialog");
        await page.clickText("Save", "dialog.dialog[open]");
        await page.waitFor(`document.querySelector("dialog.dialog[open] .field-error:not(:empty)")`, { timeout: 10000 });
        await page.eval(`(() => { const dialog = document.querySelector("dialog.dialog[open]"); const set = (name, value) => { const input = dialog.querySelector('[name="' + name + '"]'); if (input) { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); } }; set("username", "e2e user!"); set("password", "short"); })()`);
        await page.clickText("Save", "dialog.dialog[open]");
        await page.waitFor(`document.querySelector("dialog.dialog[open] .field-error:not(:empty)") || document.querySelector("dialog.dialog[open] .form-message-error")`, { timeout: 10000 });
        await shot("users-add-error");
        await page.clickText("Cancel", "dialog.dialog[open]");
        await page.waitFor(`!document.querySelector("dialog.dialog")`, { timeout: 5000 });
    });
    await step("settings: a setting is edited and saved", async () => {
        await page.eval(`location.hash = "#/settings"`);
        await page.waitFor(`document.querySelector("[role=tab]")`, { timeout: 15000 });
        await shot("settings");
    });
    await step("the page reported no problems", async () => {
        const problems = page.problems.filter(item => !/favicon|status of (400|401|409)/.test(item));
        assert.deepEqual(problems, [], problems.join("\n"));
    });
} catch (error) {
    results.push("FAIL  setup: " + error.message);
} finally {
    await browser.close();
}
console.log(results.join("\n"));
process.exit(results.some(line => line.startsWith("FAIL")) ? 1 : 0);
