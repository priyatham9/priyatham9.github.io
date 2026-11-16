import { readScenario, addScenarioTools } from "../scenario-tools.mjs";
import { verification } from "../verify.mjs";
import { pipeline, cohorts } from "../models.mjs";
import {
  deriveCohort,
  compareTransition,
  stageNames as names,
} from "./derive.mjs";
const $ = (s) => document.querySelector(s);
const initial = readScenario("crm", location.search);
const labels = { all: "All sources", inbound: "Inbound", outbound: "Outbound" };
const pct = (n) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);
const viewParams = new URLSearchParams(location.search);
const stageParam = Number(viewParams.get("stage"));
let selectedStage =
  Number.isInteger(stageParam) && stageParam >= 1 && stageParam <= 4
    ? stageParam
    : 1;
let chartMeasure =
  viewParams.get("measure") === "reach" ? "reach" : "conversion";
function saveView() {
  const url = new URL(location.href);
  url.searchParams.set("stage", selectedStage);
  url.searchParams.set("measure", chartMeasure);
  history.replaceState(null, "", url);
}
$("#source").value = initial.cohort;
$("#rate").value = initial.rate;
function state() {
  return { cohort: $("#source").value, rate: +$("#rate").value };
}
function isScenarioValid() {
  return $("#rate-value").getAttribute("aria-invalid") !== "true";
}
function setEntryValidity(valid) {
  $("#rate-value").setAttribute("aria-invalid", String(!valid));
  $("#rate-entry-error").hidden = valid;
  $(".scenario-result").hidden = !valid;
  $("#scenario-plot").hidden = !valid;
  document.querySelectorAll("#scenario-actions button").forEach((button) => {
    button.disabled = !valid;
  });
}
function current() {
  const s = state();
  return pipeline(s.cohort, s.rate / 100);
}
function renderDrilldown() {
  const p = current(),
    d = deriveCohort(p.stages),
    t = d.transitions[selectedStage - 1];
  const comparison = compareTransition(
    cohorts.inbound,
    cohorts.outbound,
    selectedStage,
  );
  const gap = comparison.gapPoints;
  const gapLabel =
    gap === null
      ? "No comparable denominator"
      : gap === 0
        ? "Equal conversion across sources"
        : `${Math.abs(gap).toFixed(1)} percentage points ${gap > 0 ? "higher for inbound" : "higher for outbound"}`;
  const detailHTML = `<div class="drilldown-top"><h3>${t.from} → ${t.to}</h3><span>${labels[state().cohort]}</span></div><div class="drilldown-values"><div><small>Advanced</small><strong>${t.reached}<span>of ${t.previous} at prior milestone</span></strong></div><div><small>Conditional conversion</small><strong>${pct(t.conversion)}</strong><span>${t.reached} ÷ ${t.previous}</span></div><div><small>Not advanced</small><strong>${t.loss}</strong><span>${t.previous} − ${t.reached} leads</span></div></div><p>${pct(t.retained)} of the original ${p.stages[0]} leads reached ${t.to.toLowerCase()}. ${d.largestLoss.some((v) => v.index === selectedStage) ? "This transition has the largest absolute drop" + (d.largestLoss.length > 1 ? " (tied)." : ".") : "Absolute volume loss and conditional conversion answer different questions."}</p>`;
  const comparisonHTML = `<div class="source-comparison"><span>Source comparison · same transition</span><strong>${gapLabel}</strong><p>Inbound ${pct(comparison.inbound.conversion)} (${comparison.inbound.reached} / ${comparison.inbound.previous}) · Outbound ${pct(comparison.outbound.conversion)} (${comparison.outbound.reached} / ${comparison.outbound.previous}). Descriptive difference; causal effects are not estimated.</p></div>`;
  if ($("#drilldown").innerHTML !== detailHTML + comparisonHTML)
    $("#drilldown").innerHTML = detailHTML + comparisonHTML;
  document.querySelectorAll(".funnel-row[data-stage]").forEach((row) => {
    const active = +row.dataset.stage === selectedStage;
    row.classList.toggle("selected", active);
    row.querySelector("button").setAttribute("aria-pressed", String(active));
  });
}
function render() {
  try {
    const p = current(),
      d = deriveCohort(p.stages),
      s = state();
    $("#error").hidden = true;
    $("#rate-value").value = s.rate;
    setEntryValidity(true);
    $("#metrics").innerHTML = [
      ["Leads entered", p.stages[0], `${labels[s.cohort]} · January cohort`],
      ["Observed wins", p.stages[4], "Final milestone · through 30 Apr"],
      [
        "Cohort win rate",
        pct(p.winRate),
        `${p.stages[4]} wins ÷ ${p.stages[0]} entered`,
      ],
      ["Not won at cutoff", p.lost, "Includes unresolved leads"],
    ]
      .map(
        ([a, b, c]) =>
          `<div class="metric"><small>${a}</small><strong>${b}</strong><span>${c}</span></div>`,
      )
      .join("");
    $("#chart-description").textContent =
      chartMeasure === "conversion"
        ? "Bar length and rate = leads reaching this milestone ÷ leads at the preceding milestone. Count labels show leads reached."
        : "Bar length and rate = leads reaching this milestone ÷ original source leads (140 inbound; 100 outbound). Count labels show leads reached.";
    document
      .querySelectorAll("[data-measure]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.measure === chartMeasure),
        ),
      );
    $("#funnel").innerHTML = names
      .map(
        (name, i) =>
          `<div class="funnel-row${i === selectedStage ? " selected" : ""}" ${i ? `data-stage="${i}"` : ""}>${i ? `<button type="button" class="milestone" aria-label="Inspect ${names[i - 1]} to ${name} conversion" aria-pressed="${i === selectedStage}" aria-controls="drilldown"><span class="milestone-number">0${i + 1}</span>${name}</button>` : `<span class="milestone"><span class="milestone-number">01</span>${name}</span>`}${[
            "inbound",
            "outbound",
          ]
            .map((key) => {
              const stages = cohorts[key],
                t = i ? deriveCohort(stages).transitions[i - 1] : null;
              const ratio =
                chartMeasure === "conversion" && t
                  ? t.conversion
                  : stages[i] / stages[0];
              const denominator =
                chartMeasure === "conversion" && t ? t.previous : stages[0];
              const denominatorLabel =
                chartMeasure === "conversion" ? "prior" : "entered";
              return `<div role="group" aria-label="${labels[key]}, ${name}" class="source-${key}${s.cohort !== "all" && s.cohort !== key ? " source-muted" : ""}"><div class="stage-bar"><div class="stage-fill" style="width:${ratio * 100}%"></div><span class="stage-count">${stages[i]}</span></div><div class="stage-detail">${t ? `<strong>${pct(ratio)}</strong><span>${t.reached} / ${denominator} ${denominatorLabel}</span>` : `<strong>100%</strong><span>source baseline</span>`}</div></div>`;
            })
            .join("")}</div>`,
      )
      .join("");
    renderDrilldown();
    $("#observed-rate").textContent = pct(p.stages[4] / p.stages[3]);
    $("#observed-denominator").textContent =
      `${p.stages[4]} won ÷ ${p.stages[3]} proposals · ${labels[s.cohort].toLowerCase()}`;
    $("#forecast").innerHTML = `${p.forecast.toFixed(1)}<small>wins</small>`;
    $("#scenario").innerHTML =
      `<p><strong>${p.increment >= 0 ? "+" : ""}${p.increment.toFixed(1)} vs. ${p.stages[4]} observed</strong><br />${p.stages[3]} proposals × ${s.rate}% assumed</p>`;
    $("#scenario-plot").innerHTML =
      [
        ["Observed", p.stages[4], ""],
        ["Assumed", p.forecast, "assumed"],
      ]
        .map(
          ([label, n, c]) =>
            `<div class="scenario-line ${c}"><span>${label}</span><div class="scenario-track"><i style="width:${p.stages[3] ? (n / p.stages[3]) * 100 : 0}%"></i></div><strong>${Number(n).toFixed(c ? 1 : 0)}</strong></div>`,
        )
        .join("") +
      `<p class="data-note">Shared scale: 0–${p.stages[3]} proposals</p>`;
    const largest = d.largestLoss,
      lowest = d.lowestConversion;
    $("#decision").innerHTML =
      `<span class="section-index">READ THE SIGNALS</span><div><strong>Largest volume drop${largest.length > 1 ? " · tied" : ""}</strong><p><em>${largest.map((t) => `${t.from} → ${t.to}`).join("; ")}</em><br />${largest[0].loss} leads did not advance${largest.length > 1 ? " at each transition" : ""}. This locates volume loss; it does not explain its cause.</p></div><div><strong>Lowest conditional conversion${lowest.length > 1 ? " · tied" : ""}</strong><p><em>${lowest.map((t) => `${t.from} → ${t.to}`).join("; ")}</em><br />${pct(lowest[0]?.conversion ?? null)} advanced. Compare with the prior-stage denominator before choosing an investigation.</p></div>`;
  } catch {
    $("#error").hidden = false;
    $("#error").textContent =
      "This cohort could not be calculated. Reset the workspace to restore the synthetic baseline.";
  }
}
function announceScenario() {
  const p = current();
  $("#scenario-status").textContent =
    `${labels[state().cohort]}. Closing assumption ${state().rate}%. ${p.forecast.toFixed(1)} expected wins; ${p.increment >= 0 ? "plus" : "minus"} ${Math.abs(p.increment).toFixed(1)} versus ${p.stages[4]} observed.`;
}
$("#funnel").addEventListener("click", (event) => {
  const button = event.target.closest("button.milestone");
  if (!button) return;
  selectedStage = +button.closest("[data-stage]").dataset.stage;
  renderDrilldown();
  saveView();
});
$("#funnel").addEventListener("keydown", (event) => {
  if (
    !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
    !event.target.closest("button.milestone")
  )
    return;
  event.preventDefault();
  selectedStage =
    event.key === "Home"
      ? 1
      : event.key === "End"
        ? 4
        : Math.max(
            1,
            Math.min(4, selectedStage + (event.key === "ArrowDown" ? 1 : -1)),
          );
  renderDrilldown();
  $(`[data-stage="${selectedStage}"] button`).focus();
  saveView();
});
document.querySelectorAll("[data-measure]").forEach((button) =>
  button.addEventListener("click", () => {
    chartMeasure = button.dataset.measure;
    render();
    saveView();
  }),
);
$("#source").addEventListener("change", () => {
  render();
  announceScenario();
});
$("#rate").addEventListener("input", render);
$("#rate").addEventListener("change", announceScenario);
render();
announceScenario();
const verify = verification({
  container: $("#scenario-actions"),
  getPayload: () => ({
    model: "crm",
    inputs: { cohort: state().cohort, rate: state().rate / 100 },
  }),
  getExpected: current,
  isValid: isScenarioValid,
});
verify.init();
const scenarioTools = addScenarioTools({
  model: "crm",
  container: $("#scenario-actions"),
  getState: state,
  isValid: isScenarioValid,
  getRows: () => {
    const p = current();
    return [
      ["Cohort source", state().cohort],
      [
        "Selected transition",
        `${names[selectedStage - 1]} to ${names[selectedStage]}`,
      ],
      [
        "Chart measure",
        chartMeasure === "conversion"
          ? "Reached / preceding milestone"
          : "Reached / source entered",
      ],
      ["Closing assumption fraction", state().rate / 100],
      ...p.stages.map((value, i) => [names[i], value]),
      ["Observed win rate", p.winRate],
      ["Not won at cutoff", p.lost],
      ["Expected wins", p.forecast],
      ["Incremental wins", p.increment],
      ...deriveCohort(p.stages).transitions.flatMap((t) => [
        [`${t.from} to ${t.to} conversion`, t.conversion],
        [`${t.from} to ${t.to} not advanced`, t.loss],
      ]),
      [
        "Formula expected wins",
        "proposals reached * closing assumption fraction",
      ],
      ["Formula incremental wins", "expected wins - observed wins"],
      ["Formula win rate", "observed wins / entered leads"],
      ...["inbound", "outbound"].flatMap((key) =>
        deriveCohort(cohorts[key]).transitions.flatMap((t) => [
          [`${labels[key]} ${t.from} to ${t.to} reached`, t.reached],
          [`${labels[key]} ${t.from} to ${t.to} prior denominator`, t.previous],
          [`${labels[key]} ${t.from} to ${t.to} conversion`, t.conversion],
          [`${labels[key]} ${t.from} to ${t.to} not advanced`, t.loss],
        ]),
      ),
      [
        "Selected transition source gap percentage points (inbound minus outbound)",
        compareTransition(cohorts.inbound, cohorts.outbound, selectedStage)
          .gapPoints,
      ],
      ["Observation window", "Entered 1–31 Jan; observed through 30 Apr"],
      [
        "Assumptions",
        "Synthetic cohort; cumulative milestones; constant proposal count; no timing, deal value, intervention cost or causal uplift; open-proposal aging is a separate snapshot",
      ],
    ];
  },
});
document.querySelectorAll("#source,#rate").forEach((control) =>
  control.addEventListener("input", () => {
    verify.invalidate();
    scenarioTools.invalidate();
  }),
);
$("#reset").addEventListener("click", () => {
  $("#source").value = "all";
  $("#rate").value = 50;
  selectedStage = 1;
  chartMeasure = "conversion";
  render();
  announceScenario();
  verify.invalidate();
  scenarioTools.reset();
  const url = new URL(location.href);
  url.searchParams.delete("stage");
  url.searchParams.delete("measure");
  history.replaceState(null, "", url);
});

$("#rate-value").addEventListener("input", () => {
  const input = $("#rate-value"),
    value = input.valueAsNumber;
  const valid =
    input.value.trim() !== "" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100;
  setEntryValidity(valid);
  verify.invalidate();
  if (!valid) return;
  $("#rate").value = value;
  render();
  announceScenario();
  scenarioTools.invalidate();
});
$("#rate-value").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    render();
    announceScenario();
  }
});
