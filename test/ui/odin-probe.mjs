// Loads the Odin UI and prints what the page complains about: node odin-probe.mjs [route] [port]
import { launch } from "./cdp.mjs";

const route = process.argv[2] ?? "dashboard";
const port = process.argv[3] ?? "45461";
const browser = await launch();
try {
    const page = await browser.newPage({ front: true });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page.goto(`http://127.0.0.1:${port}/#/${route}`);
    await page.eval(`new Promise(resolve => setTimeout(resolve, 4000))`);
    console.log("body:", String(await page.eval(`document.body.innerText.slice(0, 300)`)).replace(/\s+/g, " "));
    console.log("problems:\n" + page.problems.map(item => " - " + item.slice(0, 400)).join("\n"));
} finally {
    await browser.close();
}
