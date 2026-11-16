import assert from "node:assert/strict";
import {
  readScenario,
  scenarioURL,
  resetScenarioURL,
  csv,
  MODEL_VERSION,
  parseBusinessAmount,
} from "./scenario-tools.mjs";
assert.deepEqual(readScenario("finance", "?dso=15&dio=100&dpo=75"), {
  revenue: 12000000,
  cogs: 7200000,
  dso: 15,
  dio: 100,
  dpo: 75,
});
assert.deepEqual(readScenario("finance", "?dso=NaN&dio=101&dpo=-1"), {
  revenue: 12000000,
  cogs: 7200000,
  dso: 45,
  dio: 60,
  dpo: 30,
});
for (const input of ["", " ", "Infinity", "12.5", "1e309", "<script>", "76"])
  assert.equal(
    readScenario("finance", new URLSearchParams({ dso: input }).toString()).dso,
    45,
  );
assert.deepEqual(readScenario("crm", "?cohort=outbound&rate=0"), {
  rate: 0,
  cohort: "outbound",
});
assert.deepEqual(readScenario("crm", "?cohort=__proto__&rate=101"), {
  rate: 50,
  cohort: "all",
});
for (const model of ["finance", "crm"]) {
  const state =
    model === "finance"
      ? { revenue: 25000000.25, cogs: 0, dso: 75, dio: 20, dpo: 10 }
      : { cohort: "inbound", rate: 100 };
  const url = scenarioURL(
    model,
    state,
    "https://example.com/labs/" + model + "/?unrelated=yes#model",
  );
  assert.deepEqual(readScenario(model, new URL(url).search), state);
  assert.equal(new URL(url).hash, "#model");
  const reset = new URL(resetScenarioURL(model, url));
  assert.equal(reset.search, "?unrelated=yes");
  assert.equal(reset.hash, "#model");
}
assert.equal(
  csv([["a,b", 'a"b', "a\nb", -12, "=SUM(A1)"]]),
  '"a,b","a""b","a\nb","-12","\'=SUM(A1)"\r\n',
);
assert.equal(MODEL_VERSION, "1.1.0");
console.log(
  "Passed scenario URL roundtrip, bounded parsing, invalid values, reset preservation, CSV escaping and formula injection protection.",
);

for (const raw of [
  "",
  " ",
  "-1",
  "Infinity",
  "NaN",
  "1e309",
  "1000000000001",
  undefined,
  null,
])
  assert.equal(parseBusinessAmount(raw), null);
for (const raw of ["0", "0.01", "1000000000000"])
  assert.equal(parseBusinessAmount(raw), Number(raw));
assert.equal(
  readScenario("finance", "?revenue=&cogs=Infinity").revenue,
  12000000,
);
assert.equal(
  readScenario("finance", "?revenue=1000000000000&cogs=0").revenue,
  1e12,
);
import { cash } from "./models.mjs";
for (const scale of [0, 0.5, 2, 1e12 / 12000000]) {
  const base = cash({ revenue: 12000000 * scale, cogs: 7200000 * scale }),
    scenario = cash({
      revenue: 12000000 * scale,
      cogs: 7200000 * scale,
      dso: 30,
    });
  assert.ok(Number.isFinite(base.nwc) && Number.isFinite(scenario.nwc));
  assert.ok(
    Math.abs(base.nwc - scenario.nwc - ((12000000 * scale) / 365) * 15) < 0.001,
  );
  assert.equal(
    cash({ revenue: 12000000 * scale, cogs: 7200000 * scale }).ccc,
    75,
  );
}
assert.equal(cash({ revenue: 0, cogs: 0 }).nwc, 0);
