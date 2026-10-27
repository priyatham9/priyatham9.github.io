// Determinism and rate checks for work/plant-blueprint-sim.js.
// Reads the embedded #plant-data block from work/plant-blueprint.html.
// Run: node tests/plant_sim_check.js   (exit code 1 on failure)
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "work", "plant-blueprint.html"), "utf8");
const DATA = JSON.parse(html.match(/<script type="application\/json" id="plant-data">([\s\S]*?)<\/script>/)[1]);
const Sim = require(path.join(root, "work", "plant-blueprint-sim.js"));
let failed = 0;
function check(name, ok, extra) { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) failed++; }
const run = (p) => JSON.stringify(Sim.exportLog(DATA, p, Sim.systemLog(DATA, p)));
const base = Object.assign(Sim.defaultParams(DATA), { seed: 3 });

// 1. same seed, same event log; different seed, different log
check("same seed gives identical event log", run(base) === run(Object.assign({}, base)));
check("different seed gives different log", run(base) !== run(Object.assign({}, base, { seed: 4 })));
const log3 = Sim.systemLog(DATA, base);
check("seed 3 default horizon draws at least one release", log3.some((e) => e.action === "open_incident" && e.params.kind === "release"));
check("log has who/what/when on every entry", log3.every((e) => e.actor && e.action && typeof e.at_h === "number"));

// 2. manual actions follow submission criteria
const ev = log3.find((e) => e.action === "raise_alert" && e.params.kind === "threshold");
const t = ev.at_h + 0.01;
const noAuto = Object.assign({}, base, { autoOperator: false });
const sl = Sim.systemLog(DATA, noAuto);
const a = sl.find((e) => e.action === "raise_alert" && e.params.kind === "threshold");
let r1 = Sim.applyAction(sl, "raise_work_order", { alert: a.objects.alert, priority: "urgent", note: "valid note text" }, a.at_h + 0.1);
check("work order rejected before acknowledge", r1.result === "rejected");
let r2 = Sim.applyAction(sl, "acknowledge_alert", { alert: a.objects.alert }, a.at_h + 0.1);
check("acknowledge applied on open alert", r2.result === "applied");
const sl2 = Sim.sortLog(sl.concat([r2]));
check("work order applied after acknowledge", Sim.applyAction(sl2, "raise_work_order", { alert: a.objects.alert, priority: "urgent", note: "valid note text" }, a.at_h + 0.2).result === "applied");
check("short note rejected", Sim.applyAction(sl2, "raise_work_order", { alert: a.objects.alert, priority: "urgent", note: "short" }, a.at_h + 0.2).result === "rejected");
check("control building cannot be isolated", (() => { const f = sl.find((e) => e.params.kind === "filing"); const s3 = Object.assign({}, base, { seed: 1, autoOperator: false }); const l = Sim.systemLog(DATA, s3); const fl = l.find((e) => e.action === "raise_alert" && e.params.kind === "filing"); return Sim.applyAction(l, "isolate_unit", { alert: fl.objects.alert, reason: "precaution" }, fl.at_h + 0.1).result === "rejected"; })());

// 3. nominal noise never crosses a limit (no incidents in two simulated years, five seeds)
let crossings = 0;
for (let seed = 1; seed <= 5; seed++) for (const u of Sim.UNITS) for (const s of Sim.SIGNALS[u.type]) for (let h = 0; h < 17520; h += 0.5) if (Sim.limitState(s, Sim.valueAt(seed, [], u.id, s.key, h)) !== "ok") crossings++;
check("nominal signals stay inside warn limits", crossings === 0, "crossings=" + crossings);

// 4. drawn release frequency matches the source rate (Monte Carlo over seeds)
for (const mode of ["point", "lower", "upper"]) {
  const p = Object.assign({}, base, { band: "100k-1M lb", rateMode: mode, horizonYears: 100 });
  const rate = Sim.rateFor(DATA, p); let n = 0; const N = 600;
  for (let s = 1; s <= N; s++) n += Sim.buildSchedule(DATA, Object.assign({}, p, { seed: s })).filter((e) => e.kind === "release").length;
  const expect = N * 100 * rate.lambdaPerYear, tol = 4 * Math.sqrt(expect);
  check("release count matches rate (" + mode + ")", Math.abs(n - expect) < tol, "got " + n + " expected " + expect.toFixed(1) + " +/- " + tol.toFixed(1));
}
// filing share
{ let n = 0, N = 400; const p = Object.assign({}, base, { horizonYears: 100 });
  for (let s = 1; s <= N; s++) n += Sim.buildSchedule(DATA, Object.assign({}, p, { seed: s })).filter((e) => e.kind === "filing").length;
  const ex = N * 100 * DATA.sim_rates.filing_implausible.share;
  check("filing events match implausible_share", Math.abs(n - ex) < 4 * Math.sqrt(ex), "got " + n + " expected " + ex.toFixed(1)); }
// source weights only use mapped unit types
{ const types = new Set(); for (let s = 1; s <= 300; s++) Sim.buildSchedule(DATA, Object.assign({}, base, { seed: s, horizonYears: 100, band: "5M+ lb" })).filter((e) => e.kind === "release").forEach((e) => types.add(Sim.UNIT_BY_ID[e.unit].type));
  check("release sources limited to mapped types", [...types].every((x) => ["reactor", "tank", "pump", "piperack"].includes(x)), [...types].join(",")); }
process.exit(failed ? 1 : 0);
