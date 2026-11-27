// Checks of what Athena 2.6.0 brought to Odin, with real input in headless Chrome
import { launch, until } from "./cdp.mjs";

const port = process.argv[2] ?? "45461";
const browser = await launch();
try {
    const page = await browser.newPage({ front: true });
    await page.goto(`http://127.0.0.1:${port}/#/dashboard`);
    await page.waitFor(`document.querySelectorAll(".chart svg.athena-chart").length >= 4`, { timeout: 20000 });
    await new Promise(r => setTimeout(r, 800));
    const report = {};
    // 1. the time of the table of values is short
    report.timeCell = await page.eval(`(() => { const d = document.querySelector(".chart .chart-data"); d.open = true; return d.querySelector("tbody th")?.textContent; })()`);
    // 2. the plot is focusable; the arrow keys move the tooltip
    report.plot = await page.eval(`(() => { const hit = document.querySelector(".chart .chart-hit"); return hit ? { tabindex: hit.getAttribute("tabindex"), label: hit.getAttribute("aria-label") } : null; })()`);
    await page.eval(`document.querySelector(".chart .chart-hit").focus()`);
    await page.press("ArrowRight", "ArrowRight", 39);
    report.afterArrow = await page.eval(`[...document.querySelectorAll(".chart .is-visible text")].map(t => t.textContent).join(" | ")`);
    await page.press("Escape", "Escape", 27);
    report.afterEscape = await page.eval(`document.querySelectorAll(".chart .is-visible").length`);
    // 3. no dots on the long lines
    report.dots = await page.eval(`[...document.querySelectorAll(".chart")].map(c => c.querySelectorAll(".chart-point:not(.chart-lone-point)").length)`);
    // 4. a notice appears at the bottom right and the Add button stays clickable
    await page.goto(`http://127.0.0.1:${port}/#/zones`);
    await page.waitFor(`document.querySelector("table") || document.querySelector(".empty")`, { timeout: 15000 });
    report.toast = await page.eval(`(async () => {
        const { notice } = await import("/js/ui.js");
        notice("ok", "Zone saved");
        await new Promise(r => setTimeout(r, 300));
        const box = document.querySelector(".toast-container").getBoundingClientRect();
        const add = [...document.querySelectorAll("button")].find(b => /Add zone/.test(b.textContent))?.getBoundingClientRect();
        return { toast: { left: Math.round(box.left), top: Math.round(box.top), right: Math.round(window.innerWidth - box.right), bottom: Math.round(window.innerHeight - box.bottom) },
                 addTop: add && Math.round(add.top), coveredAdd: add ? document.elementFromPoint(add.left + 5, add.top + 5)?.closest(".toast") != null : null };
    })()`);
    console.log(JSON.stringify(report, null, 2));
    console.log("problems:", JSON.stringify(page.problems));
} finally {
    await browser.close();
}
