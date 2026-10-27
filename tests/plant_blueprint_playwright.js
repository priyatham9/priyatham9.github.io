// Browser check for work/plant-blueprint.html (headless Chromium via playwright).
// Confirms: canvas renders (frames advance, pixels non-blank), no console errors,
// insight panel opens on a unit click, same seed gives the same event log in the
// page, and the 2D fallback works when three.js is blocked.
// Usage: node tests/plant_blueprint_playwright.js [outdir]   (screenshots go to outdir, default os.tmpdir())
// The pinned cdnjs three.js URL is served from THREE_MIN (path to three.min.js r160) when set,
// otherwise fetched from the network.
"use strict";
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path");
const page_url = "file://" + path.join(__dirname, "..", "work", "plant-blueprint.html");
const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js";
const out = process.argv[2] || os.tmpdir();
let failed = 0;
const ok = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (x ? "  " + x : "")); if (!c) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  async function open(blockThree) {
    const pg = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), errs = [];
    pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    pg.on("pageerror", (e) => errs.push("pageerror " + e.message));
    await pg.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ body: "", contentType: "text/css" }));
    if (blockThree) await pg.route(THREE_URL, (r) => r.abort());
    else if (process.env.THREE_MIN) await pg.route(THREE_URL, (r) => r.fulfill({ body: fs.readFileSync(process.env.THREE_MIN), contentType: "application/javascript" }));
    await pg.goto(page_url); await pg.waitForFunction(() => window.__plant && window.__plantFrames > 5, null, { timeout: 15000 });
    return { pg, errs };
  }

  // WebGL path
  let { pg, errs } = await open(false);
  ok("webgl mode", (await pg.evaluate(() => document.body.dataset.render)) === "webgl");
  const f1 = await pg.evaluate(() => window.__plantFrames); await pg.waitForTimeout(600);
  ok("frames advance", (await pg.evaluate(() => window.__plantFrames)) > f1);
  const buf = await pg.locator("#gl").screenshot(); // non-blank check: more than a few distinct bytes
  ok("canvas not blank", new Set(buf.subarray(2000, 9000)).size > 20);
  ok("sim banner visible", await pg.locator("#simBanner").isVisible());
  // click a unit: find the reactor on screen by trying a grid of points
  const box = await pg.locator("#gl").boundingBox(); let opened = false;
  await pg.click("#tabbtn-sensors"); await pg.click("#overview button[data-u='T-302']"); // selects T-302
  ok("overview selects unit", (await pg.evaluate(() => window.__plant.S.selected)) === "T-302");
  await pg.click("#tabbtn-insight");
  for (let y = box.y + box.height * 0.25; y < box.y + box.height * 0.9 && !opened; y += 24)
    for (let x = box.x + 40; x < box.x + box.width - 40 && !opened; x += 24) {
      await pg.mouse.click(x, y);
      const sel = await pg.evaluate(() => window.__plant.S.selected);
      const h = await pg.locator("#tab-insight .ins-t").count();
      if (sel !== "T-302" && h) opened = true;
    }
  ok("canvas click selects a unit and opens the insight panel", opened, await pg.evaluate(() => window.__plant.S.selected));
  ok("insight panel cites a source file", /github\.com\/priyatham9\/ehs-/.test(await pg.locator("#tab-insight").innerHTML()));
  // layer toggle
  await pg.uncheck("#ly-piping"); await pg.waitForTimeout(100); await pg.check("#ly-piping");
  // jump to incident, alerts appear, actions work
  await pg.click("#nextinc"); await pg.click("#play"); await pg.waitForTimeout(3500);
  await pg.click("#tabbtn-log");
  const nAlerts = await pg.locator("#tab-log .alert").count(); ok("alerts raised after jump to incident", nAlerts > 0, "alerts=" + nAlerts);
  await pg.screenshot({ path: path.join(out, "plant-blueprint-incident.png") });
  await pg.locator("#tab-log button[data-a='acknowledge_alert']").first().click();
  ok("acknowledge writes an audit entry", /you \(analyst\)/.test(await pg.locator("#tab-log").innerText()));
  const exported = await pg.evaluate(() => window.__plant.Sim.exportLog(window.__plant.S && JSON.parse(document.getElementById("plant-data").textContent), window.__plant.params, window.__plant.S.log));
  ok("export has banner, seed and log", exported.banner && exported.seed === 3 && exported.log.length > 0);
  // determinism in the page: same seed twice gives the same system log
  const same = await pg.evaluate(() => { const P = window.__plant, D = JSON.parse(document.getElementById("plant-data").textContent); const a = JSON.stringify(P.Sim.systemLog(D, P.params)), b = JSON.stringify(P.Sim.systemLog(D, Object.assign({}, P.params))); return a === b; });
  ok("same seed gives same event log in page", same);
  await pg.evaluate(() => window.scrollTo(0, 0)); await pg.locator(".app").scrollIntoViewIfNeeded(); await pg.screenshot({ path: path.join(out, "plant-blueprint.png") });
  ok("no console errors (webgl)", errs.length === 0, errs.join(" | "));
  await pg.close();

  // fallback path
  ({ pg, errs } = await open(true));
  ok("fallback mode when three.js blocked", (await pg.evaluate(() => document.body.dataset.render)) === "canvas2d");
  ok("fallback message shown", await pg.locator("#fallbackMsg").isVisible());
  const fb = await pg.locator("#fb").boundingBox(); let sel2 = false;
  for (let y = fb.y + fb.height * 0.2; y < fb.y + fb.height * 0.9 && !sel2; y += 20) for (let x = fb.x + 30; x < fb.x + fb.width - 30 && !sel2; x += 20) { await pg.mouse.click(x, y); sel2 = (await pg.evaluate(() => window.__plant.S.selected)) !== "R-101"; }
  ok("fallback click opens a unit panel", sel2);
  await pg.screenshot({ path: path.join(out, "plant-blueprint-fallback.png") });
  const real = errs.filter((e) => !/ERR_FAILED|Failed to load resource/.test(e));
  ok("no script errors in fallback", real.length === 0, real.join(" | "));
  await browser.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
