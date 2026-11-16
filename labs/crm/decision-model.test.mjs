import test from "node:test";
import assert from "node:assert/strict";
import {
  cohortBounds,
  compareCohorts,
  assumedGap,
  tieBoundary,
  evidenceToIdentify,
} from "./decision-model.mjs";
import { mixReversal, censoringReversal } from "./decision-examples.mjs";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const compare = (x) => compareCohorts(x.a, x.b, x.weights);
test("complete constructed cohorts exhibit a genuine Simpson reversal", () => {
  const c = compare(mixReversal);
  near(c.crude.a.lower, 0.82);
  near(c.crude.b.lower, 0.28);
  near(c.a.lower, 0.5);
  near(c.b.lower, 0.6);
  near(c.lower, -0.1);
  near(c.upper, -0.1);
  assert.equal(c.conclusion, "B dominates for this finite cohort");
});
test("unresolved cases permit opposite rankings without changing observed data", () => {
  const c = compare(censoringReversal);
  near(c.lower, -0.4);
  near(c.upper, 0.2);
  near(assumedGap(c, 0, 0), 0.1);
  near(assumedGap(c, 0, 1), -0.4);
  near(assumedGap(c, 1, 0), c.upper);
  near(assumedGap(c, 0, 1), c.lower);
  near(tieBoundary(c, 0.3).qA, 0.5);
  assert.equal(c.conclusion, "Ranking is not identified");
});
test("sharp bounds contain every possible finite completion; extrema attained", () => {
  const rows = [
    { stratum: "x", wins: 2, nonwins: 1, unresolved: 2 },
    { stratum: "y", wins: 0, nonwins: 2, unresolved: 3 },
  ];
  const weights = { x: 0.3, y: 0.7 },
    c = cohortBounds(rows, weights),
    values = [];
  for (let x = 0; x <= 2; x++)
    for (let y = 0; y <= 3; y++)
      values.push((0.3 * (2 + x)) / 5 + (0.7 * y) / 5);
  near(Math.min(...values), c.lower);
  near(Math.max(...values), c.upper);
});
test("resolving an unresolved record can only shrink its identification interval", () => {
  for (let w = 0; w <= 8; w++) {
    const before = cohortBounds([
      { stratum: "x", wins: w, nonwins: 2, unresolved: 3 },
    ]);
    for (const win of [0, 1]) {
      const after = cohortBounds([
        { stratum: "x", wins: w + win, nonwins: 3 - win, unresolved: 2 },
      ]);
      assert.ok(after.lower >= before.lower);
      assert.ok(after.upper <= before.upper + 1e-12);
    }
  }
});
test("evidence threshold is strict, outcome-dependent, and sufficient", () => {
  const c = compare(censoringReversal),
    evidence = evidenceToIdentify(c, "A");
  assert.equal(evidence.minimumFavorableResolutions, 41);
  assert.equal(evidenceToIdentify(c, "B").minimumFavorableResolutions, 21);
  assert.equal(evidenceToIdentify(compare(mixReversal), "A").possible, false);
  assert.equal(
    evidenceToIdentify(compare(mixReversal), "B").minimumFavorableResolutions,
    0,
  );
  const gain = evidence.plan.reduce(
    (s, r) => s + r.records * r.gainPerRecord,
    0,
  );
  assert.ok(c.lower + gain > 0);
  near(c.lower + gain - 0.01, 0);
});
test("missing strata, impossible counts and invalid sensitivity cannot silently become zero", () => {
  assert.throws(() =>
    cohortBounds([{ stratum: "x", wins: 0, nonwins: 0, unresolved: 0 }]),
  );
  assert.throws(() =>
    compareCohorts(mixReversal.a, mixReversal.b.slice(1), mixReversal.weights),
  );
  assert.throws(() => cohortBounds(mixReversal.a, { easy: 0.4, hard: 0.4 }));
  assert.throws(() => assumedGap(compare(censoringReversal), 1.01, 0));
});
test("complete equal cohorts identify equality rather than an unknown ranking", () => {
  const a = [{ stratum: "x", wins: 1, nonwins: 1, unresolved: 0 }];
  const b = [{ stratum: "x", wins: 20, nonwins: 20, unresolved: 0 }];
  const c = compareCohorts(a, b, { x: 1 });
  assert.equal(c.conclusion, "Equal conversion for this finite cohort");
  near(c.lower, 0);
  near(c.upper, 0);
  assert.equal(evidenceToIdentify(c, "A").possible, false);
  assert.equal(evidenceToIdentify(c, "B").possible, false);
});
