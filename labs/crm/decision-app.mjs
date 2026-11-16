import { compareCohorts, evidenceToIdentify } from "./decision-model.mjs";
import { mixReversal, censoringReversal } from "./decision-examples.mjs";
const $ = (id) => document.getElementById(id);
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const pp = (n) => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)} pp`;
const fields = ["wins", "nonwins", "unresolved"];
const cases = {
  mix: {
    data: mixReversal,
    label: "Constructed customer-mix reversal",
    description:
      "Every outcome is known. Source A has the higher crude conversion rate, but source B leads within both segments. Apply a common customer mix to expose the reversal.",
  },
  unresolved: {
    data: censoringReversal,
    label: "Constructed incomplete-follow-up comparison",
    description:
      "Both segments have identical rates within each source, so customer mix cannot explain the result. Source A has more observed wins; unresolved outcomes can still change which source leads.",
  },
};
let review = null;
function mount(seeds) {
  $("counts").innerHTML = seeds
    .map(
      (row, i) =>
        `<tr><th scope="row">Source ${i < 2 ? "A" : "B"} <span>Segment ${(i % 2) + 1}</span></th>${row.map((v, j) => `<td><input aria-label="Source ${i < 2 ? "A" : "B"}, segment ${(i % 2) + 1}, ${["wins", "known nonwins", "unresolved"][j]}" id="count-${i}-${j}" type="number" min="0" max="100000000" step="1" value="${v}" required></td>`).join("")}<td id="total-${i}"></td></tr>`,
    )
    .join("");
}
function applyCase(key) {
  const example = cases[key];
  $("inputs").reset();
  // The incomplete-follow-up example has one stratum. Split it into two
  // identical halves for this two-segment editor; all totals are preserved.
  const expand = (rows) =>
    rows.length === 1
      ? [0, 1].map(() => fields.map((field) => rows[0][field] / 2))
      : rows.map((row) => fields.map((field) => row[field]));
  mount([...expand(example.data.a), ...expand(example.data.b)]);
  $("case").value = key;
  $("source-note").value = example.label;
  $("horizon").value = 90;
  $("mix").value = 50;
  $("case-description").textContent = example.description;
  $("provenance").textContent =
    "Constructed example · no empirical business finding";
  $("export-status").textContent = "";
  render();
}
function rows(offset) {
  return [0, 1].map((j) => ({
    stratum: `segment${j + 1}`,
    ...Object.fromEntries(
      fields.map((f, k) => [f, Number($(`count-${offset + j}-${k}`).value)]),
    ),
  }));
}
function boundRow(label, bound) {
  const value =
    Math.abs(bound.upper - bound.lower) < 1e-12
      ? pct(bound.lower)
      : `${pct(bound.lower)}–${pct(bound.upper)}`;
  return `<div class="bound-row"><div class="bound-label">${label}<strong>${value}</strong></div><div class="bound-track" aria-hidden="true"><div class="bound-range" style="left:${bound.lower * 100}%;width:${Math.max(0, bound.upper - bound.lower) * 100}%"></div><i style="left:${bound.lower * 100}%"></i></div></div>`;
}
function render() {
  try {
    if (!$("inputs").checkValidity())
      throw new Error(
        "Complete all fields with valid, nonnegative whole counts and a target share from 0 to 100.",
      );
    const a = rows(0),
      b = rows(2),
      weight = Number($("mix").value) / 100;
    const weights = { segment1: weight, segment2: 1 - weight };
    const c = compareCohorts(a, b, weights);
    [...a, ...b].forEach((r, i) => {
      $(`total-${i}`).textContent = r.wins + r.nonwins + r.unresolved;
    });
    $("error").hidden = true;
    $("results").hidden = false;
    $("export").disabled = false;
    $("verdict-title").textContent =
      c.conclusion === "Equal conversion for this finite cohort"
        ? "Equal conversion is identified for these cohorts."
        : c.conclusion === "Ranking is not identified"
          ? "The ranking is not identified."
          : `${c.lower > 0 ? "Source A" : "Source B"} leads across every unresolved completion.`;
    const gap =
      Math.abs(c.upper - c.lower) < 1e-12
        ? `is ${pp(c.lower)}`
        : `can be ${pp(c.lower)} to ${pp(c.upper)}`;
    $("live-result").hidden = false;
    $("live-conclusion").textContent =
      `${c.conclusion === "Equal conversion for this finite cohort" ? "Equal conversion" : c.conclusion === "Ranking is not identified" ? "Ranking not identified" : c.lower > 0 ? "Source A leads" : "Source B leads"} · A − B ${gap}`;
    $("live-gap").textContent =
      `Target mix ${pct(weight)} / ${pct(1 - weight)} · ${$("horizon").value}-day horizon`;
    $("verdict-text").textContent =
      `At your target mix, the A − B conversion gap ${gap}. Observed wins in the original source populations differ by ${pp(c.crude.a.lower - c.crude.b.lower)}. These answer different questions.`;
    $("bounds-chart").innerHTML =
      `<div class="chart-axis" aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div><h3>Original customer mix</h3>${boundRow("Source A", c.crude.a)}${boundRow("Source B", c.crude.b)}<h3>Common target mix · ${pct(weight)} / ${pct(1 - weight)}</h3>${boundRow("Source A", c.a)}${boundRow("Source B", c.b)}`;
    const evidence = ["A", "B"].map((winner) => ({
      winner,
      ...evidenceToIdentify(c, winner),
    }));
    $("evidence").innerHTML = evidence
      .map(
        (e) =>
          `<div class="evidence-row"><strong>Identify a lead for ${e.winner}</strong><div><b>${!e.possible ? "Not attainable from unresolved outcomes" : e.minimumFavorableResolutions === 0 ? "Already identified for this cohort" : `${e.minimumFavorableResolutions.toLocaleString()} favorable resolutions, at minimum`}</b><p>${e.minimumFavorableResolutions ? e.plan.map((p) => `${p.records.toLocaleString()} ${p.channel} / ${p.stratum === "segment1" ? "segment 1" : "segment 2"} outcomes confirmed as ${p.requiredOutcome}`).join("; ") + "." : "This conclusion concerns the entered cohort and declared target mix."}</p></div></div>`,
      )
      .join("");
    review = {
      project: "CRM cohort decision audit",
      startingCase: $("case").value,
      provenance: $("source-note").value,
      status: $("provenance").textContent,
      horizonDays: Number($("horizon").value),
      inputs: { a, b, weights },
      comparison: c,
      conditionalEvidence: evidence,
      method:
        "Fixed-horizon finite-cohort sharp bounds. Common-mix weighted standardization. No independent-censoring assumption; no confidence intervals or causal channel effect.",
      decisionsNotIdentified:
        "Marginal return of reallocating spend requires acquisition cost, contribution, capacity and a causal allocation design.",
    };
  } catch (e) {
    $("error").textContent = e.message;
    $("error").hidden = false;
    $("results").hidden = true;
    $("export").disabled = true;
    review = null;
    $("live-result").hidden = false;
    $("live-conclusion").textContent = "Complete valid inputs to calculate.";
    $("live-gap").textContent = "Previous results are cleared.";
  }
}
$("inputs").addEventListener("input", () => {
  $("provenance").textContent =
    "User-edited assumptions · provenance not independently verified";
  $("export-status").textContent = "";
  render();
});
$("case").addEventListener("change", () => applyCase($("case").value));
$("reset").addEventListener("click", () => applyCase($("case").value));
$("export").addEventListener("click", () => {
  if (!review) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(review, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "crm-decision-review.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("export-status").textContent =
    "Review exported with exact inputs and limits.";
});
applyCase("mix");
