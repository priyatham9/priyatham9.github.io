import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  parsePredictionCSV,
  evaluatePredictions,
  changeBudget,
  exportRecordsCSV,
  PredictionAuditError,
  LIMITS,
} from "./prediction-model.mjs";
const rows = (ys, as, bs = as, groups = []) =>
  ys.map((outcome, index) => ({
    ordinal: index + 1,
    recordId: `r${index + 1}`,
    group: groups[index] ?? null,
    outcome,
    scoreA: as[index],
    scoreB: bs[index],
  }));
const near = (actual, expected, tolerance = 1e-12) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
const error = (fn, code) =>
  assert.throws(
    fn,
    (e) => e instanceof PredictionAuditError && e.code === code,
  );
const basic = "outcome,score_a,score_b\n1,0.8,0.7\n0,0.2,0.1\n";

test("required columns may be reordered and optional text remains explicit", () => {
  const parsed = parsePredictionCSV(
    "record_id,score_b,outcome,group,score_a\nabc,.2,1,north,.3\n,.5,0,,.6",
  );
  assert.deepEqual(parsed.records[0], {
    ordinal: 1,
    recordId: "abc",
    group: "north",
    outcome: 1,
    scoreA: 0.3,
    scoreB: 0.2,
  });
  assert.equal(parsed.records[1].recordId, null);
  assert.equal(parsed.records[1].group, null);
  assert.equal(parsed.hasGroupColumn, true);
});
test("BOM, CRLF, quoted commas, escaped quotes and embedded newlines round-trip as data", () => {
  const csv =
    '\ufeffoutcome,score_a,score_b,record_id,group\r\n1,.2,.3,"id,""quoted""","north\r\nsouth"\r\n0,1,0,,\r\n';
  const p = parsePredictionCSV(csv);
  assert.equal(p.byteLength, new TextEncoder().encode(csv).byteLength);
  assert.equal(p.records.length, 2);
  assert.equal(p.records[0].recordId, 'id,"quoted"');
  assert.equal(p.records[0].group, "north\r\nsouth");
  assert.equal(p.records[1].group, null);
});
test("final empty field is retained and a final newline does not create a record", () => {
  assert.equal(
    parsePredictionCSV("outcome,score_a,score_b,group\n1,.2,.3,").records[0]
      .group,
    null,
  );
  assert.equal(parsePredictionCSV(basic).records.length, 2);
});
test("malformed quoting fails at the logical row instead of repairing or truncating input", () => {
  for (const [value, code] of [
    ['"open', "UNCLOSED_QUOTE"],
    ['ab"cd', "UNEXPECTED_QUOTE"],
    ['"id" trailing', "AFTER_QUOTE"],
  ])
    error(
      () =>
        parsePredictionCSV(
          `outcome,score_a,score_b,record_id\n1,.2,.3,${value}`,
        ),
      code,
    );
  try {
    parsePredictionCSV(
      'outcome,score_a,score_b,record_id\n1,.2,.3,"line\nwith quote"oops',
    );
  } catch (e) {
    assert.equal(e.row, 2);
    assert.equal(e.column, 4);
  }
});
test("headers are exact, unique and bounded to the supported schema", () => {
  for (const [header, code] of [
    ["outcome,score_a,score_a", "DUPLICATE_HEADER"],
    ["outcome,score_a", "MISSING_HEADER"],
    ["outcome,score_a,score_b,extra", "UNKNOWN_HEADER"],
    ["outcome, score_a,score_b", "UNKNOWN_HEADER"],
    ["outcome,score_a,score_b,record_id,group,x", "COLUMN_COUNT"],
  ])
    error(() => parsePredictionCSV(header + "\n1,.2,.3"), code);
});
test("blank/ragged rows and bare CR endings never silently disappear", () => {
  error(() => parsePredictionCSV(basic + "\n"), "COLUMN_COUNT");
  error(
    () => parsePredictionCSV("outcome,score_a,score_b\n1,.2"),
    "COLUMN_COUNT",
  );
  error(
    () => parsePredictionCSV("outcome,score_a,score_b\r1,.2,.3"),
    "BARE_CR",
  );
});
test("empty and header-only input cannot fabricate an empty-cohort score", () => {
  error(() => parsePredictionCSV(""), "EMPTY_CSV");
  error(() => parsePredictionCSV("\ufeff"), "EMPTY_CSV");
  error(() => parsePredictionCSV("outcome,score_a,score_b\n"), "EMPTY_COHORT");
  error(() => evaluatePredictions([]), "EMPTY_COHORT");
});
test("outcomes require literal 0/1, not coercible or ambiguous numeric spellings", () => {
  for (const outcome of ["true", "yes", "2", "-1", "1.0", "+1", "1e0", "0x1"])
    error(
      () => parsePredictionCSV(`outcome,score_a,score_b\n${outcome},.2,.3`),
      "INVALID_OUTCOME",
    );
  error(
    () => parsePredictionCSV("outcome,score_a,score_b\n,.2,.3"),
    "MISSING_VALUE",
  );
});
test("scores reject missing, nonfinite, hex, expressions and text", () => {
  for (const score of [
    "NaN",
    "Infinity",
    "0x1",
    "1/2",
    "null",
    "true",
    "0.5junk",
  ])
    error(
      () => parsePredictionCSV(`outcome,score_a,score_b\n1,${score},.3`),
      "INVALID_SCORE",
    );
  error(
    () => parsePredictionCSV("outcome,score_a,score_b\n1,,.3"),
    "MISSING_VALUE",
  );
});
test("mathematical source range is checked before binary rounding or underflow", () => {
  for (const score of [
    "1.00000000000000001",
    "-1e-9999",
    "1.1",
    "10001e-4",
    "1e999999",
  ])
    error(
      () => parsePredictionCSV(`outcome,score_a,score_b\n1,${score},.3`),
      "SCORE_RANGE",
    );
  error(
    () => parsePredictionCSV("outcome,score_a,score_b\n1,1e-9999,.3"),
    "SCORE_UNDERFLOW",
  );
  for (const score of ["1.000", "10e-1", "+.5", "-0", "0e99999", ".00001e5"])
    assert.ok(
      parsePredictionCSV(`outcome,score_a,score_b\n1,${score},.3`).records[0]
        .scoreA <= 1,
    );
});
test("UTF-8 bytes, row count and hard limit configurations are enforced", () => {
  const csv = 'outcome,score_a,score_b,record_id\n1,.2,.3,"😀é"';
  error(
    () =>
      parsePredictionCSV(csv, {
        maxBytes: new TextEncoder().encode(csv).length - 1,
      }),
    "BYTE_LIMIT",
  );
  error(() => parsePredictionCSV(basic, { maxRows: 1 }), "ROW_LIMIT");
  error(
    () => parsePredictionCSV(basic, { maxRows: LIMITS.maxRows + 1 }),
    "LIMIT_CONFIGURATION",
  );
  error(
    () => parsePredictionCSV("x".repeat(LIMITS.maxBytes + 1)),
    "BYTE_LIMIT",
  );
});
test("text bound counts Unicode characters and rejects unsupported controls", () => {
  const prefix = "outcome,score_a,score_b,record_id\n1,.2,.3,";
  assert.equal(parsePredictionCSV(prefix + "😀".repeat(512)).records.length, 1);
  error(() => parsePredictionCSV(prefix + "😀".repeat(513)), "TEXT_LENGTH");
  error(() => parsePredictionCSV(prefix + "id\0hidden"), "CONTROL_CHARACTER");
});
test("duplicate IDs remain separate records, and prototype-like group labels are ordinary data", () => {
  const p = parsePredictionCSV(
    "outcome,score_a,score_b,record_id,group\n1,.9,.1,same,__proto__\n0,.1,.9,same,toString",
  );
  const r = evaluatePredictions(p.records);
  assert.equal(r.n, 2);
  assert.deepEqual(
    r.groups.map((g) => g.group),
    ["__proto__", "toString"],
  );
  assert.equal(Object.prototype.polluted, undefined);
});
test("201st group is rejected with no truncation; missing group counts as a bucket", () => {
  const header = "outcome,score_a,score_b,group\n";
  const data = Array.from({ length: 200 }, (_, i) => `0,.2,.3,g${i}`).join(
    "\n",
  );
  assert.equal(parsePredictionCSV(header + data).distinctGroups, 200);
  error(() => parsePredictionCSV(header + data + "\n0,.2,.3,"), "GROUP_LIMIT");
  error(
    () =>
      evaluatePredictions(
        rows(
          Array(201).fill(0),
          Array(201).fill(0.2),
          undefined,
          Array.from({ length: 201 }, (_, i) => `g${i}`),
        ),
      ),
    "GROUP_LIMIT",
  );
});
test("direct model calls also reject invalid numbers and unstable source ordinals", () => {
  for (const value of [NaN, Infinity, -0.1, 1.01, "0.5"])
    error(
      () =>
        evaluatePredictions([
          { ordinal: 1, outcome: 0, scoreA: value, scoreB: 0.5 },
        ]),
      "INVALID_SCORE",
    );
  error(
    () =>
      evaluatePredictions([
        { ordinal: 2, outcome: 0, scoreA: 0.5, scoreB: 0.5 },
      ]),
    "ORDINAL",
  );
  error(
    () =>
      evaluatePredictions([
        { ordinal: 1, outcome: true, scoreA: 0.5, scoreB: 0.5 },
      ]),
    "INVALID_OUTCOME",
  );
});
test("noninterpolated AP handles tied thresholds rather than arbitrary within-tie ranks", () => {
  const r = evaluatePredictions(rows([1, 0, 1], [0.8, 0.8, 0.2]));
  near(r.models.a.averagePrecision, 7 / 12);
  near(r.models.a.brier, (0.04 + 0.64 + 0.64) / 3);
  const reversed = evaluatePredictions(rows([0, 1, 1], [0.8, 0.8, 0.2]));
  near(reversed.models.a.averagePrecision, r.models.a.averagePrecision);
});
test("all-negative AP and recall are undefined while all-positive AP is one", () => {
  const none = evaluatePredictions(rows([0, 0], [0, 1]));
  assert.equal(none.models.a.averagePrecision, null);
  assert.equal(none.models.a.topBudget.recall, null);
  assert.equal(none.deltas.averagePrecision, null);
  near(none.models.a.brier, 0.5);
  const all = evaluatePredictions(rows([1, 1], [0, 1]));
  near(all.models.a.averagePrecision, 1);
  near(all.models.a.topBudget.precision, 1);
});
test("constant score AP equals prevalence, but budget precision exposes file-order ties", () => {
  const r = evaluatePredictions(rows([0, 1, 1, 1], [0.5, 0.5, 0.5, 0.5]));
  near(r.models.a.averagePrecision, 0.75);
  assert.equal(r.models.a.topBudget.precision, 0);
  assert.equal(r.models.a.topBudget.boundaryTieSize, 4);
  assert.equal(r.models.a.topBudget.boundaryTieSelected, 1);
  assert.deepEqual(r.models.a.ranks, [1, 2, 3, 4]);
});
test("tie diagnostics count the complete boundary group and only the selected boundary rows", () => {
  const r = evaluatePredictions(
    rows(
      [1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0],
      [1, 0.8, 0.8, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
    ),
    { budgetFraction: 0.2 },
  );
  assert.equal(r.models.a.topBudget.count, 3);
  assert.equal(r.models.a.topBudget.boundaryTieSize, 3);
  assert.equal(r.models.a.topBudget.boundaryTieSelected, 2);
  assert.equal(r.models.a.topBudget.cutoffScore, 0.8);
});
test("budget uses ceil, supports only declared fractions and cached changes preserve all other metrics", () => {
  const input = rows(
    Array.from({ length: 21 }, (_, i) => i % 2),
    Array.from({ length: 21 }, (_, i) => i / 20),
  );
  const a = evaluatePredictions(input);
  const b = changeBudget(a, 0.05);
  assert.equal(a.models.a.topBudget.count, 3);
  assert.equal(b.models.a.topBudget.count, 2);
  assert.equal(b.models.a.averagePrecision, a.models.a.averagePrecision);
  assert.equal(b.models.a.brier, a.models.a.brier);
  assert.equal(b.models.a.ranks, a.models.a.ranks);
  assert.equal(b.models.a.calibration, a.models.a.calibration);
  assert.equal(a.budgetFraction, 0.1);
  error(() => changeBudget(a, 0.11), "BUDGET_FRACTION");
});
test("calibration exact edges, adjacent floats, zero and one have defined membership", () => {
  const scores = [0, 0.1, 0.3, 0.8999999999999999, 0.9, 1];
  const r = evaluatePredictions(rows([0, 1, 0, 1, 0, 1], scores));
  const b = r.models.a.calibration;
  assert.equal(b.length, 10);
  assert.equal(b[0].n, 1);
  assert.equal(b[1].n, 1);
  assert.equal(b[3].n, 1);
  assert.equal(b[8].n, 1);
  assert.equal(b[9].n, 2);
  assert.equal(b[2].meanProbability, null);
  assert.equal(b[2].observedRate, null);
  assert.equal(
    b.reduce((s, x) => s + x.n, 0),
    6,
  );
  assert.equal(
    b.reduce((s, x) => s + x.positives, 0),
    3,
  );
});
test("groups retain missing rows and report explicit sample denominators without changing main metrics", () => {
  const r = evaluatePredictions(
    rows(
      [1, 0, 0, 1],
      [0.9, 0.8, 0.2, 0.1],
      [0.1, 0.2, 0.8, 0.9],
      ["north", "north", null, "south"],
    ),
  );
  assert.equal(r.n, 4);
  assert.equal(
    r.groups.reduce((s, g) => s + g.n, 0),
    4,
  );
  assert.equal(r.groups.find((g) => g.group === null).a.averagePrecision, null);
  assert.equal(r.groups.find((g) => g.group === "north").n, 2);
  assert.equal(
    r.groups.find((g) => g.group === "north").a.topBudget.precision,
    1,
  );
  assert.equal(r.models.a.topBudget.precision, 1);
});
test("cached budget changes equal fresh evaluation for all groups and tied score patterns", () => {
  let seed = 321;
  const rand = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32;
  const input = Array.from({ length: 513 }, (_, i) => ({
    ordinal: i + 1,
    outcome: rand() < 0.2 ? 1 : 0,
    scoreA: Math.floor(rand() * 10) / 10,
    scoreB: Math.floor(rand() * 5) / 5,
    recordId: null,
    group: i % 11 ? `g${i % 11}` : null,
  }));
  const a = evaluatePredictions(input);
  for (const f of [0.05, 0.1, 0.2])
    assert.deepEqual(
      changeBudget(a, f),
      evaluatePredictions(input, { budgetFraction: f }),
    );
});
test("input mutations after evaluation cannot change its cloned cohort or cached metrics", () => {
  const input = rows([1, 0], [0.8, 0.2]);
  const r = evaluatePredictions(input);
  input[0].scoreA = 0;
  input[0].group = "changed";
  assert.equal(r.records[0].scoreA, 0.8);
  assert.equal(r.records[0].group, null);
  assert.equal(changeBudget(r, 0.2).models.a.topBudget.precision, 1);
});
test("CSV export quotes text and neutralizes formula-like IDs/groups while JSON originals stay intact", () => {
  const ids = [
    "=1+1",
    "+cmd",
    "-cmd",
    "@SUM(A1)",
    " \t=cmd",
    "\ttext",
    'line, "quote"',
  ];
  const input = ids.map((recordId, i) => ({
    ordinal: i + 1,
    recordId,
    group: i ? "normal" : "=group",
    outcome: 0,
    scoreA: 0.2,
    scoreB: 0.3,
  }));
  const csv = exportRecordsCSV(input),
    reparsed = parsePredictionCSV(csv);
  for (let i = 0; i < 6; i++)
    assert.equal(reparsed.records[i].recordId, "'" + ids[i]);
  assert.equal(reparsed.records[6].recordId, ids[6]);
  assert.equal(reparsed.records[0].group, "'=group");
  assert.equal(input[0].recordId, "=1+1");
  assert.match(csv, /\r\n/u);
});
test("CSV subset export only contains explicitly supplied records and validates numeric cells", () => {
  const input = rows([1, 0, 1], [0.9, 0.5, 0.1]);
  assert.equal(
    parsePredictionCSV(exportRecordsCSV(input.slice(1))).records.length,
    2,
  );
  error(
    () => exportRecordsCSV([{ outcome: 1, scoreA: Infinity, scoreB: 0 }]),
    "INVALID_RECORD",
  );
  assert.equal(
    exportRecordsCSV([]),
    "outcome,score_a,score_b,record_id,group\r\n",
  );
});
test("real sample bytes, source artifact and complete transformation are pinned", async () => {
  const base = new URL("./", import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL("prediction-sample.manifest.json", base), "utf8"),
  );
  const bytes = await readFile(new URL(manifest.file, base));
  const original = await readFile(new URL(manifest.sourceArtifact.path, base));
  const data = JSON.parse(original);
  const digest = (x) => createHash("sha256").update(x).digest("hex");
  assert.equal(digest(bytes), manifest.sha256);
  assert.equal(bytes.length, manifest.bytes);
  assert.equal(digest(original), manifest.sourceArtifact.sha256);
  const parsed = parsePredictionCSV(bytes.toString("utf8"));
  assert.equal(parsed.records.length, 13216);
  parsed.records.forEach((row, i) => {
    const source = data.records[i];
    assert.equal(row.outcome, source.outcome);
    assert.equal(row.scoreA, source.withoutDuration);
    assert.equal(row.scoreB, source.withDuration);
    assert.equal(row.recordId, `uci-row-${source.row}`);
    assert.equal(row.group, `block-${String(source.blockId).padStart(2, "0")}`);
  });
  const result = evaluatePredictions(parsed.records);
  near(
    result.models.a.averagePrecision,
    data.models.withoutDuration.metrics.averagePrecision,
  );
  near(result.models.b.brier, data.models.withDuration.metrics.brier);
  assert.equal(result.models.a.topBudget.positives, 698);
  assert.equal(result.models.b.topBudget.positives, 852);
  assert.equal(manifest.credit.license.spdx, "CC-BY-4.0");
});
