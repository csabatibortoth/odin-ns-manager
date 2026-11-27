// A very small client of the Chrome DevTools Protocol, for the tests of the demo: one headless browser, a page per test, no dependency
// (Node 22 and later have WebSocket built in).

import { spawnSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const chromePath = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"
].filter(Boolean).find(existsSync);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function until(check, { timeout = 90000, interval = 100, message = "the condition" } = {}) {
    const start = Date.now();
    for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() - start > timeout) throw new Error(`Timed out after ${timeout} ms waiting for ${message}`);
        await wait(interval);
    }
}

/** Starts the browser. Returns { newPage(), close() }. */
export async function launch() {
    const profile = mkdtempSync(join(tmpdir(), "athena-demo-cdp-"));
    const child = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
        "--window-size=1200,900", "--no-first-run", "about:blank"], { stdio: "ignore" });
    const portFile = join(profile, "DevToolsActivePort");
    const port = Number((await until(() => existsSync(portFile) && readFileSync(portFile, "utf8").split("\n")[0], { timeout: 60000, message: "the browser to start" })));

    async function newPage({ front = false } = {}) {
        const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error("could not connect to the page")); });
        let id = 0;
        const pending = new Map();
        const listeners = new Set();
        const networkRequests = [];
        const activeNetworkRequests = new Set();
        let lastNetworkActivity = Date.now();
        const problems = [];
        socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.id && pending.has(message.id)) {
                const { resolve, reject } = pending.get(message.id);
                pending.delete(message.id);
                if (message.error) reject(new Error(`${message.error.message}`));
                else resolve(message.result);
            } else if (message.method) {
                for (const listener of listeners) listener(message);
            }
        };
        const send = (method, params = {}) => new Promise((resolve, reject) => {
            const mine = ++id;
            pending.set(mine, { resolve, reject });
            socket.send(JSON.stringify({ id: mine, method, params }));
        });

        // Everything that goes wrong in the page is collected: exceptions, console errors and warnings, policy violations, failed requests
        listeners.add(message => {
            const { method, params } = message;
            if (method === "Network.requestWillBeSent") {
                networkRequests.push({ url: params.request.url, method: params.request.method });
                activeNetworkRequests.add(params.requestId);
                lastNetworkActivity = Date.now();
            } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
                activeNetworkRequests.delete(params.requestId);
                lastNetworkActivity = Date.now();
            } else if (method === "Runtime.exceptionThrown") problems.push(`exception: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
            else if (method === "Runtime.consoleAPICalled" && (params.type === "error" || params.type === "warning" || params.type === "assert")) {
                problems.push(`console.${params.type}: ${params.args.map(arg => arg.value ?? arg.description ?? "").join(" ")}`);
            } else if (method === "Log.entryAdded" && (params.entry.level === "error" || params.entry.level === "warning")) {
                problems.push(`${params.entry.source} ${params.entry.level}: ${params.entry.text} ${params.entry.url ?? ""}`.trim());
            } else if (method === "Network.loadingFailed" && !params.canceled) {
                problems.push(`request failed: ${params.errorText} ${params.blockedReason ?? ""}`.trim());
            }
        });
        await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Log.enable"), send("Network.enable")]);
        if (front) await send("Page.bringToFront");     // a tab in the background gets no animation frames (the component tests need them; the demo tests with real input work without)

        const page = {
            problems,
            networkRequests,
            send,
            async goto(url) {
                problems.length = 0;
                await send("Page.navigate", { url });
                await until(async () => (await page.eval("document.readyState")) === "complete", { timeout: 120000, message: `${url} to load` });
            },
            /** Evaluates an expression in the page (it may be async) and returns its value. */
            async eval(expression) {
                const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
                if (exceptionDetails) throw new Error(`in the page: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
                return result.value;
            },
            /** Waits until an expression is true in the page. */
            waitFor: (expression, options = {}) => until(() => page.eval(`Boolean(${expression})`), { message: expression.slice(0, 80), ...options }),
            async waitForNetworkIdle({ quietMs = 500, timeout = 10000 } = {}) {
                await until(() => activeNetworkRequests.size === 0 && Date.now() - lastNetworkActivity >= quietMs,
                    { timeout, interval: 25, message: "the browser network to become idle" });
            },
            /** A real key press (not a synthetic event). */
            async press(key, code = key, keyCode = 0, modifiers = 0) {
                const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
                await send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
                await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
            },
            /** Types text with real key events (each character is a keyDown with text, then a keyUp), so the page gets beforeinput and input like from a keyboard. */
            async type(text) {
                for (const character of text) {
                    await send("Input.dispatchKeyEvent", { type: "keyDown", key: character, text: character, unmodifiedText: character });
                    await send("Input.dispatchKeyEvent", { type: "keyUp", key: character });
                }
            },
            /** A real click in the middle of the element that matches the selector. */
            async click(selector) {
                const box = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
                if (!box) throw new Error(`nothing matches ${selector}`);
                for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
            },
            /** A real drag: the mouse goes down in the middle of the element, moves by dx, dy in steps and goes up. */
            async drag(selector, dx, dy, steps = 8) {
                const box = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
                if (!box) throw new Error(`nothing matches ${selector}`);
                await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
                await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
                for (let i = 1; i <= steps; i++) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + dx * i / steps, y: box.y + dy * i / steps, button: "left", buttons: 1 });
                await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + dx, y: box.y + dy, button: "left", buttons: 0, clickCount: 1 });
            },
            /** A real click on the first button, link or tab whose text is exactly this (inside the selector, default: the whole page). */
            async clickText(text, scope = "body") {
                const box = await page.eval(`(() => { const found = [...document.querySelector(${JSON.stringify(scope)}).querySelectorAll("button, a, [role=button], [role=tab], summary, label")].find(el => el.textContent.trim() === ${JSON.stringify(text)} && el.getClientRects().length); if (!found) return null; found.scrollIntoView({ block: "center", behavior: "instant" }); const r = found.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
                if (!box) throw new Error(`no button with the text "${text}"`);
                for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
            },
            /** Types into an input the way a person does: the value, the input event and the change event. */
            fill: (selector, value) => page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("nothing matches ${selector.replace(/"/g, '\\"')}"); el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`),
            async close() {
                try { await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`); } catch { /* the browser is gone already */ }
                socket.close();
            }
        };
        return page;
    }

    return {
        newPage,
        async close() {
            // The helper processes of Chrome (GPU, renderers) keep the profile open after the main process is gone: on Windows the whole tree is stopped.
            // A profile that is left behind is 10 to 270 MB of the temporary folder for every run: 60 of them filled a disk.
            const exited = new Promise(resolve => child.once("exit", resolve));
            if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
            else child.kill();
            await Promise.race([exited, wait(3000)]);
            for (let attempt = 0; attempt < 24; attempt++) {
                try {
                    rmSync(profile, { recursive: true, force: true });
                    return;
                } catch {
                    await wait(250);                         // a file is still locked for a moment
                }
            }
        }
    };
}
