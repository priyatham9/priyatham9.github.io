// A finite observed cohort; bounds are identification bounds, not confidence intervals.
// 'nonwins' means known not to have won by the declared horizon, not merely still open.
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
function checkCounts(row) {
  for (const key of ["wins", "nonwins", "unresolved"]) {
    if (!Number.isSafeInteger(row[key]) || row[key] < 0)
      throw new RangeError(`Invalid ${key}`);
  }
  const n = row.wins + row.nonwins + row.unresolved;
  if (!Number.isSafeInteger(n) || !n)
    throw new RangeError("Each stratum needs a nonempty denominator");
  return n;
}
export function cohortBounds(rows, weights = null) {
  if (!Array.isArray(rows) || !rows.length)
    throw new RangeError("Missing cohort strata");
  const names = rows.map((r) => r.stratum);
  if (
    names.some((s) => typeof s !== "string" || !s) ||
    new Set(names).size !== names.length
  )
    throw new RangeError("Strata must have unique names");
  const ns = rows.map(checkCounts),
    total = sum(ns);
  if (weights !== null) {
    if (
      Object.keys(weights).length !== names.length ||
      names.some(
        (s) =>
          !Object.hasOwn(weights, s) ||
          !Number.isFinite(weights[s]) ||
          weights[s] < 0,
      )
    )
      throw new RangeError("Supply a weight for every observed stratum");
    if (Math.abs(sum(Object.values(weights)) - 1) > 1e-12)
      throw new RangeError("Target weights must sum to one");
  }
  const strata = rows.map((r, i) => ({
    ...r,
    n: ns[i],
    weight: weights === null ? ns[i] / total : weights[r.stratum],
    lower: r.wins / ns[i],
    upper: (r.wins + r.unresolved) / ns[i],
  }));
  const lower = sum(strata.map((s) => s.weight * s.lower));
  const unresolvedMass = sum(
    strata.map((s) => (s.weight * s.unresolved) / s.n),
  );
  return {
    total,
    lower,
    upper: lower + unresolvedMass,
    unresolvedMass,
    strata,
  };
}
export function compareCohorts(aRows, bRows, weights) {
  if (!weights) throw new RangeError("Declare a common target population mix");
  const a = cohortBounds(aRows, weights),
    b = cohortBounds(bRows, weights);
  const lower = a.lower - b.upper,
    upper = a.upper - b.lower;
  const tied = Math.abs(lower) <= 1e-12 && Math.abs(upper) <= 1e-12;
  return {
    a,
    b,
    lower,
    upper,
    conclusion: tied
      ? "Equal conversion for this finite cohort"
      : lower > 1e-12
        ? "A dominates for this finite cohort"
        : upper < -1e-12
          ? "B dominates for this finite cohort"
          : "Ranking is not identified",
    crude: { a: cohortBounds(aRows), b: cohortBounds(bRows) },
    sensitivity: {
      intercept: a.lower - b.lower,
      aSlope: a.unresolvedMass,
      bSlope: -b.unresolvedMass,
    },
  };
}
export function assumedGap(comparison, qA, qB) {
  if (![qA, qB].every((q) => Number.isFinite(q) && q >= 0 && q <= 1))
    throw new RangeError("Resolution fractions must lie in [0,1]");
  const { intercept, aSlope, bSlope } = comparison.sensitivity;
  return intercept + aSlope * qA + bSlope * qB;
}
export function tieBoundary(comparison, qB) {
  assumedGap(comparison, 0, qB);
  const { intercept, aSlope, bSlope } = comparison.sensitivity;
  if (aSlope === 0)
    return {
      qA: null,
      feasible: false,
      reason: "A has no unresolved target mass",
    };
  const qA = -(intercept + bSlope * qB) / aSlope;
  return { qA, feasible: qA >= 0 && qA <= 1 };
}
// Exact best-case number of favorable resolutions needed for strict finite-cohort
// dominance. It is an evidence requirement, not a forecast that these outcomes occur.
export function evidenceToIdentify(comparison, winner = "A") {
  if (!["A", "B"].includes(winner))
    throw new RangeError("Winner must be A or B");
  const own = winner === "A" ? comparison.a : comparison.b;
  const other = winner === "A" ? comparison.b : comparison.a;
  const deficit = other.upper - own.lower;
  const cells = [
    ...own.strata.map((s) => ({
      channel: winner,
      stratum: s.stratum,
      requiredOutcome: "win by horizon",
      available: s.unresolved,
      gainPerRecord: s.weight / s.n,
    })),
    ...other.strata.map((s) => ({
      channel: winner === "A" ? "B" : "A",
      stratum: s.stratum,
      requiredOutcome: "nonwin by horizon",
      available: s.unresolved,
      gainPerRecord: s.weight / s.n,
    })),
  ]
    .filter((s) => s.available && s.gainPerRecord)
    .sort((x, y) => y.gainPerRecord - x.gainPerRecord);
  let remaining = deficit,
    count = 0;
  const plan = [];
  for (const cell of cells) {
    if (remaining < -1e-12) break;
    const needed = Math.min(
      cell.available,
      Math.max(0, Math.floor((remaining + 1e-12) / cell.gainPerRecord) + 1),
    );
    if (needed) plan.push({ ...cell, records: needed });
    count += needed;
    remaining -= needed * cell.gainPerRecord;
  }
  return {
    possible: remaining < -1e-12,
    minimumFavorableResolutions: remaining < -1e-12 ? count : null,
    currentGapToStrictDominance: deficit,
    plan,
    caveat:
      "Best-case favorable outcomes only. Identification of a finite-cohort ranking does not identify the causal effect of reallocating spend.",
  };
}
