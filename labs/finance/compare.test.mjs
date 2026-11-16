import test from "node:test";
import assert from "node:assert/strict";
import { snapshot, cashBridge } from "./compare.mjs";
const inputs = { revenue: 12000000, cogs: 7200000, dso: 45, dio: 60, dpo: 30 };
test("pins retain immutable complete scenarios", () => {
  const original = { ...inputs }, pinned = snapshot(original);
  original.revenue = 0;
  assert.equal(pinned.inputs.revenue, 12000000);
  assert.ok(Object.isFrozen(pinned.inputs));
  assert.ok(Object.isFrozen(pinned.result));
});
test("cash bridge reconciles positive, negative, zero and upper-bound cases", () => {
  for (const revenue of [0, 12000000, 1e12]) for (const cogs of [0, 7200000, 1e12]) for (const dso of [15, 45, 75]) for (const dio of [20, 60, 100]) for (const dpo of [10, 30, 75]) {
    const result = cashBridge({ revenue, cogs, dso, dio, dpo });
    const tolerance = Math.max(1, result.baseline.ar, result.baseline.inventory, result.baseline.ap, result.scenario.ar, result.scenario.inventory, result.scenario.ap) * 1e-12;
    assert.ok(Math.abs(result.steps.at(-1).end - result.scenario.nwc) < tolerance);
    assert.ok(Math.abs(result.steps.reduce((sum, step) => sum + step.value, 0) + result.release) < tolerance);
  }
  assert.ok(cashBridge({ ...inputs, revenue: 0, dio: 20, dpo: 75 }).scenario.nwc < 0);
  assert.equal(cashBridge(inputs).release, 0);
});
test("snapshot rejects invalid and unbounded inputs", () => {
  for (const [key, value] of [["revenue", -1], ["revenue", Infinity], ["cogs", 1e12 + 1], ["cogs", null], ["dso", 1], ["dso", 35.5], ["dio", NaN], ["dpo", 76]]) assert.throws(() => snapshot({ ...inputs, [key]: value }), RangeError);
});
