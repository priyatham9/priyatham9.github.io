const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    process.env.FOUNDRY_URL || "http://localhost:8140/labs/foundry/",
  );
  await page.waitForSelector(".yield-plot");
  assert.equal(await page.locator("#comparison-view").isVisible(), true);
  assert.equal(await page.locator("#objects-view").isVisible(), false);
  await page.screenshot({ path: "/tmp/foundry-desktop.png", fullPage: true });
  await page.click("#objects-tab");
  assert.equal(await page.locator(".graph-node").count(), 5);
  await page.screenshot({
    path: "/tmp/foundry-objects-desktop.png",
    fullPage: true,
  });
  await page.locator('[data-entity="LAB-118"]').click();
  assert.match(
    await page.locator("#inspector").innerText(),
    /One lot-level sample/,
  );
  await page.click("#comparison-tab");
  await page.selectOption("#scope", "supplier");
  assert.equal(await page.locator("#comparator").isVisible(), true);
  assert.equal(await page.locator("#rows tr").count(), 3);
  await page.click("#comparator");
  assert.equal(await page.locator("#scope").inputValue(), "equipment");
  assert.match(await page.locator("#rows").innerText(), /B-245/);
  await page.selectOption("#batch", "B-244");
  assert.match(
    await page.locator("#evidence").innerText(),
    /Hypothesis withheld/,
  );
  assert.match(await page.locator("#plot").innerText(), /Pending lab/);
  await page.selectOption("#scope", "supplier");
  await page.locator('[data-evidence="B-241"]').uncheck();
  await page.locator('[data-evidence="B-242"]').uncheck();
  await page.fill("#review-note", "Check pending sample");
  await page.click("#simulate");
  const downloadPromise = page.waitForEvent("download");
  await page.click("#export");
  const download = await downloadPromise;
  await download.saveAs("/tmp/foundry-review.json");
  const draft = JSON.parse(
    require("fs").readFileSync("/tmp/foundry-review.json"),
  );
  assert.equal(draft.evidence.length, 1);
  assert.equal(draft.labResults[0].moisture, null);
  assert.equal(draft.selectedBatch, "B-244");
  await page.locator('[data-evidence="B-244"]').uncheck();
  assert.equal(await page.locator("#export").isDisabled(), true);
  assert.equal(await page.locator("#simulate").isDisabled(), true);
  await page.click("#reset");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () =>
      document.querySelector(".yield-plot").getAttribute("viewBox") ===
      "0 0 360 300",
  );
  await page.screenshot({ path: "/tmp/foundry-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.equal(
    await page
      .locator("#plot")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  await page.locator("#comparison-tab").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.locator("#objects-tab").getAttribute("aria-selected"),
    "true",
  );
  await page.screenshot({
    path: "/tmp/foundry-objects-mobile.png",
    fullPage: true,
  });
  await page.selectOption("#entity-select", "northstar");
  assert.match(
    await page.locator("#inspector").innerText(),
    /Synthetic supplier register/,
  );
  await page.locator('[data-entity="LAB-118"]').focus();
  await page.keyboard.press("Enter");
  assert.match(await page.locator("#inspector").innerText(), /LAB-118/);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.click("#comparison-tab");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.equal(
    await page
      .locator("#plot")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: graph, scope/comparator, pending result, evidence selection/export, invalidation, mobile overflow, keyboard object navigation; no page errors",
  );
  await browser.close();
})();
