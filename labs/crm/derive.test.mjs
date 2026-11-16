import test from "node:test";
import assert from "node:assert/strict";
import { cohorts, pipeline } from "../models.mjs";
import { deriveCohort, compareTransition } from "./derive.mjs";
test("sources reconcile at every milestone and transition", () => {
  const all = deriveCohort(cohorts.all),
    inbound = deriveCohort(cohorts.inbound),
    outbound = deriveCohort(cohorts.outbound);
  all.stages.forEach((n, i) =>
    assert.equal(n, inbound.stages[i] + outbound.stages[i]),
  );
  all.transitions.forEach((t, i) => {
    assert.equal(
      t.loss,
      inbound.transitions[i].loss + outbound.transitions[i].loss,
    );
    assert.equal(t.reached + t.loss, t.previous);
    assert.equal(t.conversion, t.reached / t.previous);
  });
  assert.deepEqual(
    all.largestLoss.map((t) => t.index),
    [1, 2],
  );
  assert.deepEqual(
    all.lowestConversion.map((t) => t.index),
    [3, 4],
  );
  assert.equal(outbound.transitions[3].conversion, 3 / 13);
});
test("stage loss reconciles to not-won count, with source-specific denominators", () => {
  for (const key of Object.keys(cohorts)) {
    const d = deriveCohort(cohorts[key]),
      p = pipeline(key, 0.6);
    assert.equal(
      d.transitions.reduce((n, t) => n + t.loss, 0),
      p.lost,
    );
    assert.equal(d.transitions.at(-1).retained, p.winRate);
    assert.equal(p.forecast, cohorts[key][3] * 0.6);
    assert.equal(p.increment, p.forecast - cohorts[key][4]);
  }
});
test("empty cohorts have no fabricated conversion; invalid cumulative input is rejected", () => {
  const empty = deriveCohort([0, 0, 0, 0, 0]);
  assert.equal(empty.empty, true);
  assert.deepEqual(empty.lowestConversion, []);
  assert.ok(
    empty.transitions.every(
      (t) => t.conversion === null && t.retained === null,
    ),
  );
  assert.throws(() => deriveCohort([10, 11, 5, 2, 1]), RangeError);
  assert.throws(() => deriveCohort([10, 5, 3, 2]), RangeError);
});

test("source gaps compare matching conditional denominators in percentage points", () => {
  const close = compareTransition(cohorts.inbound, cohorts.outbound, 4);
  assert.equal(close.inbound.previous, 35);
  assert.equal(close.outbound.previous, 13);
  assert.ok(Math.abs(close.gapPoints - (21 / 35 - 3 / 13) * 100) < 1e-10);
  assert.equal(
    compareTransition(cohorts.inbound, cohorts.outbound, 3).gapPoints,
    0,
  );
  assert.equal(
    compareTransition([0, 0, 0, 0, 0], cohorts.outbound, 4).gapPoints,
    null,
  );
  assert.throws(
    () => compareTransition(cohorts.inbound, cohorts.outbound, 0),
    RangeError,
  );
});
