import test from "node:test";
import assert from "node:assert/strict";
import {
  snapshotPolicy,
  comparePolicySnapshots,
} from "./decision-comparison.mjs";
import { base, policies, assumptions } from "./decision-examples.mjs";
const source = () => ({
  base: structuredClone(base),
  policy: {
    salesLoss: 0,
    discount: 0,
    discountShare: 0,
    supplierPremium: 0,
    supplierShare: 1,
    annualOperatingCost: 0,
    setupCost: 0,
    ...policies.customerDiscount,
  },
  assumptions: structuredClone(assumptions),
  provenance: "Constructed",
  status: "Example",
  startingCase: "customerDiscount",
});

test("pin owns and freezes complete nested context independently of later edits", () => {
  const original = source(),
    pinned = snapshotPolicy(original),
    serialized = JSON.stringify(pinned);
  original.base.revenue *= 2;
  original.policy.discount = 0.05;
  original.assumptions.limits.dso[0] = 0;
  assert.equal(JSON.stringify(pinned), serialized);
  assert.throws(() => {
    pinned.assumptions.rate = 0.5;
  }, TypeError);
  assert.throws(() => {
    pinned.assumptions.limits.dso[0] = 1;
  }, TypeError);
});

test("context changes are explicit even when policy fields are identical", () => {
  const a = source(),
    pinned = snapshotPolicy(a);
  a.base.revenue *= 2;
  a.assumptions.rate = 0.2;
  a.assumptions.years = 5;
  const current = snapshotPolicy(a),
    comparison = comparePolicySnapshots(pinned, current);
  assert.equal(comparison.sameContext, false);
  assert.deepEqual(
    comparison.changes.map((c) => c.path),
    ["base.revenue", "assumptions.rate", "assumptions.years"],
  );
  assert.equal(
    comparison.currentMinusPinnedNpv,
    current.result.npv - pinned.result.npv,
  );
});

test("policy-only edits retain a common context and enumerate the altered field", () => {
  const a = source(),
    pinned = snapshotPolicy(a);
  a.policy.discount = 0.001;
  const current = snapshotPolicy(a),
    comparison = comparePolicySnapshots(pinned, current);
  assert.equal(comparison.sameContext, true);
  assert.deepEqual(
    comparison.changes.map((c) => c.path),
    ["policy.discount"],
  );
  assert.ok(comparison.currentMinusPinnedNpv > 0);
});

test("feasibility constraint changes remain visible even when NPV is unchanged", () => {
  const a = source(),
    pinned = snapshotPolicy(a);
  a.assumptions.limits.dso[0] = 40;
  const current = snapshotPolicy(a),
    comparison = comparePolicySnapshots(pinned, current);
  assert.equal(comparison.currentMinusPinnedNpv, 0);
  assert.equal(comparison.sameContext, false);
  assert.equal(current.result.feasible, false);
  assert.equal(pinned.result.feasible, true);
  assert.equal(comparison.changes[0].group, "Constraints");
});

test("snapshot recalculates instead of accepting a supplied stale result", () => {
  const input = source();
  input.result = { npv: 123456 };
  const a = snapshotPolicy(input),
    b = snapshotPolicy(source());
  assert.equal(a.result.npv, b.result.npv);
  assert.deepEqual(comparePolicySnapshots(a, b).changes, []);
});

test("omitted optional policy fields use the evaluator defaults in comparisons", () => {
  const input = source();
  input.policy = { dso: 35, dio: 60, dpo: 30 };
  const pinned = snapshotPolicy(input);
  assert.equal(pinned.policy.supplierShare, 0);
  input.policy.discount = 0.01;
  input.policy.discountShare = 1;
  assert.deepEqual(
    comparePolicySnapshots(pinned, snapshotPolicy(input)).changes.map(
      (c) => c.path,
    ),
    ["policy.discount", "policy.discountShare"],
  );
});
