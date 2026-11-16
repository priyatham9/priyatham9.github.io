import test from "node:test";
import assert from "node:assert/strict";
import {
  STARTER_CONTRACT,
  CHANGE_PRESETS,
  applyPreset,
  evaluateContract,
  compareContracts,
  canonicalJSON,
  sha256,
  reviewBundle,
} from "./contract-model.mjs";
const copy = () => JSON.parse(JSON.stringify(STARTER_CONTRACT));
const result = (c, id) => c.results.find((r) => r.key === id);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
test("pooled rate uses pooled counts and exposure, not an average of facility rates", () => {
  const e = evaluateContract(copy());
  assert.equal(e.valid, true);
  near(result(e, "metric:pooled_rate").value, 2);
  assert.notEqual(result(e, "metric:pooled_rate").value, (2.5 + 1.25) / 2);
  assert.deepEqual(e.diagnostics, []);
});
test("one hours correction reaches exactly five consumers and yields an exact witness path", () => {
  const c = compareContracts(copy(), applyPreset("hours-correction"));
  assert.equal(c.affectedCount, 5);
  assert.equal(c.totalConsumers, 8);
  assert.equal(c.changedOutputCount, 5);
  assert.equal(c.approvable, true);
  assert.deepEqual(c.changedNodes, ["field:north_2024:hours"]);
  assert.deepEqual(
    c.consumers.find((x) => x.key === "action:review_portfolio").path,
    [
      "field:north_2024:hours",
      "metric:pooled_hours",
      "metric:pooled_rate",
      "action:review_portfolio",
    ],
  );
  near(result(c.proposal, "metric:north_rate").value, 10 / 3);
  assert.equal(result(c.proposal, "action:review_north").value, true);
  assert.equal(
    c.consumers.find((x) => x.key === "metric:pooled_cases").affected,
    false,
  );
});
test("metadata changes and object-array order changes do not invalidate calculations", () => {
  const c = compareContracts(copy(), applyPreset("metadata-only"));
  assert.equal(c.affectedCount, 0);
  assert.equal(c.changedOutputCount, 0);
  const next = copy();
  next.objects.reverse();
  next.types.reverse();
  assert.equal(compareContracts(copy(), next).changedNodes.length, 0);
});
test("jointly scaling cases and hours preserves rates and rule states", () => {
  const base = evaluateContract(copy());
  for (const multiplier of [2, 5, 100]) {
    const c = copy();
    for (const o of c.objects.filter((o) => o.type === "annual_report")) {
      o.fields.cases *= multiplier;
      o.fields.hours *= multiplier;
    }
    const e = evaluateContract(c);
    assert.equal(e.valid, true);
    for (const key of [
      "metric:north_rate",
      "metric:south_rate",
      "metric:pooled_rate",
    ])
      near(result(e, key).value, result(base, key).value);
    for (const key of [
      "action:review_north",
      "action:review_south",
      "action:review_portfolio",
    ])
      assert.equal(result(e, key).value, result(base, key).value);
  }
});
test("unit and case-definition drift block consumers instead of reusing stale arithmetic", () => {
  for (const [preset, code] of [
    ["unit-drift", "contract-unit"],
    ["case-drift", "contract-concept"],
  ]) {
    const c = compareContracts(copy(), applyPreset(preset));
    assert.equal(c.approvable, false);
    assert.ok(
      c.proposal.diagnostics.some((d) => d.code === code && d.critical),
    );
    assert.equal(result(c.proposal, "metric:north_rate").value, null);
    assert.equal(result(c.proposal, "action:review_north").value, null);
  }
});
test("equal numeric units do not permit mixing numerator and denominator cohorts", () => {
  const c = compareContracts(copy(), applyPreset("cohort-mismatch"));
  assert.equal(c.affectedCount, 2);
  assert.equal(c.approvable, false);
  assert.ok(c.proposal.diagnostics.some((d) => d.code === "cohort-mismatch"));
  near(result(c.proposal, "metric:pooled_rate").value, 2);
});
test("broken references fail even when all numeric fields remain unchanged", () => {
  const e = evaluateContract(applyPreset("broken-reference"));
  assert.equal(e.valid, false);
  assert.ok(e.diagnostics.some((d) => d.code === "broken-reference"));
  assert.equal(result(e, "metric:north_rate").valid, false);
  assert.equal(result(e, "metric:south_rate").valid, true);
});
test("missing exposure and zero exposure never become a valid zero rate", () => {
  for (const missing of [true, false]) {
    const c = copy();
    if (missing) delete c.objects[2].fields.hours;
    else c.objects[2].fields.hours = 0;
    const e = evaluateContract(c);
    assert.equal(result(e, "metric:north_rate").valid, false);
    assert.equal(result(e, "metric:north_rate").value, null);
  }
});
test("duplicate natural keys and duplicate atomic lineage are different checked failures", () => {
  const c = copy();
  c.objects.push({
    ...JSON.parse(JSON.stringify(c.objects[2])),
    id: "duplicate_report",
  });
  assert.ok(
    evaluateContract(c).diagnostics.some((d) => d.code === "duplicate-grain"),
  );
  const d = copy();
  d.metrics
    .find((m) => m.id === "pooled_cases")
    .inputs.push(
      JSON.parse(
        JSON.stringify(
          d.metrics.find((m) => m.id === "pooled_cases").inputs[0],
        ),
      ),
    );
  assert.ok(
    evaluateContract(d).diagnostics.some((x) => x.code === "duplicate-lineage"),
  );
});
test("summing rates is prohibited even if their unit labels agree", () => {
  const c = copy(),
    spec = c.metrics[0].output;
  c.metrics.push({
    id: "bad_total_rate",
    label: "Invalid rate sum",
    operation: "sum",
    preserveKeys: ["year"],
    critical: true,
    inputs: [
      { metric: "north_rate", expect: spec },
      { metric: "south_rate", expect: spec },
    ],
    output: spec,
  });
  const e = evaluateContract(c);
  assert.ok(e.diagnostics.some((d) => d.code === "nonadditive-sum"));
  assert.equal(result(e, "metric:bad_total_rate").value, null);
});
test("an annual portfolio metric cannot silently mix reporting years", () => {
  const c = copy();
  c.objects[3].fields.year = 2025;
  const e = evaluateContract(c);
  assert.ok(e.diagnostics.some((d) => d.code === "aggregation-context"));
  assert.equal(result(e, "metric:pooled_cases").valid, false);
  assert.equal(result(e, "metric:south_rate").valid, true);
});
test("rate scale is part of the consumer contract and the action threshold binding", () => {
  const c = copy();
  c.metrics[0].scale = 100000;
  assert.ok(
    evaluateContract(c).diagnostics.some((d) => d.code === "rate-unit-scale"),
  );
  c.units.cases_per_100000_hours = {
    dimensions: { case: 1, time: -1 },
    scale: 1 / 100000,
  };
  c.metrics[0].output.unit = "cases_per_100000_hours";
  c.metrics[0].output.rateScale = 100000;
  const e = evaluateContract(c);
  near(result(e, "metric:north_rate").value, 1.25);
  assert.equal(result(e, "action:review_north").valid, false);
  assert.ok(e.diagnostics.some((d) => d.code === "action-contract-rateScale"));
});
test("rate roles are checked independently of each movable input expectation", () => {
  const c = copy();
  c.metrics[0].inputs.reverse();
  const e = evaluateContract(c);
  assert.equal(e.valid, false);
  assert.equal(result(e, "metric:north_rate").value, null);
  assert.ok(e.diagnostics.some((d) => d.code === "rate-unit-dimensions"));
  assert.ok(e.diagnostics.some((d) => d.code === "rate-concept-roles"));
});
function minutesContract(convertValuesAndMultiplier = false) {
  const c = copy();
  c.types[1].fields.hours.unit = "minute";
  for (const m of c.metrics) {
    for (const i of m.inputs)
      if (i.expect.unit === "hour") i.expect.unit = "minute";
    if (m.output.unit === "hour") m.output.unit = "minute";
    if (convertValuesAndMultiplier && m.operation === "rate") m.scale *= 60;
  }
  if (convertValuesAndMultiplier)
    for (const o of c.objects.filter((o) => o.type === "annual_report"))
      o.fields.hours *= 60;
  return c;
}
test("a consistent producer/binding minutes relabel cannot preserve a stale hours output", () => {
  const e = evaluateContract(minutesContract());
  assert.equal(e.valid, false);
  assert.ok(e.diagnostics.some((d) => d.code === "rate-unit-scale"));
  assert.equal(result(e, "metric:pooled_rate").value, null);
});
test("an explicit physically equivalent minutes conversion preserves rates and threshold units", () => {
  const e = evaluateContract(minutesContract(true)),
    base = evaluateContract(copy());
  assert.equal(e.valid, true);
  for (const key of [
    "metric:north_rate",
    "metric:south_rate",
    "metric:pooled_rate",
  ])
    near(result(e, key).value, result(base, key).value);
  for (const key of [
    "action:review_north",
    "action:review_south",
    "action:review_portfolio",
  ])
    assert.equal(result(e, key).value, result(base, key).value);
});
test("optional links cannot form incomplete natural keys or merge unknown cohorts", () => {
  for (const absent of [null, undefined]) {
    const c = copy();
    c.types[1].links.establishment.required = false;
    for (const o of c.objects.filter((o) => o.type === "annual_report")) {
      if (absent === undefined) delete o.links.establishment;
      else o.links.establishment = null;
    }
    c.metrics[0].inputs[1].object = "south_2024";
    const e = evaluateContract(c);
    assert.equal(e.valid, false);
    assert.ok(e.diagnostics.some((d) => d.code === "incomplete-reporting-key"));
    assert.equal(result(e, "metric:north_rate").value, null);
  }
});
test("cyclic and missing metric references terminate with invalid results", () => {
  const c = copy();
  c.metrics[0].inputs[0] = {
    metric: "north_rate",
    expect: c.metrics[0].output,
  };
  const e = evaluateContract(c);
  assert.ok(e.diagnostics.some((d) => d.code === "dependency-cycle"));
  assert.equal(e.valid, false);
  c.metrics[0].inputs[0].metric = "absent";
  assert.ok(
    evaluateContract(c).diagnostics.some((d) => d.code === "unknown-metric"),
  );
});
test("removing or rebinding consumers uses old and new dependency edges", () => {
  const c = copy();
  c.metrics = c.metrics.filter((m) => m.id !== "north_rate");
  c.actions = c.actions.filter((a) => a.id !== "review_north");
  const x = compareContracts(copy(), c);
  assert.ok(x.consumers.find((r) => r.key === "metric:north_rate").affected);
  assert.equal(
    x.consumers.find((r) => r.key === "metric:north_rate").after,
    null,
  );
  const y = compareContracts(copy(), applyPreset("cohort-mismatch"));
  assert.ok(y.consumers.find((r) => r.key === "action:review_north").affected);
});
test("output change is a subset of reachable consumers across meaningful perturbations", () => {
  const variants = CHANGE_PRESETS.map((p) => applyPreset(p.id));
  const removedField = copy();
  delete removedField.types[1].fields.hours;
  variants.push(removedField);
  const stricterField = copy();
  stricterField.types[1].fields.cases.min = 5;
  variants.push(stricterField);
  const deletedObject = copy();
  deletedObject.objects = deletedObject.objects.filter(
    (o) => o.id !== "north_2024",
  );
  variants.push(deletedObject);
  const yearChange = copy();
  yearChange.objects[3].fields.year = 2025;
  variants.push(yearChange);
  for (let hours = 100000; hours <= 300000; hours += 25000) {
    const c = copy();
    c.objects[2].fields.hours = hours;
    variants.push(c);
  }
  for (const v of variants) {
    const c = compareContracts(copy(), v);
    assert.ok(c.consumers.every((r) => !r.outputChanged || r.affected));
    const edges = new Set(
      [...c.baseline.edges, ...c.proposal.edges].map(
        (e) => `${e.from}|${e.to}`,
      ),
    );
    for (const r of c.consumers.filter((r) => r.affected)) {
      assert.ok(c.changedNodes.includes(r.path[0]));
      for (let i = 1; i < r.path.length; i++)
        assert.ok(edges.has(`${r.path[i - 1]}|${r.path[i]}`));
    }
  }
});
test("undeclared data blocks the contract without invalidating unrelated numeric consumers", () => {
  const c = copy();
  delete c.types[1].fields.hours;
  const e = evaluateContract(c);
  assert.equal(e.valid, false);
  assert.equal(result(e, "metric:pooled_cases").valid, true);
  assert.equal(result(e, "metric:pooled_hours").valid, false);
});
test("noncritical upstream problems still block critical downstream review rules", () => {
  const c = applyPreset("unit-drift");
  for (const m of c.metrics) m.critical = false;
  const e = evaluateContract(c);
  assert.equal(e.valid, false);
  assert.ok(e.diagnostics.some((d) => !d.critical));
  assert.ok(
    e.diagnostics.some((d) => d.node.startsWith("action:") && d.critical),
  );
});
test("reachable consumers may recheck successfully without a changed value or status", () => {
  const c = copy();
  c.objects[2].fields.hours = 239999;
  const x = compareContracts(copy(), c);
  assert.equal(x.affectedCount, 5);
  assert.equal(x.changedOutputCount, 3);
  assert.equal(
    x.consumers.find((r) => r.key === "action:review_north").outputChanged,
    false,
  );
});
test("malformed, oversized and executable-looking contracts are rejected as data", () => {
  assert.throws(() => evaluateContract({}));
  const c = copy();
  c.metrics[0].operation = "eval";
  assert.throws(() => evaluateContract(c), /supported operations/);
  const d = copy();
  d.objects.push(d.objects[0]);
  assert.throws(() => evaluateContract(d), /duplicate ID/);
  const e = copy();
  e.objects = Array.from({ length: 101 }, (_, i) => ({
    ...e.objects[0],
    id: `o${i}`,
  }));
  assert.throws(() => evaluateContract(e), /at most 100/);
  assert.throws(() => canonicalJSON({ x: Infinity }));
});
test("review digest binds exact contracts, diagnostics and local review state", async () => {
  const before = copy(),
    after = applyPreset("hours-correction"),
    snapshot = JSON.stringify(before);
  const bundle = await reviewBundle(before, after, {
    locallyApproved: true,
    note: "Review source hours before implementation.",
  });
  assert.equal(bundle.baseline.sha256, await sha256(before));
  assert.equal(bundle.proposal.sha256, await sha256(after));
  const { bundleSha256, digestMethod, ...payload } = bundle;
  assert.equal(bundleSha256, await sha256(payload));
  assert.match(digestMethod, /canonical JSON/);
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(bundle.status, "locally-approved-review");
  await assert.rejects(
    () =>
      reviewBundle(before, applyPreset("unit-drift"), {
        locallyApproved: true,
      }),
    /block local approval/,
  );
  assert.equal(await sha256({ a: 1, b: 2 }), await sha256({ b: 2, a: 1 }));
  assert.notEqual(await sha256(before), await sha256(after));
});

test("prototype-like dimension names remain ordinary declared data", () => {
  const c = copy();
  for (const u of Object.values(c.units))
    if (Object.hasOwn(u.dimensions, "case")) {
      u.dimensions.toString = u.dimensions.case;
      delete u.dimensions.case;
    }
  const e = evaluateContract(c);
  assert.equal(e.valid, true);
  near(result(e, "metric:pooled_rate").value, 2);
});
test("inherited context and field names are not declared bindings", () => {
  const c = copy();
  c.metrics.find((m) => m.id === "pooled_cases").preserveKeys = ["toString"];
  const e = evaluateContract(c);
  assert.equal(e.valid, false);
  assert.ok(e.diagnostics.some((d) => d.code === "aggregation-context"));
  const d = copy();
  d.metrics[0].inputs[0].field = "toString";
  const x = evaluateContract(d);
  assert.equal(x.valid, false);
  assert.ok(x.diagnostics.some((d) => d.code === "unknown-field"));
});

test("malformed reference data returns diagnostics without implicit object coercion", () => {
  const c = copy();
  c.objects[2].links.establishment = JSON.parse(
    '{"toString":null,"valueOf":null}',
  );
  const e = evaluateContract(c);
  assert.equal(e.valid, false);
  assert.ok(e.diagnostics.some((d) => d.code === "broken-reference"));
});

test("omitted prototype-like natural keys are incomplete, never inherited identities", () => {
  for (const kind of ["field", "link"]) {
    const c = copy();
    if (kind === "field")
      c.types[1].fields.toString = {
        kind: "string",
        unit: "text",
        concept: "extra_identity",
        grain: "establishment_year",
        aggregation: "nonadditive",
      };
    else
      c.types[1].links.toString = {
        targetType: "establishment",
        required: false,
      };
    c.types[1].uniqueBy.push("toString");
    const e = evaluateContract(c);
    assert.equal(e.valid, false);
    assert.ok(e.diagnostics.some((d) => d.code === "incomplete-reporting-key"));
  }
});
