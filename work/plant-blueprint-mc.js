/* Monte Carlo what-if core for work/plant-blueprint.html.
 * Pure functions (no DOM, Date or Math.random): same seed, scenario and N give the same output.
 * Works in the browser (window.PlantMC) and in node (module.exports) for tests/plant_mc_check.js.
 *
 * Method: each replication is one simulated plant-year. The committed share of plant-years with a
 * release (rate_pct) is converted to a Poisson rate lambda = -ln(1 - p) per year, so P(at least one
 * release) = p. Events are drawn from exponential gaps and counted inside one year.
 * Limits: Poisson assumption, no clustering or repeat releases linked to history, a synthetic site.
 * The only inputs are rate_pct, plant_years, events, wilson_pct and exact_pct from the embedded
 * data block (compare.json, groups[rel-*]). No control effectiveness is modelled.
 */
(function (root) {
  "use strict";
  var CMP = "ehs-chemical-peers:docs/data/compare.json";
  var SIM = (typeof require === "function" && typeof module !== "undefined") ? require("./plant-blueprint-sim.js") : root.PlantSim;
  var mulberry32 = SIM.mulberry32;

  var DIM_TITLE = { inventory: "Inventory band", size: "Peer group: employees", history: "Peer group: release history", chemicals: "Peer group: number of regulated chemicals", family: "Peer group: chemical family" };

  /* Scenarios exist only where the data block has a rate: the four inventory bands and the other rel-* peer groups. */
  function scenarios(data) {
    var rp = data.sim_rates.release_per_plant_year, out = [];
    rp.bands.forEach(function (b) {
      out.push({ id: "rel-inv-" + b.label, dimension: "inventory", group: DIM_TITLE.inventory, label: b.label, plant_years: b.plant_years, events: b.events, rate_pct: b.rate_pct, wilson_pct: b.wilson_pct, exact_pct: b.exact_pct });
    });
    (rp.peer_groups || []).forEach(function (g) {
      out.push({ id: g.id, dimension: g.dimension, group: DIM_TITLE[g.dimension] || ("Peer group: " + g.dimension), label: g.label, plant_years: g.plant_years, events: g.events, rate_pct: g.rate_pct, wilson_pct: g.wilson_pct, exact_pct: g.exact_pct });
    });
    return out;
  }
  function scenario(data, id) {
    var l = scenarios(data);
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    throw new Error("unknown scenario " + id);
  }
  function lambdaOf(sc) { return -Math.log(1 - sc.rate_pct / 100); }

  function repSeed(seed, i) {
    var h = Math.imul((seed | 0) ^ 0x5bd1e995, 0x9E3779B1) ^ Math.imul(i + 1, 0x85EBCA77);
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 13;
    return h | 0;
  }
  /* incident count in one simulated plant-year */
  function replicate(lambda, seed, i) {
    var rng = mulberry32(repSeed(seed, i)), t = 0, n = 0;
    while (true) { t += -Math.log(1 - rng()) / lambda; if (t >= 1) break; n++; }
    return n;
  }

  function newAcc(sc, seed, n) { return { sc: sc, seed: seed, n: n, lambda: lambdaOf(sc), done: 0, hist: [], sum: 0, sumsq: 0 }; }
  function step(acc, count) {
    var end = Math.min(acc.n, acc.done + count);
    for (var i = acc.done; i < end; i++) {
      var c = replicate(acc.lambda, acc.seed, i);
      while (acc.hist.length <= c) acc.hist.push(0);
      acc.hist[c]++; acc.sum += c; acc.sumsq += c * c;
    }
    acc.done = end;
    return acc.done >= acc.n;
  }
  function quantileCount(hist, n, q) { /* smallest k with cumulative share >= q */
    var cum = 0;
    for (var k = 0; k < hist.length; k++) { cum += hist[k]; if (cum / n >= q) return k; }
    return hist.length - 1;
  }
  function finish(acc) {
    var n = acc.n, mean = acc.sum / n, varr = n > 1 ? (acc.sumsq - n * mean * mean) / (n - 1) : 0;
    var ge1 = n - (acc.hist[0] || 0);
    return {
      seed: acc.seed, n: n, scenario: acc.sc.id, lambda_per_year: acc.lambda,
      histogram: acc.hist.slice(), mean: mean, sd: Math.sqrt(Math.max(0, varr)), se_mean: Math.sqrt(Math.max(0, varr) / n),
      share_with_release: ge1 / n, max: acc.hist.length - 1,
      interval90: [quantileCount(acc.hist, n, 0.05), quantileCount(acc.hist, n, 0.95)],
      interval90_rule: "empirical 5th and 95th percentile of the count (smallest k with cumulative share >= q)"
    };
  }
  function run(data, opts) {
    var acc = newAcc(scenario(data, opts.scenario), opts.seed, opts.n);
    step(acc, opts.n); return finish(acc);
  }
  /* Chunked run that yields to the event loop between chunks; onProgress(done, n); resolves with the result. */
  function runChunked(data, opts, onProgress, chunk) {
    return new Promise(function (resolve) {
      var acc = newAcc(scenario(data, opts.scenario), opts.seed, opts.n);
      (function loop() {
        var d = step(acc, chunk || 100);
        if (onProgress) onProgress(acc.done, acc.n);
        if (d) resolve(finish(acc)); else setTimeout(loop, 0);
      })();
    });
  }

  function pct(x, d) { return (Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).toString(); }
  function report(data, res) {
    var sc = scenario(data, res.scenario);
    return {
      title: "Plant digital twin Monte Carlo what-if",
      banner: "Simulated digital twin of a synthetic site. No real facility or live telemetry; incident rates are drawn from public statistics, behaviour is a model.",
      seed: res.seed, replications: res.n, horizon_years_per_replication: 1,
      parameters: { scenario_id: sc.id, scenario_group: sc.group, scenario_label: sc.label },
      source_citations: [
        { file: CMP, key: "groups[" + sc.id + "]", fields: { n: sc.plant_years, events: sc.events, rate_pct: sc.rate_pct, wilson_pct: sc.wilson_pct, exact_pct: sc.exact_pct },
          url: "https://github.com/priyatham9/ehs-chemical-peers/blob/main/docs/data/compare.json" }
      ],
      method: {
        model: "Poisson process, one replication per simulated plant-year; lambda = -ln(1 - rate_pct/100) per year",
        lambda_per_year: res.lambda_per_year,
        limits: ["Poisson assumption: independent releases at a constant rate", "No clustering and no dependence on release history", "Synthetic site: the rate is a plant-level statistic of public records, not a property of any real plant", "No control effectiveness is modelled and none is claimed", "Descriptive only: no causal claim"]
      },
      results: {
        mean_incidents_per_plant_year: res.mean, sd: res.sd, se_mean: res.se_mean,
        source_rate_lambda_per_year: res.lambda_per_year,
        share_of_replications_with_a_release: res.share_with_release, source_rate_pct: sc.rate_pct,
        interval90: res.interval90, interval90_rule: res.interval90_rule,
        histogram_counts_by_incidents: res.histogram
      }
    };
  }
  function markdown(data, res) {
    var r = report(data, res), sc = r.source_citations[0], f = sc.fields;
    var L = [];
    L.push("# Plant digital twin: Monte Carlo what-if", "", "> " + r.banner, "");
    L.push("- Scenario: " + r.parameters.scenario_group + ", " + r.parameters.scenario_label);
    L.push("- Seed " + r.seed + ", " + r.replications + " replications of 1 simulated plant-year");
    L.push("- Source rate: " + f.rate_pct + "% of plant-years with a release (" + f.events + " of " + f.n + "; Wilson " + Math.round((1 - data.interval_alpha) * 100) + "% interval as published: " + f.wilson_pct[0] + "% to " + f.wilson_pct[1] + "%)");
    L.push("- Source: `" + sc.file + "`, key `" + sc.key + "`", "");
    L.push("## Results", "");
    L.push("- Poisson rate implied by the source: " + pct(res.lambda_per_year, 5) + " incidents per plant-year");
    L.push("- Simulated mean: " + pct(res.mean, 5) + " (standard error " + pct(res.se_mean, 5) + ")");
    L.push("- Replications with at least one release: " + pct(res.share_with_release * 100, 2) + "% (source: " + f.rate_pct + "%)");
    L.push("- Empirical 90% interval of incidents per plant-year: " + res.interval90[0] + " to " + res.interval90[1], "");
    L.push("| Incidents in the year | Replications |", "|---|---|");
    res.histogram.forEach(function (c, k) { L.push("| " + k + " | " + c + " |"); });
    L.push("", "## Method and limits", "", "- Model: " + r.method.model);
    r.method.limits.forEach(function (x) { L.push("- " + x); });
    return L.join("\n") + "\n";
  }

  var api = { scenarios: scenarios, scenario: scenario, lambdaOf: lambdaOf, replicate: replicate, run: run, runChunked: runChunked, report: report, markdown: markdown };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PlantMC = api;
})(typeof window !== "undefined" ? window : globalThis);
