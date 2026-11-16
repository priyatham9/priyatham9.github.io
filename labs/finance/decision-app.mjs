import { evaluatePolicy, breakEvenFrontier } from "./decision-model.mjs";
import {
  snapshotPolicy,
  comparePolicySnapshots,
} from "./decision-comparison.mjs";
import {
  base as illustrativeBase,
  assumptions as illustrativeAssumptions,
  policies,
} from "./decision-examples.mjs";
const $ = (id) => document.getElementById(id),
  num = (id) => Number($(id).value);
const money = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.abs(n) < 0.5 ? 0 : n);
const percent = (n) => `${(100 * n).toFixed(3)}%`;
const specs = [
  ["dso", "Receivables · DSO", 45, 35, 25, 60],
  ["dio", "Inventory · DIO", 60, 60, 45, 90],
  ["dpo", "Payables · DPO", 30, 30, 15, 45],
];
const caseLabels = {
  customerDiscount: "Customer discount · collect in 35 days",
  collectionsProcess: "Collections process · collect in 35 days",
  tighterInventory: "Lean inventory · assume 1% sales lost",
  loseSupplierDiscount: "Later payment · lose supplier discount",
  impossibleCashTarget: "Aggressive days · outside declared limits",
  unchanged: "No change to current operations",
};
const caseDescriptions = {
  customerDiscount:
    "A 1% discount applies to all retained sales. The extra receivables release must pay for that recurring concession.",
  collectionsProcess:
    "The same 35-day collections target uses an assumed $15,000 annual process cost and $10,000 setup cost, with no customer discount.",
  tighterInventory:
    "Inventory falls from 60 to 45 days, but the constructed policy loses 1% of sales volume. Lost contribution matters alongside released stock.",
  loseSupplierDiscount:
    "Payment stretches from 30 to 45 days while purchase cost rises by 2/98, equivalent to foregoing a 2% invoice discount.",
  impossibleCashTarget:
    "The 15 / 10 / 90 day proposal exceeds every declared operating range. Attractive arithmetic cannot make an infeasible policy acceptable.",
  unchanged:
    "The operating days and commercial terms stay at the current baseline. Incremental cash release and value are zero.",
};
const commercialKeys = [
  "salesLoss",
  "discount",
  "discountShare",
  "supplierPremium",
  "annualOperatingCost",
  "setupCost",
];
const alternatives = Object.keys(caseLabels);
$("case").innerHTML = alternatives
  .map((k) => `<option value="${k}">${caseLabels[k]}</option>`)
  .join("");
$("comparison-case").innerHTML = $("case").innerHTML;
let review = null,
  pinned = null;
const escape = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
$("days").innerHTML = specs
  .map(
    ([key, label, current, policy]) =>
      `<div class="day-row"><strong>${label}</strong><input aria-label="Current ${key.toUpperCase()}" id="base-${key}" type="number" min="0" max="1000" step="any" value="${current}" required><input aria-label="Policy ${key.toUpperCase()}" id="${key}" type="number" min="0" max="1000" step="any" value="${policy}" required></div>`,
  )
  .join("");
$("limits").innerHTML = specs
  .map(
    ([key, label, , , min, max]) =>
      `<fieldset><legend>${label} feasible range</legend><label>Minimum days<input id="min-${key}" type="number" min="0" max="1000" step="any" value="${min}" required></label><label>Maximum days<input id="max-${key}" type="number" min="0" max="1000" step="any" value="${max}" required></label></fieldset>`,
  )
  .join("");
function row(label, value, detail, klass = "") {
  return `<div class="ledger-row ${klass}"><div><strong>${label}</strong><span>${detail}</span></div><b>${money(value)}</b></div>`;
}
function policyFor(key, base) {
  return key === "unchanged"
    ? { dso: base.dso, dio: base.dio, dpo: base.dpo }
    : { ...policies[key] };
}
function applyCase(key) {
  pinned = null;
  $("inputs").reset();
  for (const name of ["revenue", "cogs"])
    $(name).value = illustrativeBase[name];
  for (const [name] of specs) {
    $(`base-${name}`).value = illustrativeBase[name];
    $(name).value = policies[key][name];
    $(`min-${name}`).value = illustrativeAssumptions.limits[name][0];
    $(`max-${name}`).value = illustrativeAssumptions.limits[name][1];
  }
  for (const name of commercialKeys)
    $(name).value =
      (policies[key][name] ?? 0) *
      (["annualOperatingCost", "setupCost"].includes(name) ? 1 : 100);
  $("rate").value = 100 * illustrativeAssumptions.rate;
  $("years").value = illustrativeAssumptions.years;
  $("source-note").value = `Constructed policy: ${caseLabels[key]}`;
  $("case").value = key;
  $("case-description").textContent = caseDescriptions[key];
  $("comparison-case").value =
    key === "collectionsProcess" ? "customerDiscount" : "collectionsProcess";
  $("frontier").value = [
    "tighterInventory",
    "collectionsProcess",
    "unchanged",
  ].includes(key)
    ? "salesLoss"
    : key === "loseSupplierDiscount"
      ? "supplierPremium"
      : "discount";
  $("provenance").textContent =
    "Constructed policy · no empirical business finding";
  $("export-status").textContent = "";
  render();
}
function displayChanged(value, format) {
  const precise = (n) =>
    n.toLocaleString("en-US", { maximumSignificantDigits: 21 });
  if (format === "money") return `$${precise(value)}`;
  if (format === "percent") return `${precise(value * 100)}%`;
  return `${precise(value)} ${format}`;
}
function renderSnapshotComparison() {
  $("live-result").hidden = false;
  $("pin-current").disabled = !review;
  $("pin-current").textContent = pinned ? "Replace pin" : "Pin current";
  $("clear-pin").hidden = !pinned;
  $("live-pinned").hidden = !pinned;
  $("pinned-comparison").hidden = !pinned || !review;
  if (!review) {
    $("live-value").textContent = "Complete valid inputs to calculate.";
    $("live-basis").textContent = "Previous current results are cleared.";
    if (pinned)
      $("live-pinned-text").textContent =
        `Pinned NPV ${money(pinned.result.npv)} remains frozen. Current comparison unavailable.`;
    $("live-pinned").querySelector("a").hidden = true;
    return;
  }
  const current = snapshotPolicy(review),
    r = current.result;
  $("live-value").textContent = `${money(r.npv)} modeled NPV`;
  $("live-basis").textContent =
    `${money(Math.abs(r.release))} ${r.release >= 0 ? "released" : "absorbed"} · ${r.feasible ? "Within declared ranges" : "Outside declared ranges"} · ${current.assumptions.years} years`;
  if (!pinned) {
    review.pinnedScenario = null;
    review.pinnedComparison = null;
    return;
  }
  const comparison = comparePolicySnapshots(pinned, current),
    delta = comparison.currentMinusPinnedNpv;
  $("live-pinned").querySelector("a").hidden = false;
  $("live-pinned-text").textContent =
    `Pinned NPV ${money(pinned.result.npv)} → current ${money(r.npv)} · ${comparison.changes.length} input ${comparison.changes.length === 1 ? "change" : "changes"}${comparison.sameContext ? "" : " · context differs"}`;
  $("pinned-context").textContent = comparison.sameContext
    ? "Business context and constraints match. Any numerical differences are in the policy inputs listed below."
    : "Business context or constraints differ. Each scenario keeps its own baseline, rate, horizon and limits; the NPV difference cannot be attributed to the policy alone.";
  $("pinned-context").classList.toggle(
    "context-differs",
    !comparison.sameContext,
  );
  $("pinned-summary").textContent =
    comparison.changes.length === 0
      ? "All numerical assumptions match the pin. The modeled results are unchanged."
      : `${Math.abs(delta) < 0.01 ? "The modeled NPV difference is less than one cent." : `Current modeled NPV is ${money(Math.abs(delta))} ${delta > 0 ? "higher" : "lower"} than the pin.`} ${r.feasible && pinned.result.feasible ? "Both policies are within their own declared operating ranges." : "At least one policy is outside its own declared operating ranges."}`;
  $("pinned-rows").innerHTML = [
    ["Pinned", pinned],
    ["Current", current],
  ]
    .map(
      ([name, s]) =>
        `<tr><th scope="row">${name}<small>${escape(s.provenance)}</small><small>${escape(s.status)}</small></th><td>${money(s.result.release)}</td><td>${money(s.result.annualCommercialCost)}</td><td>${money(s.policy.setupCost)}</td><td>${money(s.result.npv)}</td><td>${s.result.feasible ? "Within own ranges" : "Outside own ranges"}</td></tr>`,
    )
    .join("");
  $("pinned-changes").hidden = comparison.changes.length === 0;
  $("pinned-changes-label").textContent =
    `${comparison.changes.length} changed numerical assumptions · pinned → current`;
  $("pinned-change-rows").innerHTML = comparison.changes
    .map(
      (c) =>
        `<tr><th scope="row">${c.label}<small>${c.group}</small></th><td>${displayChanged(c.before, c.format)}</td><td>${displayChanged(c.after, c.format)}</td></tr>`,
    )
    .join("");
  review.pinnedScenario = pinned;
  review.pinnedComparison = comparison;
}
function comparePolicies(base, current, currentResult, assumptions) {
  const key = $("comparison-case").value,
    alternative = policyFor(key, base),
    result = evaluatePolicy(base, alternative, assumptions);
  const rows = [
    { label: "Current policy", policy: current, result: currentResult },
    { label: caseLabels[key], policy: alternative, result },
  ];
  $("comparison-rows").innerHTML = rows
    .map(
      ({ label, policy: p, result: r }) =>
        `<tr><th scope="row">${label}</th><td>${p.dso} / ${p.dio} / ${p.dpo}</td><td>${money(r.release)}</td><td>${money(r.annualCommercialCost)}</td><td>${money(p.setupCost ?? 0)}</td><td>${money(r.npv)}</td><td>${r.feasible ? "Within ranges" : "Outside ranges"}</td></tr>`,
    )
    .join("");
  const delta = result.npv - currentResult.npv,
    releaseDelta = result.release - currentResult.release;
  $("comparison-summary").textContent =
    !result.feasible || !currentResult.feasible
      ? "At least one policy is outside the declared feasible set. The numerical comparison does not make it implementable."
      : Math.abs(delta) < 0.01
        ? "The two policies have equal modeled value under this context."
        : `The alternative has ${money(Math.abs(releaseDelta))} ${releaseDelta >= 0 ? "more" : "less"} initial cash release. Its modeled NPV is ${money(result.npv)}, versus ${money(currentResult.npv)} for the current policy (${money(Math.abs(delta))} ${delta >= 0 ? "more" : "less"} value).`;
  $("comparison-assumptions").textContent =
    `Alternative assumptions: ${percent(alternative.salesLoss ?? 0)} sales loss; ${percent(alternative.discount ?? 0)} customer discount on ${percent(alternative.discountShare ?? 0)} of retained sales; ${percent(alternative.supplierPremium ?? 0)} supplier premium on ${percent(alternative.supplierShare ?? 0)} of variable purchases; ${money(alternative.annualOperatingCost ?? 0)} annual operating cost; ${money(alternative.setupCost ?? 0)} setup. All unlisted commercial costs are zero.`;
  return {
    name: key,
    label: caseLabels[key],
    policy: alternative,
    result,
    incrementalNpvVersusCurrent: delta,
    incrementalReleaseVersusCurrent: releaseDelta,
    interpretation:
      "Constructed alternative under the same entered business context; operating targets and commercial responses are not validated.",
  };
}
function plot(base, policy, assumptions, parameter, frontier) {
  const current = policy[parameter];
  const maxX = Math.min(
    1,
    Math.max(
      0.02,
      current * 1.35,
      frontier.inRange ? frontier.threshold * 1.5 : 0,
    ),
  );
  const at = (x) =>
    evaluatePolicy(base, { ...policy, [parameter]: x }, assumptions).npv;
  const lo = at(0),
    hi = at(maxX),
    yMin = Math.min(0, lo, hi),
    yMax = Math.max(0, lo, hi),
    span = yMax - yMin || 1;
  const width = Math.max(300, $("frontier-chart").clientWidth),
    right = width - 20;
  const x = (n) => 90 + (n / maxX) * (right - 90),
    y = (n) => 36 + ((yMax - n) / span) * 190;
  const threshold =
    frontier.inRange && frontier.threshold <= maxX
      ? `<line x1="${x(frontier.threshold)}" y1="28" x2="${x(frontier.threshold)}" y2="235" stroke="#7d6d4e" stroke-dasharray="4 4"/><text x="${x(frontier.threshold)}" y="17" text-anchor="${frontier.threshold / maxX > 0.55 ? "end" : "start"}" fill="#51432c">Break-even ${percent(frontier.threshold)}</text>`
      : "";
  $("frontier-chart").innerHTML =
    `<svg viewBox="0 0 ${width} 280" role="img" aria-labelledby="plot-title plot-desc"><title id="plot-title">Policy value as ${parameter} changes</title><desc id="plot-desc">At zero cost, value is ${money(lo)}; at ${percent(maxX)}, value is ${money(hi)}. Current policy value is ${money(at(current))}. ${frontier.inRange ? `Break-even is ${percent(frontier.threshold)}.` : "No break-even lies in the valid range."}</desc><line x1="90" y1="${y(0)}" x2="${right}" y2="${y(0)}" stroke="#8d9993"/><text x="82" y="${y(0) + 4}" text-anchor="end">$0</text>${yMax !== 0 ? `<text x="82" y="${y(yMax) + 4}" text-anchor="end">${money(yMax)}</text>` : ""}${yMin !== 0 ? `<text x="82" y="${y(yMin) + 4}" text-anchor="end">${money(yMin)}</text>` : ""}${threshold}<path d="M${x(0)},${y(lo)}L${x(maxX)},${y(hi)}" stroke="#075c50" stroke-width="3" fill="none"/><circle cx="${x(current)}" cy="${y(at(current))}" r="6" fill="#075c50" stroke="#fff" stroke-width="2"/><text x="90" y="260">0%</text><text x="${right}" y="260" text-anchor="end">${percent(maxX)}</text><text x="${(90 + right) / 2}" y="279" text-anchor="middle">${{ discount: "Customer discount", salesLoss: "Lost sales volume", supplierPremium: "Supplier premium" }[parameter]} · all other inputs fixed</text></svg>`;
}
function render() {
  try {
    if (!$("inputs").checkValidity())
      throw new Error(
        "Complete all inputs with valid values. Fractions must be 0–100%; monetary inputs and days must be nonnegative.",
      );
    const base = {
      revenue: num("revenue"),
      cogs: num("cogs"),
      ...Object.fromEntries(specs.map(([k]) => [k, num(`base-${k}`)])),
    };
    const policy = {
      ...Object.fromEntries(specs.map(([k]) => [k, num(k)])),
      ...Object.fromEntries(
        ["discount", "discountShare", "salesLoss", "supplierPremium"].map(
          (k) => [k, num(k) / 100],
        ),
      ),
      supplierShare: 1,
      annualOperatingCost: num("annualOperatingCost"),
      setupCost: num("setupCost"),
    };
    const assumptions = {
      rate: num("rate") / 100,
      years: num("years"),
      limits: Object.fromEntries(
        specs.map(([k]) => [k, [num(`min-${k}`), num(`max-${k}`)]]),
      ),
    };
    const r = evaluatePolicy(base, policy, assumptions),
      parameter = $("frontier").value,
      f = breakEvenFrontier(base, policy, assumptions, parameter);
    $("error").hidden = true;
    $("results").hidden = false;
    $("export").disabled = false;
    $("verdict-title").textContent = !r.feasible
      ? "The policy lies outside your feasible set."
      : r.npv < -0.01
        ? `${money(Math.abs(r.release))} ${r.release >= 0 ? "released" : "absorbed"}. ${money(Math.abs(r.npv))} of modeled value lost.`
        : r.npv > 0.01
          ? `${money(Math.abs(r.release))} ${r.release >= 0 ? "released" : "absorbed"}. ${money(r.npv)} of modeled value.`
          : "The policy breaks even under these assumptions.";
    $("verdict-text").textContent = !r.feasible
      ? r.violations.join("; ")
      : `Annual commercial cost is ${money(r.annualCommercialCost)}. At ${(assumptions.rate * 100).toFixed(1)}%, these balances can support ${money(r.breakEvenAnnualCostAtCurrentBalances)} a year after annualizing setup. The difference drives the ${assumptions.years}-year result.`;
    $("timing").textContent =
      `Start → ${assumptions.years} years → baseline restored`;
    $("ledger").innerHTML =
      row(
        "Cash released at the start",
        r.release,
        `${money(r.daysRelease)} from operating days; ${money(r.economicsRelease)} from changed sales/cost balances.`,
      ) +
      row(
        "Setup paid at the start",
        -policy.setupCost,
        "One-time implementation expense.",
      ) +
      row(
        "Commercial cost each year",
        -r.annualCommercialCost,
        `${money(r.annualLostContribution)} lost contribution + ${money(r.annualDiscountCost)} discounts + ${money(r.annualSupplierCost)} supplier premiums + ${money(policy.annualOperatingCost)} operations.`,
      ) +
      row(
        `Working capital restored in year ${assumptions.years}`,
        -r.terminalReinvestment,
        "Policy ends; the original difference in working capital is restored.",
      ) +
      row(
        "Net present value",
        r.npv,
        `All flows discounted at ${(assumptions.rate * 100).toFixed(1)}% annually. ${r.feasible ? "Within declared operating-day ranges." : "Outside declared operating-day ranges."}`,
        "total",
      );
    $("frontier-summary").textContent =
      f.threshold === null
        ? "This input has no effect under the current assumptions. Check its eligible share."
        : f.inRange
          ? `Break-even ${parameter === "salesLoss" ? "sales loss" : parameter === "supplierPremium" ? "supplier premium" : "customer discount"}: ${percent(f.threshold)}. Value is positive ${f.favorableSide} that point${r.feasible ? "." : ", but the operating-day policy remains infeasible."}`
          : `No break-even lies between 0% and 100% under the other current assumptions.`;
    plot(base, policy, assumptions, parameter, f);
    const comparison = comparePolicies(base, policy, r, assumptions);
    review = {
      project: "Finance policy economics",
      startingCase: $("case").value,
      provenance: $("source-note").value,
      status: $("provenance").textContent,
      base,
      policy,
      assumptions,
      result: r,
      frontier: f,
      comparison,
      method:
        "Finite-horizon pre-tax DCF: initial release less setup, year-end recurring commercial costs, terminal reversal of release. Purchases approximate variable COGS. No additional financing savings counted.",
      limits:
        "Achieved days and commercial responses are supplied assumptions, not estimates. No taxes, growth, fixed costs, seasonality or financing constraints.",
    };
  } catch (e) {
    $("error").textContent = e.message;
    $("error").hidden = false;
    $("results").hidden = true;
    $("export").disabled = true;
    review = null;
  }
  renderSnapshotComparison();
}
$("inputs").addEventListener("input", () => {
  $("provenance").textContent =
    "User-edited assumptions · provenance not independently verified";
  $("export-status").textContent = "";
  render();
});
$("frontier").addEventListener("change", render);
$("comparison-case").addEventListener("change", render);
$("case").addEventListener("change", () => applyCase($("case").value));
$("reset").addEventListener("click", () => applyCase($("case").value));
$("pin-current").addEventListener("click", () => {
  if (!review) return;
  pinned = snapshotPolicy(review);
  $("export-status").textContent = "";
  renderSnapshotComparison();
});
$("clear-pin").addEventListener("click", () => {
  pinned = null;
  $("export-status").textContent = "";
  renderSnapshotComparison();
  $("pin-current").focus();
});
$("export").addEventListener("click", () => {
  if (!review) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(review, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "finance-policy-review.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("export-status").textContent = pinned
    ? "Review exported with both complete scenarios and changed assumptions."
    : "Review exported with exact inputs, timing and frontier.";
});
let resizeFrame;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(render);
});
applyCase("customerDiscount");
