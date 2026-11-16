import {
  STARTER_CONTRACT,
  CHANGE_PRESETS,
  applyPreset,
  compareContracts,
  reviewBundle,
  sha256,
} from "./contract-model.mjs";
const $ = (id) => document.getElementById(id);
const escape = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const pretty = (x) => JSON.stringify(x, null, 2);
let evaluated = null,
  selected = "metric:north_rate",
  locallyApproved = false,
  epoch = 0;
const value = (r) =>
  !r
    ? "Removed"
    : !r.valid
      ? "Invalid"
      : r.kind === "action"
        ? r.value
          ? "Would trigger"
          : "No trigger"
        : new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(
            r.value,
          );
function setPending() {
  epoch++;
  evaluated = null;
  locallyApproved = false;
  $("results").hidden = true;
  $("error").hidden = true;
  $("evaluation-state").className = "evaluation-state pending";
  $("evaluation-state").textContent =
    "Edits are pending evaluation. Previous results and approval are cleared.";
  $("approve").disabled = true;
  $("export").disabled = true;
  $("preset").value = "custom";
  $("dataset-label").textContent =
    "User-edited contract · provenance not independently verified";
  $("changes").textContent =
    "Evaluate both snapshots to compute their exact difference.";
  $("preset-description").textContent =
    "Custom JSON change. Evaluation reads the current baseline and proposal editors.";
}
function parseEditor(id) {
  const text = $(id).value;
  if (new TextEncoder().encode(text).length > 250000)
    throw new RangeError(
      `${id === "baseline-json" ? "Baseline" : "Proposal"} exceeds the 250 KB limit.`,
    );
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new RangeError(
      `${id === "baseline-json" ? "Baseline" : "Proposal"} JSON: ${e.message}`,
    );
  }
}
function diagnosticsHTML(rows) {
  return rows
    .map(
      (d) =>
        `<div class="diagnostic ${d.critical ? "" : "warning"}"><strong>${escape(d.code)} · ${escape(d.node)}</strong>${escape(d.message)}</div>`,
    )
    .join("");
}
function impactStatus(c) {
  return !c.after
    ? "Removed"
    : !c.after.valid
      ? "Invalid"
      : c.outputChanged
        ? "Changed"
        : c.affected
          ? "Rechecked"
          : "Unaffected";
}
function selectConsumer(key, scope) {
  selected = key;
  renderConsumers();
  renderBasis();
  $(scope)
    .querySelector(`[data-consumer="${key}"]`)
    ?.focus({ preventScroll: true });
}
function renderConsumers() {
  const c = evaluated.comparison;
  $("impact-strip").innerHTML = c.consumers
    .map(
      (r) =>
        `<button type="button" data-consumer="${escape(r.key)}" class="${!r.after?.valid ? "failed" : r.affected ? "recheck" : ""}" aria-label="${escape(r.label)}: ${impactStatus(r)}" aria-pressed="${r.key === selected}" title="${escape(r.label)}: ${impactStatus(r)}"></button>`,
    )
    .join("");
  $("consumers").innerHTML = c.consumers
    .map(
      (r) =>
        `<tr class="${r.key === selected ? "selected" : ""}"><th scope="row"><button type="button" data-consumer="${escape(r.key)}" aria-pressed="${r.key === selected}">${escape(r.label)}<small>${escape(r.key)}</small></button></th><td class="number">${value(r.before)}</td><td class="number">${value(r.after)}</td><td><span class="status ${!r.after?.valid ? "failed" : r.outputChanged ? "changed" : r.affected ? "recheck" : ""}">${impactStatus(r)}</span></td></tr>`,
    )
    .join("");
  for (const button of document.querySelectorAll("[data-consumer]"))
    button.addEventListener("click", () =>
      selectConsumer(
        button.dataset.consumer,
        button.closest("#consumers") ? "consumers" : "impact-strip",
      ),
    );
}
function renderBasis() {
  const c = evaluated.comparison,
    row = c.consumers.find((r) => r.key === selected);
  if (!row) {
    $("basis-name").textContent = "No metric or review rule is declared.";
    $("basis-status").textContent = "";
    $("basis-explanation").textContent =
      "The contract has no consumers to inspect.";
    $("dependency-path").innerHTML = "";
    $("direct-dependencies").innerHTML = "";
    $("consumer-diagnostics").innerHTML = "";
    $("consumer-definition").textContent = "";
    return;
  }
  const allNodes = new Map(
    [...c.baseline.nodes, ...c.proposal.nodes].map((n) => [n.id, n]),
  );
  $("basis-name").textContent = row.label;
  $("basis-status").textContent = impactStatus(row);
  $("basis-explanation").textContent = row.affected
    ? row.outputChanged
      ? "A declared dependency path reaches this consumer, and its value, validity or output signature changes."
      : "A declared dependency path reaches this consumer. Rechecking leaves its value, validity and output signature unchanged."
    : "No path connects a changed node to this consumer in either declared graph. Its evaluated output remains unchanged.";
  $("dependency-path").innerHTML = row.path
    .map((k) => `<li><span>${escape(allNodes.get(k)?.label || k)}</span></li>`)
    .join("");
  const deps = [
    ...new Set(
      c.proposal.edges.filter((e) => e.to === selected).map((e) => e.from),
    ),
  ];
  $("direct-dependencies").innerHTML =
    deps
      .map(
        (k) =>
          `<li>${escape(allNodes.get(k)?.label || k)}<br><small>${escape(k)}</small></li>`,
      )
      .join("") ||
    "<li>No current dependencies; this consumer may have been removed.</li>";
  const issues = c.proposal.diagnostics.filter((d) => d.node === selected);
  $("consumer-diagnostics").innerHTML = issues.length
    ? diagnosticsHTML(issues)
    : '<p class="valid-note">No contract failures on this consumer. This checks declared structure and semantics, not the truth of its inputs.</p>';
  const id = selected.split(":")[1],
    definition =
      (row.kind === "metric"
        ? evaluated.after.metrics
        : evaluated.after.actions
      ).find((x) => x.id === id) || null;
  const unitNames = definition?.operation
    ? [definition.output.unit, ...definition.inputs.map((i) => i.expect.unit)]
    : definition?.expect
      ? [definition.expect.unit]
      : [];
  const unitDefinitions = Object.fromEntries(
    [...new Set(unitNames)].map((name) => [
      name,
      evaluated.after.units[name] ?? null,
    ]),
  );
  const ratioConcept =
    definition?.operation === "rate"
      ? (evaluated.after.ratioConcepts[definition.output.concept] ?? null)
      : null;
  $("consumer-definition").textContent = pretty({
    definition,
    unitDefinitions,
    ratioConcept,
    before: row.before,
    after: row.after,
    dependencyPath: row.path,
  });
}
function renderGate() {
  const c = evaluated.comparison,
    critical = c.proposal.diagnostics.filter((d) => d.critical).length,
    warnings = c.proposal.diagnostics.length - critical;
  $("evaluation-state").className =
    `evaluation-state ${critical ? "blocked" : ""}`;
  $("evaluation-state").textContent = critical
    ? `Blocked: ${critical} critical contract ${critical === 1 ? "failure" : "failures"}. Invalid numbers are not reused downstream.`
    : locallyApproved
      ? "Local review marked approved. No production action has occurred."
      : `Evaluated: ${warnings ? `${warnings} noncritical warnings; ` : ""}ready for local review.`;
  $("review-status").textContent = locallyApproved
    ? "Locally approved review"
    : "Local draft";
  $("gate-summary").textContent = critical
    ? "Approval is blocked. Repair the named contract failures or resolve the source data before reconsidering this proposal."
    : warnings
      ? "Critical checks pass, with noncritical warnings listed below. Review the declared criticality policy and source evidence."
      : "Declared contract checks pass. Review the source correction and changed rule states before approving this local review.";
  $("diagnostics").innerHTML =
    diagnosticsHTML(c.proposal.diagnostics) ||
    '<p class="valid-note">No critical failures or warnings in the proposed contract.</p>';
  $("approve").disabled = !c.approvable || locallyApproved;
  $("approve").textContent = locallyApproved
    ? "Local review approved"
    : "Mark local review approved";
  $("export").disabled = false;
}
async function evaluate() {
  const generation = ++epoch;
  locallyApproved = false;
  $("export-status").textContent = "";
  try {
    const before = parseEditor("baseline-json"),
      after = parseEditor("proposal-json"),
      comparison = compareContracts(before, after);
    evaluated = { before, after, comparison };
    $("error").hidden = true;
    $("results").hidden = false;
    $("provenance").textContent = before.provenance;
    if (!comparison.consumers.some((c) => c.key === selected))
      selected =
        comparison.consumers.find((c) => c.affected)?.key ||
        comparison.consumers[0]?.key ||
        "";
    const bnodes = new Map(comparison.baseline.nodes.map((n) => [n.id, n])),
      anodes = new Map(comparison.proposal.nodes.map((n) => [n.id, n]));
    const short = (v) => (v.length > 180 ? v.slice(0, 177) + "…" : v);
    $("changes").innerHTML =
      comparison.changedNodes
        .map(
          (k) =>
            `<div class="change-item"><strong>${escape(anodes.get(k)?.label || bnodes.get(k)?.label || k)}</strong><code class="before">Before: ${escape(short(bnodes.get(k)?.fingerprint || "not present"))}</code><code class="after">After: ${escape(short(anodes.get(k)?.fingerprint || "not present"))}</code></div>`,
        )
        .join("") ||
      '<p class="note">No computational or descriptive nodes changed.</p>';
    $("node-count").textContent =
      `${comparison.proposal.nodes.length} graph nodes · ${comparison.proposal.edges.length} declared edges`;
    $("impact-sentence").innerHTML =
      `<strong>${comparison.affectedCount} of ${comparison.totalConsumers}</strong> consumers need a recheck.<br><strong>${comparison.changedOutputCount}</strong> change value, validity or signature.`;
    renderConsumers();
    renderBasis();
    renderGate();
    $("baseline-hash").textContent = "Computing…";
    $("proposal-hash").textContent = "Computing…";
    const hashes = await Promise.all([sha256(before), sha256(after)]);
    if (generation === epoch) {
      $("baseline-hash").textContent = hashes[0];
      $("proposal-hash").textContent = hashes[1];
    }
  } catch (e) {
    if (generation !== epoch) return;
    evaluated = null;
    $("error").textContent = e.message;
    $("error").hidden = false;
    $("results").hidden = true;
    $("approve").disabled = true;
    $("export").disabled = true;
    $("evaluation-state").className = "evaluation-state blocked";
    $("evaluation-state").textContent =
      "The snapshots could not be evaluated. Correct the JSON or contract structure.";
  }
}
function loadStarter(id) {
  $("baseline-json").value = pretty(STARTER_CONTRACT);
  $("proposal-json").value = pretty(id ? applyPreset(id) : STARTER_CONTRACT);
  $("review-note").value = "";
  $("preset").value = id || "custom";
  $("dataset-label").textContent =
    "Constructed fixture · illustrative review thresholds";
  $("preset-description").textContent = id
    ? CHANGE_PRESETS.find((p) => p.id === id).description
    : "Unchanged starter contract. Edit or import a proposal to evaluate a change.";
  selected = "metric:north_rate";
  evaluate();
}
$("preset").innerHTML =
  CHANGE_PRESETS.map(
    (p) => `<option value="${p.id}">${escape(p.label)}</option>`,
  ).join("") + '<option value="custom">Custom / unchanged JSON</option>';
$("preset").addEventListener("change", () => {
  if ($("preset").value !== "custom") loadStarter($("preset").value);
});
$("reset").addEventListener("click", () => loadStarter(null));
$("evaluate").addEventListener("click", evaluate);
for (const id of ["baseline-json", "proposal-json"])
  $(id).addEventListener("input", setPending);
$("open-editors").addEventListener("click", () => {
  $("editors").open = true;
  $("proposal-json").focus();
  $("editors").scrollIntoView({ behavior: "instant", block: "start" });
});
for (const [input, target] of [
  ["baseline-file", "baseline-json"],
  ["proposal-file", "proposal-json"],
])
  $(input).addEventListener("change", async () => {
    const file = $(input).files[0];
    if (!file) return;
    try {
      if (file.size > 250000)
        throw new RangeError("File exceeds the 250 KB limit.");
      const text = await file.text();
      $(target).value = text;
      if (target === "baseline-json") $("proposal-json").value = text;
      setPending();
      await evaluate();
      $("preset-description").textContent =
        `Imported ${file.name}. Contents are local user-supplied data; provenance is not independently verified.`;
    } catch (e) {
      $("error").textContent = e.message;
      $("error").hidden = false;
    } finally {
      $(input).value = "";
    }
  });
$("review-note").addEventListener("input", () => {
  locallyApproved = false;
  if (evaluated) renderGate();
});
$("approve").addEventListener("click", () => {
  if (!evaluated?.comparison.approvable) return;
  locallyApproved = true;
  renderGate();
});
$("export").addEventListener("click", async () => {
  if (!evaluated) return;
  const current = evaluated;
  $("export").disabled = true;
  try {
    const bundle = await reviewBundle(current.before, current.after, {
      note: $("review-note").value,
      locallyApproved,
    });
    const url = URL.createObjectURL(
      new Blob([pretty(bundle)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "data-contract-review.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("export-status").textContent =
      `Review exported. Bundle SHA-256: ${bundle.bundleSha256}`;
  } catch (e) {
    $("export-status").textContent = e.message;
  } finally {
    if (evaluated === current) $("export").disabled = false;
  }
});
loadStarter("hours-correction");
