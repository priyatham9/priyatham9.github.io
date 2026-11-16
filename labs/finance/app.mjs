import {
  readScenario,
  addScenarioTools,
  parseBusinessAmount,
} from "../scenario-tools.mjs";
import { verification } from "../verify.mjs";
import { cash } from "../models.mjs";
import { snapshot, cashBridge } from "./compare.mjs";

const $ = (selector) => document.querySelector(selector);
const money = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const compact = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n);
const signed = (n) => (n > 0 ? `+${money(n)}` : money(n));
const spec = [
  ["dso", "Collections", "Days sales outstanding", 45, 15, 75],
  ["dio", "Inventory", "Days inventory outstanding", 60, 20, 100],
  ["dpo", "Payments", "Days payable outstanding", 30, 10, 75],
];
let pinned = null;
let chartView = "balance";
let comparisonView = "baseline";
$("#sliders").innerHTML = spec
  .map(
    ([id, label, full, value, min, max]) =>
      `<div class="slider"><div class="lever-label"><label for="${id}">${label}<small>${id.toUpperCase()}</small></label><div class="day-entry" id="${id}-value"><input id="${id}-days" type="number" inputmode="numeric" aria-label="${full}, exact days" aria-describedby="${id}-sensitivity" min="${min}" max="${max}" step="1" required value="${value}" /><span>days</span></div></div><div class="range-wrap"><span class="baseline-marker" style="left:${((value - min) / (max - min)) * 100}%" aria-hidden="true"></span><input id="${id}" aria-label="${full}" aria-describedby="${id}-sensitivity" type="range" min="${min}" max="${max}" value="${value}" step="1" /></div><div class="range-endpoints" aria-hidden="true"><span>${min}d</span><span>${max}d</span></div><p class="sensitivity" id="${id}-sensitivity"></p></div>`,
  )
  .join("");
const initial = readScenario("finance", location.search);
for (const [key, value] of Object.entries(initial)) $("#" + key).value = value;
spec.forEach(([id]) => ($("#" + id + "-days").value = initial[id]));
const values = () => ({
  ...Object.fromEntries(spec.map(([id]) => [id, +$("#" + id).value])),
  revenue: parseBusinessAmount($("#revenue").value),
  cogs: parseBusinessAmount($("#cogs").value),
});
const validDay = ([id, , , , min, max]) => {
  const raw = $("#" + id + "-days").value;
  return (
    raw !== "" &&
    Number.isInteger(Number(raw)) &&
    Number(raw) >= min &&
    Number(raw) <= max
  );
};
const businessValid = () =>
  ["revenue", "cogs"].every(
    (id) => parseBusinessAmount($("#" + id).value) !== null,
  ) && spec.every(validDay);
const custom = () => values().revenue !== 12000000 || values().cogs !== 7200000;

function drawChart(inputs, baseline, scenario, steps) {
  const balanceSteps = (c) => [
    { label: "Receivables", start: 0, end: c.ar, value: c.ar },
    {
      label: "Inventory",
      start: c.ar,
      end: c.ar + c.inventory,
      value: c.inventory,
    },
    {
      label: "Payables (−)",
      start: c.ar + c.inventory,
      end: c.nwc,
      value: -c.ap,
    },
    { label: "Net WC", start: 0, end: c.nwc, value: c.nwc, total: true },
  ];
  const baselineSteps = balanceSteps(baseline);
  const data =
    chartView === "balance"
      ? balanceSteps(scenario)
      : [
          {
            label: "Baseline",
            start: 0,
            end: baseline.nwc,
            value: baseline.nwc,
            baseline: true,
          },
          ...steps,
          {
            label: "Scenario",
            start: 0,
            end: scenario.nwc,
            value: scenario.nwc,
            total: true,
          },
        ];
  const extremes = [
    0,
    ...data.flatMap((d) => [d.start, d.end]),
    ...(chartView === "balance"
      ? baselineSteps.flatMap((d) => [d.start, d.end])
      : []),
  ];
  const low = Math.min(...extremes),
    high = Math.max(...extremes);
  const spread = high - low || 1;
  const floor = low < 0 ? low - spread * 0.1 : 0;
  const ceiling = high + spread * 0.15 || 1;
  const mobile = matchMedia("(max-width: 760px)").matches;
  const chartWidth = mobile ? 360 : 720;
  const plot = {
    left: mobile ? 46 : 66,
    right: chartWidth - (mobile ? 4 : 16),
    top: 24,
    bottom: 229,
  };
  const y = (n) =>
    plot.bottom - ((n - floor) / (ceiling - floor)) * (plot.bottom - plot.top);
  const slot = (plot.right - plot.left) / data.length;
  const width = Math.min(79, slot * 0.53);
  const x = (i) => plot.left + slot * (i + 0.5);
  let drawing = "";
  for (let i = 0; i <= 4; i++) {
    const value = floor + ((ceiling - floor) * i) / 4;
    drawing += `<line x1="${plot.left}" x2="${plot.right}" y1="${y(value)}" y2="${y(value)}" stroke="#e8ece5" /><text x="${plot.left - 12}" y="${y(value) + 4}" text-anchor="end" fill="#56655f" style="font-size:10px">${compact(value)}</text>`;
  }
  drawing += `<line x1="${plot.left}" x2="${plot.right}" y1="${y(0)}" y2="${y(0)}" stroke="#9aaa9d" stroke-width="1" />`;
  data.forEach((d, i) => {
    const top = Math.min(y(d.start), y(d.end));
    const height = Math.max(1.5, Math.abs(y(d.start) - y(d.end)));
    const color = d.baseline
      ? "#698396"
      : d.total
        ? d.value < 0
          ? "#976221"
          : "#172824"
        : d.value === 0
          ? "#a3afa4"
          : d.value < 0
            ? "#b8ccbf"
            : chartView === "release"
              ? "#b78a4c"
              : "#136c50";
    drawing += `<rect x="${x(i) - width / 2}" y="${top}" width="${width}" height="${height}" fill="${color}"><title>${d.label}: ${money(d.value)}; cumulative balance ${money(d.end)}</title></rect>`;
    if (i < data.length - 1 && !d.total)
      drawing += `<line x1="${x(i) + width / 2}" x2="${x(i + 1) - width / 2}" y1="${y(d.end)}" y2="${y(d.end)}" stroke="#a9b4a8" stroke-dasharray="3 3" />`;
    if (chartView === "balance")
      drawing += `<line x1="${x(i) - width / 2 - 6}" x2="${x(i) + width / 2 + 6}" y1="${y(baselineSteps[i].end)}" y2="${y(baselineSteps[i].end)}" stroke="#698396" stroke-width="2" />`;
    const prefix =
      chartView === "release" && !d.baseline && !d.total && d.value > 0
        ? "+"
        : "";
    drawing += `<text x="${x(i)}" y="${Math.max(14, top - 9)}" text-anchor="middle" fill="#172824" font-weight="600">${prefix}${compact(d.value)}</text><text x="${x(i)}" y="255" text-anchor="middle" fill="#45564b">${d.label}</text>`;
    if (chartView === "release" && i > 0 && i < 4) {
      const [id, , , base] = spec[i - 1];
      const change = inputs[id] - base;
      drawing += `<text x="${x(i)}" y="271" text-anchor="middle" fill="#56655f" style="font-size:10px">${change > 0 ? "+" : ""}${change} days</text>`;
    }
  });
  $("#chart-title").textContent =
    chartView === "balance"
      ? "Where the cash sits"
      : "From baseline to scenario";
  $("#chart-description").textContent =
    chartView === "balance"
      ? "Receivables + inventory − payables = net working capital"
      : "Each operating change bridges the baseline to the new cash balance.";
  $("#bars").innerHTML =
    `<svg viewBox="0 0 ${chartWidth} 285" role="img" aria-labelledby="waterfall-title waterfall-desc"><title id="waterfall-title">${chartView === "balance" ? "Working capital composition" : "Cash change bridge"}</title><desc id="waterfall-desc">${data.map((d) => `${d.label} ${money(d.value)}`).join(". ")}. Zero is marked by a horizontal axis. Full values and comparisons are in the reconciliation table below.</desc>${drawing}</svg>`;
  document.querySelector(".chart-legend").innerHTML =
    chartView === "balance"
      ? '<span><i class="swatch scenario"></i> Scenario balance</span><span><i class="swatch baseline"></i> Baseline balance marker</span><span><i class="swatch deduction"></i> Payables deduction</span>'
      : '<span><i class="swatch baseline"></i> Baseline</span><span><i class="swatch deduction"></i> Cash released</span><span><i class="swatch" style="background:#b78a4c"></i> Cash absorbed</span>';
}

function drawTable(inputs, baseline, scenario, release) {
  const rows = [
    [
      "Revenue / year",
      inputs.revenue,
      inputs.revenue,
      pinned?.inputs.revenue,
      "money",
    ],
    ["COGS / year", inputs.cogs, inputs.cogs, pinned?.inputs.cogs, "money"],
    [
      "DSO / DIO / DPO",
      "45 / 60 / 30",
      `${inputs.dso} / ${inputs.dio} / ${inputs.dpo}`,
      pinned
        ? `${pinned.inputs.dso} / ${pinned.inputs.dio} / ${pinned.inputs.dpo}`
        : "",
      "text",
    ],
    ["Receivables", baseline.ar, scenario.ar, pinned?.result.ar, "money"],
    [
      "Inventory",
      baseline.inventory,
      scenario.inventory,
      pinned?.result.inventory,
      "money",
    ],
    [
      "Payables (deduction)",
      -baseline.ap,
      -scenario.ap,
      pinned ? -pinned.result.ap : null,
      "money",
    ],
    [
      "Net working capital",
      baseline.nwc,
      scenario.nwc,
      pinned?.result.nwc,
      "money",
      true,
    ],
    [
      "Cash conversion cycle",
      baseline.ccc,
      scenario.ccc,
      pinned?.result.ccc,
      "days",
    ],
    [
      "Cash released vs. baseline",
      0,
      release,
      pinned
        ? cash({ revenue: pinned.inputs.revenue, cogs: pinned.inputs.cogs })
            .nwc - pinned.result.nwc
        : null,
      "money",
      true,
    ],
  ];
  const format = (v, kind) =>
    kind === "money" ? money(v) : kind === "days" ? `${v} days` : v;
  const comparePin = pinned && comparisonView === "pin";
  $("#comparison-heading").textContent = comparePin
    ? "Pinned A → scenario"
    : "Baseline → scenario";
  $("#comparison-table").innerHTML =
    `<table><caption>USD, rounded to the nearest dollar. Change = scenario − ${comparePin ? "pinned A" : "baseline"}.${comparePin ? " Cash release uses each scenario’s own baseline." : " Negative payables reduce working capital."}<span class="table-hint">Scroll for full values and changes →</span></caption><thead><tr><th scope="col">Measure</th><th scope="col" class="baseline-col">${comparePin ? "Pinned A" : "Baseline"}</th><th scope="col" class="scenario-col">Scenario</th><th scope="col">Change</th></tr></thead><tbody>${rows
      .map(([label, b, s, p, kind, total]) => {
        const reference = comparePin ? p : b;
        const delta = kind === "text" ? null : s - reference;
        const change =
          kind === "text"
            ? "—"
            : kind === "money"
              ? signed(delta)
              : `${delta > 0 ? "+" : ""}${delta} days`;
        return `<tr${total ? ' class="total-row"' : ""}><th scope="row">${label}</th><td class="baseline-col">${format(reference, kind)}</td><td class="scenario-col">${format(s, kind)}</td><td>${change}</td></tr>`;
      })
      .join("")}</tbody></table>`;
  if (pinned) {
    const delta = pinned.result.nwc - scenario.nwc;
    const changedScale =
      pinned.inputs.revenue !== inputs.revenue ||
      pinned.inputs.cogs !== inputs.cogs;
    $("#pin-status").textContent =
      `Pinned A: ${compact(pinned.inputs.revenue)} revenue / ${compact(pinned.inputs.cogs)} COGS. Current NWC is ${money(Math.abs(delta))} ${delta >= 0 ? "lower" : "higher"} than A.${changedScale ? " Annual amounts differ; this is not a like-for-like operating comparison." : " Annual amounts match."} Pin lasts until reload. CSV includes A; shared links contain only the current scenario.`;
  }
}

function render() {
  const valid = businessValid();
  $("#pin").disabled = !valid;
  document
    .querySelectorAll("#scenario-tools button, #verification-tools button")
    .forEach((button) => (button.disabled = !valid));
  for (const id of ["revenue", "cogs"])
    $("#" + id).setAttribute(
      "aria-invalid",
      String(parseBusinessAmount($("#" + id).value) === null),
    );
  spec.forEach(([id]) => {
    $("#" + id + "-days").setAttribute(
      "aria-invalid",
      String(!validDay(spec.find((item) => item[0] === id))),
    );
    $("#" + id).setAttribute("aria-valuetext", `${$("#" + id).value} days`);
  });
  for (const id of ["revenue", "cogs"]) {
    const amount = parseBusinessAmount($("#" + id).value);
    $("#" + id + "-readable").textContent =
      amount === null ? "Check annual amount" : money(amount) + " / year";
  }
  $("#business-status").textContent = !spec.every(validDay)
    ? "Enter whole operating days within each indicated range."
    : valid
      ? "Baseline uses these same annual amounts at 45 / 60 / 30 days. Inputs stay local until you choose to share or verify."
      : "Enter both annual amounts from $0 to $1 trillion. Blank, negative and nonfinite values cannot be calculated.";
  $("#model-disclosure").textContent = !valid
    ? "Illustrative model · check assumptions"
    : custom()
      ? "Illustrative model · your assumptions"
      : "Illustrative model · synthetic example";
  if (!valid) {
    $("#metrics").innerHTML =
      '<div><small>Scenario paused</small><strong>—</strong><span class="result-meta">Check business assumptions</span></div>';
    $("#bars").innerHTML =
      '<p class="note" style="min-height:180px;padding-top:50px">Enter valid business assumptions to view the cash position.</p>';
    $("#movement").textContent =
      "Calculation paused until all assumptions are valid.";
    $("#comparison-table").innerHTML =
      '<p class="note" style="padding:16px">Comparison is unavailable until all assumptions are valid.</p>';
    spec.forEach(
      (item) =>
        ($("#" + item[0] + "-sensitivity").textContent = validDay(item)
          ? "Sensitivity unavailable"
          : `Enter whole days: ${item[4]}–${item[5]}.`),
    );
    return;
  }
  const inputs = values();
  const { baseline, scenario, release, steps } = cashBridge(inputs);
  spec.forEach(([id]) => {
    const perDay = (id === "dso" ? inputs.revenue : inputs.cogs) / 365;
    $("#" + id + "-sensitivity").innerHTML =
      `<b>${compact(perDay)} released</b> per day ${id === "dpo" ? "later" : id === "dio" ? "less held" : "sooner"}`;
  });
  $("#metrics").innerHTML =
    `<div class="primary ${release < 0 ? "negative" : ""}"><small>Cash ${release < 0 ? "absorbed" : "released"}</small><strong title="${money(Math.abs(release))}">${compact(Math.abs(release))}</strong><span class="result-meta">One-time change vs. baseline</span></div><div class="minor"><small>Net working capital</small><strong title="${money(scenario.nwc)}">${compact(scenario.nwc)}</strong><span class="result-meta">Baseline ${compact(baseline.nwc)}</span></div><div class="minor"><small>Cash cycle</small><strong>${scenario.ccc} <span class="unit">days</span></strong><span class="result-meta">${scenario.ccc === baseline.ccc ? "Baseline 75 days" : `${scenario.ccc - baseline.ccc > 0 ? "+" : ""}${scenario.ccc - baseline.ccc} days vs. baseline`}</span></div>`;
  drawChart(inputs, baseline, scenario, steps);
  $("#movement").className = `movement ${release < 0 ? "negative" : ""}`;
  const title =
    release === 0
      ? "At the baseline balance"
      : release > 0
        ? "Less cash tied up"
        : "More cash required";
  const body =
    release === 0
      ? "Move a lever to trace its cash impact. The model measures working capital, not profit."
      : `${money(Math.abs(release))} ${release > 0 ? "released from" : "added to"} working capital. Review ${inputs.dso !== 45 ? "customer terms" : inputs.dio !== 60 ? "inventory service levels" : "supplier terms"} before acting; commercial costs are not modeled.`;
  $("#movement").innerHTML = `<strong>${title}</strong><span>${body}</span>`;
  drawTable(inputs, baseline, scenario, release);
}

const verify = verification({
  isValid: businessValid,
  container: $("#verification-tools"),
  getPayload: () => ({ model: "finance", inputs: values() }),
  getExpected: () => cash(values()),
});
const scenarioTools = addScenarioTools({
  model: "finance",
  container: $("#scenario-tools"),
  getState: values,
  isValid: businessValid,
  getLabel: () =>
    custom()
      ? "Illustrative scenario; user-entered assumptions"
      : "Synthetic public demonstration",
  getRows: () => {
    const inputs = values(),
      scenario = cash(inputs),
      baseline = cash({ revenue: inputs.revenue, cogs: inputs.cogs });
    const pinnedRows = pinned
      ? [
          ["Pinned A comparison", "Temporary snapshot included in this export"],
          ...Object.entries(pinned.inputs).map(([key, value]) => [
            `Pinned A ${key}`,
            value,
          ]),
          ...Object.entries(pinned.result).map(([key, value]) => [
            `Pinned A ${key}`,
            value,
          ]),
          ["Scenario NWC minus pinned A USD", scenario.nwc - pinned.result.nwc],
          [
            "Pinned A cash released USD",
            cash({ revenue: pinned.inputs.revenue, cogs: pinned.inputs.cogs })
              .nwc - pinned.result.nwc,
          ],
          [
            "Annual amounts match pinned A",
            inputs.revenue === pinned.inputs.revenue &&
              inputs.cogs === pinned.inputs.cogs,
          ],
        ]
      : [];
    return [
      ["Annual revenue USD", inputs.revenue],
      ["Annual COGS USD", inputs.cogs],
      ...Object.entries(inputs),
      ...Object.entries(scenario),
      ["Cash released USD", baseline.nwc - scenario.nwc],
      ["Baseline DSO / DIO / DPO", "45 / 60 / 30"],
      ...pinnedRows,
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
function changed() {
  render();
  verify.invalidate();
  scenarioTools.invalidate();
}
document.querySelectorAll("input").forEach((input) =>
  input.addEventListener("input", () => {
    const range = spec.find(([id]) => id === input.id);
    const exact = spec.find(([id]) => id + "-days" === input.id);
    if (range) $("#" + input.id + "-days").value = input.value;
    if (exact && validDay(exact)) $("#" + exact[0]).value = input.value;
    changed();
  }),
);
$("#reset").addEventListener("click", () => {
  spec.forEach(([id, , , v]) => {
    $("#" + id).value = v;
    $("#" + id + "-days").value = v;
  });
  $("#revenue").value = 12000000;
  $("#cogs").value = 7200000;
  pinned = null;
  updatePinControls();
  render();
  verify.invalidate();
  scenarioTools.reset();
});
$("#improve").addEventListener("click", () => {
  $("#dso").value = 35;
  $("#dso-days").value = 35;
  changed();
});
for (const view of ["balance", "release"])
  $("#" + view + "-view").addEventListener("click", () => {
    chartView = view;
    for (const id of ["balance", "release"])
      $("#" + id + "-view").setAttribute("aria-pressed", String(id === view));
    render();
  });
function updatePinControls() {
  $("#pin").textContent = pinned
    ? "Replace pinned A"
    : "Pin scenario for comparison";
  $("#clear-pin").hidden = !pinned;
  $("#restore-pin").hidden = !pinned;
  $("#comparison-switch").hidden = !pinned;
  if (!pinned) comparisonView = "baseline";
  $("#compare-baseline").setAttribute(
    "aria-pressed",
    String(comparisonView === "baseline"),
  );
  $("#compare-pin").setAttribute(
    "aria-pressed",
    String(comparisonView === "pin"),
  );
  if (!pinned)
    $("#pin-status").textContent =
      "Baseline holds days at 45 / 60 / 30 with your current annual amounts. Pinning keeps a temporary snapshot until reload.";
}
$("#pin").addEventListener("click", () => {
  if (!businessValid()) return;
  pinned = snapshot(values());
  comparisonView = "pin";
  updatePinControls();
  render();
});
$("#clear-pin").addEventListener("click", () => {
  pinned = null;
  updatePinControls();
  render();
  $("#pin").focus();
});
$("#restore-pin").addEventListener("click", () => {
  if (!pinned) return;
  for (const [key, value] of Object.entries(pinned.inputs))
    $("#" + key).value = value;
  spec.forEach(([id]) => ($("#" + id + "-days").value = pinned.inputs[id]));
  changed();
});
for (const view of ["baseline", "pin"])
  $("#compare-" + view).addEventListener("click", () => {
    comparisonView = view;
    updatePinControls();
    render();
  });
const mobileLayout = matchMedia("(max-width: 760px)");
function positionResults() {
  const target = mobileLayout.matches
    ? $("#mobile-results")
    : $(".analysis-panel");
  target.prepend($("#metrics"));
}
positionResults();
render();
verify.init();
mobileLayout.addEventListener("change", () => {
  positionResults();
  render();
});
