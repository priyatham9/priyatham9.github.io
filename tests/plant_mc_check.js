// Determinism and rate-consistency checks for work/plant-blueprint-mc.js (Monte Carlo what-if).
// Run: node tests/plant_mc_check.js   (exit code 1 on failure)
"use strict";
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "work", "plant-blueprint.html"), "utf8");
const DATA = JSON.parse(html.match(/<script type="application\/json" id="plant-data">([\s\S]*?)<\/script>/)[1]);
const MC = require(path.join(root, "work", "plant-blueprint-mc.js"));
let failed = 0;
function check(name, ok, extra) { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) failed++; }

const scn = MC.scenarios(DATA);
check("scenarios come only from committed groups with a rate", scn.length >= 4 && scn.every((s) => typeof s.rate_pct === "number" && /^rel-/.test(s.id)), scn.length + " scenarios");

// 1. determinism: same seed, scenario, N give identical output; chunked equals single pass; different seed differs
const o = { scenario: "rel-inv-100k-1M lb", seed: 3, n: 1000 };
const a = JSON.stringify(MC.report(DATA, MC.run(DATA, o))), b = JSON.stringify(MC.report(DATA, MC.run(DATA, Object.assign({}, o))));
check("same seed and N give identical report", a === b);
check("different seed gives different histogram", JSON.stringify(MC.run(DATA, o).histogram) !== JSON.stringify(MC.run(DATA, Object.assign({}, o, { seed: 4 })).histogram));
check("markdown is deterministic", MC.markdown(DATA, MC.run(DATA, o)) === MC.markdown(DATA, MC.run(DATA, o)));

// 2. consistency with the source rate. Tolerance: |mean - lambda| <= 4 standard errors, SE = sqrt(lambda / N) for a Poisson count.
const N = 1000;
let allOk = true, worst = 0;
for (const s of scn) {
  const lam = MC.lambdaOf(s), seMean = Math.sqrt(lam / N);
  for (const seed of [1, 2, 3]) {
    const r = MC.run(DATA, { scenario: s.id, seed, n: N });
    const z = Math.abs(r.mean - lam) / seMean; worst = Math.max(worst, z);
    if (z > 4) { allOk = false; console.log("  out of tolerance", s.id, seed, z.toFixed(2)); }
  }
}
check("MC mean within 4 SE of source-implied rate, all scenarios, 3 seeds, N=1000", allOk, "worst z=" + worst.toFixed(2));
{ // share with a release vs rate_pct, pooled over many seeds at the default band
  const s = MC.scenario(DATA, "rel-inv-100k-1M lb"); let ge1 = 0, tot = 0;
  for (let seed = 1; seed <= 20; seed++) { const r = MC.run(DATA, { scenario: s.id, seed, n: 1000 }); ge1 += r.n * r.share_with_release; tot += r.n; }
  const p = s.rate_pct / 100, tol = 4 * Math.sqrt(p * (1 - p) / tot);
  check("share of plant-years with a release matches rate_pct (4 SE)", Math.abs(ge1 / tot - p) < tol, (100 * ge1 / tot).toFixed(3) + "% vs " + s.rate_pct + "%");
}
// 3. report carries seed, parameters, citation, results
{ const r = MC.report(DATA, MC.run(DATA, o));
  check("report has seed, parameters, citation and results", r.seed === 3 && r.parameters.scenario_id === o.scenario && /compare\.json$/.test(r.source_citations[0].file) && /^groups\[rel-/.test(r.source_citations[0].key) && r.results.interval90.length === 2);
  check("no em dash in report text", !JSON.stringify(r).includes(String.fromCharCode(0x2014)) && !MC.markdown(DATA, MC.run(DATA, o)).includes(String.fromCharCode(0x2014))); }
// 4. chunked run (browser path) equals the single pass
MC.runChunked(DATA, o, null, 70).then((c) => {
  check("chunked run equals single pass", JSON.stringify(c) === JSON.stringify(MC.run(DATA, o)));
  process.exit(failed ? 1 : 0);
});
