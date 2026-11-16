import { readScenario, addScenarioTools } from "../scenario-tools.mjs";
import { verification } from "../verify.mjs";
import { pipeline } from "../models.mjs";
const $ = (s) => document.querySelector(s),
  names = ["Entered", "Qualified", "Discovery", "Proposal", "Won"];
const initial = readScenario("crm", location.search);
$("#source").value = initial.cohort;
$("#rate").value = initial.rate;
function render() {
  const p = pipeline($("#source").value, +$("#rate").value / 100);
  $("#rate-value").textContent = `${$("#rate").value}%`;
  $("#metrics").innerHTML = [
    ["Entered cohort", p.stages[0], "Unique leads"],
    ["Observed wins", p.stages[4], "Through 30 Apr"],
    ["Cohort win rate", `${(p.winRate * 100).toFixed(1)}%`, "Won ÷ entered"],
    ["Not won at cutoff", p.lost, "Includes unresolved leads"],
  ]
    .map(
      ([a, b, c]) =>
        `<div class="metric"><small>${a}</small><strong>${b}</strong><span>${c}</span></div>`,
    )
    .join("");
  $("#funnel").innerHTML = p.stages
    .map(
      (n, i) =>
        `<div class="bar-row"><span>${names[i]}<br><small class="muted">${i ? `${((n / p.stages[i - 1]) * 100).toFixed(1)}% from prior` : "100% of cohort"}</small></span><div class="track"><div class="fill" style="width:${(n / p.stages[0]) * 100}%"></div></div><b>${n}</b></div>`,
    )
    .join("");
  $("#forecast").textContent = `${p.forecast.toFixed(1)} expected wins`;
  $("#scenario").innerHTML =
    `<p><strong>${p.increment >= 0 ? "+" : ""}${p.increment.toFixed(1)} wins</strong> versus ${p.stages[4]} observed. Assumes the same ${p.stages[3]} proposals, with no change to upstream volume.</p>`;
  const losses = p.stages.slice(1).map((n, i) => p.stages[i] - n),
    max = Math.max(...losses),
    i = losses.indexOf(max);
  $("#decision").innerHTML =
    `<strong>Investigate ${names[i].toLowerCase()} → ${names[i + 1].toLowerCase()} first.</strong>This transition loses ${max} leads, the largest absolute drop in this cohort. Volume loss suggests where to investigate; it does not establish why leads leave or which intervention will work.`;
}
$("#source").addEventListener("change", render);
$("#rate").addEventListener("input", render);
$("#reset").addEventListener("click", () => {
  $("#source").value = "all";
  $("#rate").value = 50;
  render();
});
render();

const verify = verification({
  container: $("#scenario").parentElement,
  getPayload: () => ({
    model: "crm",
    inputs: { cohort: $("#source").value, rate: +$("#rate").value / 100 },
  }),
  getExpected: () => pipeline($("#source").value, +$("#rate").value / 100),
});
verify.init();
document
  .querySelectorAll("input,select")
  .forEach((control) =>
    control.addEventListener("input", () => verify.invalidate()),
  );
$("#reset").addEventListener("click", () => verify.invalidate());

function announceScenario() {
  const p = pipeline($("#source").value, +$("#rate").value / 100);
  $("#scenario-status").textContent =
    `Closing assumption ${$("#rate").value}%. ${p.forecast.toFixed(1)} expected wins; ${p.increment >= 0 ? "plus" : "minus"} ${Math.abs(p.increment).toFixed(1)} versus observed.`;
}
$("#rate").addEventListener("change", announceScenario);
$("#source").addEventListener("change", announceScenario);
$("#reset").addEventListener("click", announceScenario);

announceScenario();
const scenarioTools = addScenarioTools({
  model: "crm",
  container: $("#scenario").parentElement,
  getState: () => ({ cohort: $("#source").value, rate: +$("#rate").value }),
  getRows: () => {
    const p = pipeline($("#source").value, +$("#rate").value / 100);
    return [
      ["Cohort source", $("#source").value],
      ["Closing assumption fraction", +$("#rate").value / 100],
      ...p.stages.map((value, i) => [names[i], value]),
      ["Observed win rate", p.winRate],
      ["Not won at cutoff", p.lost],
      ["Expected wins", p.forecast],
      ["Incremental wins", p.increment],
      [
        "Formula expected wins",
        "proposals reached * closing assumption fraction",
      ],
      ["Formula incremental wins", "expected wins - observed wins"],
      ["Formula win rate", "observed wins / entered leads"],
      ["Observation window", "Entered 1–31 Jan; observed through 30 Apr"],
      [
        "Assumptions",
        "Synthetic cohort; cumulative milestones; constant proposal count; no timing, deal value, intervention cost or causal uplift; open-proposal aging is a separate snapshot",
      ],
    ];
  },
});
document
  .querySelectorAll("input,select")
  .forEach((control) =>
    control.addEventListener("input", () => scenarioTools.invalidate()),
  );
$("#reset").addEventListener("click", () => scenarioTools.reset());
