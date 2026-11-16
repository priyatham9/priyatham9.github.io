import assert from "node:assert/strict";
import {
  readScenario,
  scenarioURL,
  resetScenarioURL,
  csv,
  MODEL_VERSION,
} from "./scenario-tools.mjs";
assert.deepEqual(readScenario("finance", "?dso=15&dio=100&dpo=75"), {
  dso: 15,
  dio: 100,
  dpo: 75,
});
assert.deepEqual(readScenario("finance", "?dso=NaN&dio=101&dpo=-1"), {
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
      ? { dso: 75, dio: 20, dpo: 10 }
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
assert.equal(MODEL_VERSION, "1.0.0");
console.log(
  "Passed scenario URL roundtrip, bounded parsing, invalid values, reset preservation, CSV escaping and formula injection protection.",
);
