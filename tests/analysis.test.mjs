import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../api/analysis.mjs";
import { createDevServer } from "../scripts/dev-server.mjs";
const request = (body, options = {}) =>
  new Request("http://localhost/api/analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...options,
  });
test("finance independently computes accounting identity and CRM computes weighted forecast", async () => {
  const finance = await (
    await handle(
      request({
        model: "finance",
        inputs: { revenue: 36500, cogs: 18250, dso: 30, dio: 60, dpo: 20 },
      }),
    )
  ).json();
  assert.equal(finance.result.nwc, 5000);
  assert.equal(finance.result.ccc, 70);
  assert.equal(finance.synthetic, true);
  assert.equal(finance.version, "1.0.0");
  const crm = await (
    await handle(
      request({ model: "crm", inputs: { cohort: "inbound", rate: 0.8 } }),
    )
  ).json();
  assert.equal(crm.result.forecast, 28);
  assert.equal(crm.result.increment, 7);
});
test("rejects malformed, unknown, nonfinite and out-of-bounds input", async () => {
  for (const body of [
    null,
    [],
    {},
    { model: "bad", inputs: {} },
    { model: "finance", inputs: [] },
    { model: "finance", inputs: { extra: 1 } },
    { model: "finance", inputs: { dso: -1 } },
    { model: "finance", inputs: { dso: "45" } },
    { model: "finance", inputs: { revenue: null } },
    { model: "crm", inputs: { cohort: "constructor" } },
    { model: "crm", inputs: { rate: 1.01 } },
    { model: "finance", inputs: {}, extra: true },
  ])
    assert.equal((await handle(request(body))).status, 400);
  assert.equal((await handle(request({}, { body: '{"model":' }))).status, 400);
  assert.equal(
    (
      await handle(
        request({}, { body: '{"model":"finance","inputs":{"dso":1e999}}' }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await handle(request({}, { body: " ".repeat(4097) }))).status,
    413,
  );
  assert.equal(
    (await handle(new Request("http://localhost", { method: "PUT" }))).status,
    405,
  );
  assert.equal(
    (await handle(request({}, { headers: { "Content-Type": "text/plain" } })))
      .status,
    415,
  );
});
test("HTTP server serves portfolio and API, blocks sensitive files and traversal", async (t) => {
  const server = createDevServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + "/")).status, 200);
  const capability = await fetch(base + "/api/analysis");
  assert.equal(capability.status, 200);
  assert.deepEqual(await capability.json(), { version: "1.0.0", synthetic: true, models: ["finance", "crm"] });
  const response = await fetch(base + "/api/analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "crm", inputs: {} }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.forecast, 24);
  for (const path of [
    "/.git/config",
    "/scripts/dev-server.mjs",
    "/%2e%2e%2fpackage.json",
  ])
    assert.equal((await fetch(base + path)).status, 403);
  assert.equal((await fetch(base + "/api/missing")).status, 404);
});
