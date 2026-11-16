import {
  readScenario,
  addScenarioTools,
  parseBusinessAmount,
} from "../scenario-tools.mjs";
import { signedScale } from "../signed-scale.mjs";
import { verification } from "../verify.mjs";
import { cash } from "../models.mjs";
const $ = (s) => document.querySelector(s),
  money = (n) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n),
  spec = [
    ["dso", "Days sales outstanding", 45, 15, 75],
    ["dio", "Days inventory outstanding", 60, 20, 100],
    ["dpo", "Days payable outstanding", 30, 10, 75],
  ];
$("#sliders").innerHTML = spec
  .map(
    ([id, label, v, min, max]) =>
      `<div class="slider"><label for="${id}">${label} <strong id="${id}-value">${v} days</strong></label><input id="${id}" type="range" min="${min}" max="${max}" value="${v}" step="1"></div>`,
  )
  .join("");
const initial = readScenario("finance", location.search);
spec.forEach(([id]) => ($("#" + id).value = initial[id]));
$("#revenue").value = initial.revenue;
$("#cogs").value = initial.cogs;
function businessValid() {
  return ["revenue", "cogs"].every(
    (id) => parseBusinessAmount($("#" + id).value) !== null,
  );
}
function values() {
  return {
    ...Object.fromEntries(spec.map(([id]) => [id, +$("#" + id).value])),
    revenue: parseBusinessAmount($("#revenue").value),
    cogs: parseBusinessAmount($("#cogs").value),
  };
}
function custom() {
  const v = values();
  return v.revenue !== 12000000 || v.cogs !== 7200000;
}
function chartMoney(value) {
  return Math.abs(value) >= 1e9
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(value)
    : money(value);
}
function render() {
  const valid = businessValid();
  document
    .querySelectorAll(
      "#sliders ~ .scenario-tools button, #sliders ~ div > button",
    )
    .forEach((button) => (button.disabled = !valid));
  ["revenue", "cogs"].forEach((id) =>
    $("#" + id).setAttribute(
      "aria-invalid",
      String(parseBusinessAmount($("#" + id).value) === null),
    ),
  );
  $("#business-status").textContent = valid
    ? custom()
      ? "Illustrative scenario; user-entered assumptions. Baseline uses the same revenue and COGS at 45 / 60 / 30 days."
      : "Synthetic example. Baseline uses the same revenue and COGS at 45 / 60 / 30 days."
    : "Enter both annual amounts from $0 to $1 trillion. Blank, negative and nonfinite amounts cannot be calculated.";
  if (!valid) {
    $("#metrics").innerHTML = "";
    $("#bars").innerHTML =
      '<p class="note">Enter valid business assumptions to view the chart.</p>';
    $("#movement").textContent =
      "Calculation paused until both amounts are valid.";
    return;
  }
  $("#model-disclosure").textContent = custom()
    ? "Illustrative model · your assumptions"
    : "Illustrative model · synthetic example";
  $("#business-summary").textContent =
    `Revenue ${chartMoney(values().revenue)} · COGS ${chartMoney(values().cogs)}`;
  const inputs = values(),
    baseline = cash({ revenue: inputs.revenue, cogs: inputs.cogs }),
    c = cash(inputs),
    release = baseline.nwc - c.nwc;
  spec.forEach(
    ([id]) => ($("#" + id + "-value").textContent = inputs[id] + " days"),
  );
  $("#metrics").innerHTML = [
    ["Cash conversion cycle", c.ccc + " days", `Baseline ${baseline.ccc} days`],
    ["Net working capital", money(c.nwc), `Baseline ${money(baseline.nwc)}`],
    [
      "Cash " + (release >= 0 ? "released" : "absorbed"),
      money(Math.abs(release)),
      "One-time balance change",
    ],
    ["Daily cost of goods", money(inputs.cogs / 365), "Annual COGS ÷ 365"],
  ]
    .map(
      ([a, b, d]) =>
        `<div class="metric"><small>${a}</small><strong>${b}</strong><span>${d}</span></div>`,
    )
    .join("");
  const entries = [
      ["Receivables", c.ar],
      ["Inventory", c.inventory],
      ["Payables (−)", -c.ap],
      ["Net WC", c.nwc],
    ],
    scale = signedScale(entries.map(([, value]) => value));
  $("#bars").innerHTML =
    `<p class="note">Shared scale: ${money(scale.low)} to ${money(scale.high)}. Payables are shown as a deduction. The vertical line marks $0.</p>` +
    entries
      .map(
        ([label, value], i) =>
          `<div class="bar-row signed-row"><span>${label}</span><div class="track signed-track" aria-hidden="true"><span class="zero-axis" style="left:${scale.zero}%"></span><div class="fill signed-fill" style="left:${scale.bars[i].left}%;width:${scale.bars[i].width}%;${value < 0 ? "background:#879d90" : ""}"></div></div><b title="${money(value)}" aria-label="${money(value)}">${chartMoney(value)}</b></div>`,
      )
      .join("");
  $("#movement").innerHTML =
    `<strong>${release === 0 ? "Baseline scenario" : release > 0 ? "Less cash tied up" : "More cash tied up"}</strong>${release === 0 ? "Move a lever to compare the scenario with the baseline." : `${money(Math.abs(release))} ${release > 0 ? "released from" : "added to"} operating working capital. Review the commercial tradeoffs before treating this as an actionable target.`}`;
}
spec.forEach(([id]) => $("#" + id).addEventListener("input", render));
$("#reset").addEventListener("click", () => {
  spec.forEach(([id, l, v]) => ($("#" + id).value = v));
  $("#revenue").value = 12000000;
  $("#cogs").value = 7200000;
  render();
});
render();

const verify = verification({
  isValid: businessValid,
  container: $("#sliders").parentElement,
  getPayload: () => ({
    model: "finance",
    inputs: values(),
  }),
  getExpected: () => cash(values()),
});
verify.init();
document
  .querySelectorAll("input,select")
  .forEach((control) =>
    control.addEventListener("input", () => verify.invalidate()),
  );
$("#reset").addEventListener("click", () => verify.invalidate());

const scenarioTools = addScenarioTools({
  model: "finance",
  container: $("#sliders").parentElement,
  getState: values,
  isValid: businessValid,
  getLabel: () =>
    custom()
      ? "Illustrative scenario; user-entered assumptions"
      : "Synthetic public demonstration",
  getRows: () => {
    $("#model-disclosure").textContent = custom()
      ? "Illustrative model · your assumptions"
      : "Illustrative model · synthetic example";
    $("#business-summary").textContent =
      `Revenue ${chartMoney(values().revenue)} · COGS ${chartMoney(values().cogs)}`;
    const inputs = values(),
      c = cash(inputs),
      baseline = cash({ revenue: inputs.revenue, cogs: inputs.cogs });
    return [
      ["Annual revenue USD", inputs.revenue],
      ["Annual COGS USD", inputs.cogs],
      ...Object.entries(inputs),
      ...Object.entries(c),
      ["Cash released USD", baseline.nwc - c.nwc],
      ["Baseline DSO / DIO / DPO", "45 / 60 / 30"],
      ["Formula AR", "annual revenue / 365 * DSO"],
      ["Formula inventory", "annual COGS / 365 * DIO"],
      ["Formula AP", "annual COGS / 365 * DPO"],
      ["Formula NWC", "AR + inventory - AP"],
      ["Formula CCC", "DSO + DIO - DPO"],
      ["Formula cash released", "baseline NWC - scenario NWC"],
      [
        "Assumptions",
        "USD; 365 days; steady annual run rate; purchases approximate COGS; one-time cash release; excludes seasonality, taxes, growth and commercial costs",
      ],
    ];
  },
});
spec.forEach(([id]) =>
  $("#" + id).addEventListener("input", () => scenarioTools.invalidate()),
);
$("#reset").addEventListener("click", () => scenarioTools.reset());

["revenue", "cogs"].forEach((id) =>
  $("#" + id).addEventListener("input", () => {
    render();
    verify.invalidate();
    scenarioTools.invalidate();
  }),
);
render();
