import { batches, resolveBatch, linkedBatches } from "../models.mjs";
import { neighborhood, reviewDraft } from "./graph.mjs";
const $ = (s) => document.querySelector(s);
let selectedEvidence = new Set(),
  activeEntity,
  currentGraph,
  draft;
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
$("#batch").innerHTML = batches.map((b) => `<option>${b.id}</option>`).join("");
function invalidateDraft() {
  draft = null;
  $("#export").disabled = true;
  $("#simulate").disabled = selectedEvidence.size === 0;
  $("#simulate").textContent = "Prepare review draft";
  $("#draft-preview").hidden = true;
  $("#action").textContent = selectedEvidence.size
    ? "Local draft only. No review is sent or saved to a system."
    : "Select at least one evidence record to prepare a review.";
  $("#selection-count").textContent =
    `${selectedEvidence.size} selected for review`;
}
function inspect(id) {
  activeEntity = id;
  const node = currentGraph.nodes.find((n) => n.id === id);
  $("#entity-select").value = id;
  document
    .querySelectorAll(".graph-node")
    .forEach((n) =>
      n.setAttribute("aria-pressed", String(n.dataset.entity === id)),
    );
  const edges = currentGraph.edges.filter((e) => e.from === id || e.to === id);
  $("#inspector").innerHTML =
    `<span class="object-type">${node.type}</span><h3 class="object-name">${node.label}</h3><dl>${node.fields.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl><div class="source-block"><span class="section-index">EVIDENCE SOURCE</span><p>${node.source}</p></div><div class="relationships"><span class="section-index">RELATIONSHIPS</span>${edges
      .map((e) => {
        const other = currentGraph.nodes.find(
          (n) => n.id === (e.from === id ? e.to : e.from),
        );
        return `<button class="relationship-link" data-inspect="${other.id}">${e.from === id ? e.label : `← ${e.label}`} <strong>${other.label}</strong><span aria-hidden="true"><svg class="arrow-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8"/></svg></span></button>`;
      })
      .join("")}</div>`;
}
function renderGraph(b) {
  currentGraph = neighborhood(b.id);
  $("#graph").innerHTML =
    `<svg viewBox="0 0 800 320" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto"><path d="M0 0L5 3L0 6" fill="none" stroke="#9fb3bd"/></marker></defs>${currentGraph.edges
      .map((e) => {
        const a = currentGraph.nodes.find((n) => n.id === e.from),
          z = currentGraph.nodes.find((n) => n.id === e.to);
        return `<path d="M ${a.x * 8} ${a.y * 3.2} C ${(a.x + z.x) * 4} ${a.y * 3.2}, ${(a.x + z.x) * 4} ${z.y * 3.2}, ${z.x * 8} ${z.y * 3.2}" marker-end="url(#arrow)"/><text x="${(a.x + z.x) * 4}" y="${(a.y + z.y) * 1.6 - 9}" text-anchor="middle">${e.label}</text>`;
      })
      .join(
        "",
      )}</svg>${currentGraph.nodes.map((n, i) => `<button class="graph-node ${i === 0 ? "batch-node" : ""}" data-entity="${n.id}" style="--x:${n.x}%;--y:${n.y}%" aria-pressed="false"><span class="node-type"><i>${["B", "E", "M", "S", "L"][i]}</i>${n.type}</span><strong>${n.label}</strong><span class="node-detail">${n.detail}</span></button>`).join("")}`;
  $("#entity-select").innerHTML = currentGraph.nodes
    .map((n) => `<option value="${n.id}">${n.type}: ${n.label}</option>`)
    .join("");
  $("#mobile-relationships").innerHTML = currentGraph.edges
    .map((edge) => {
      const from = currentGraph.nodes.find((node) => node.id === edge.from),
        to = currentGraph.nodes.find((node) => node.id === edge.to);
      return `<span><strong>${from.label}</strong> ${edge.label} <strong>${to.label}</strong></span>`;
    })
    .join("");
  inspect(b.id);
}
function renderPlot(b, related) {
  const compact = window.matchMedia("(max-width: 760px)").matches;
  const width = compact ? 360 : 740,
    left = compact ? 38 : 62;
  const plotWidth = compact ? 202 : 485,
    pendingX = compact ? 310 : 663;
  const laneWidth = compact ? 72 : 112,
    right = pendingX + laneWidth / 2;
  const x = (value) => left + ((value - 4) / 6) * plotWidth;
  const y = (value) => 242 - ((value - 88) / 12) * 206;
  $("#plot-count").textContent = `${related.length} scoped batches`;
  $("#plot").innerHTML =
    `<svg class="yield-plot" viewBox="0 0 ${width} 300" role="group" aria-labelledby="chart-title chart-desc">
  <title id="chart-title">Accepted yield versus lot moisture for the current evidence scope</title>
  <desc id="chart-desc">${related.map((r) => `${r.id}: yield ${r.yield} percent; ${r.lab.status === "final" ? `lot moisture ${r.lab.moisture} percent from ${r.lab.id}` : "moisture pending, shown in separate lane"}`).join(". ")}. A text equivalent and batch controls are in the evidence table below.</desc>
  <rect x="${x(6)}" y="${y(95)}" width="${x(10) - x(6)}" height="${y(88) - y(95)}" fill="#fbf0df"/>
  <rect x="${pendingX - laneWidth / 2}" y="28" width="${laneWidth}" height="214" rx="5" fill="#f1f4f3"/>
  ${[88, 92, 95, 100].map((v) => `<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 95 ? "#9d803d" : "#e2e7e3"}" ${v === 95 ? 'stroke-dasharray="5 5"' : ""}/><text x="${left - 10}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`).join("")}
  ${[4, 6, 8, 10].map((v) => `<text x="${x(v)}" y="261" text-anchor="middle">${v}%</text>`).join("")}
  <line x1="${x(6)}" x2="${x(6)}" y1="28" y2="242" stroke="#9d803d" stroke-dasharray="5 5"/>
  <text x="${left}" y="16" class="axis-label">ACCEPTED YIELD</text>
  <text x="${left + plotWidth / 2}" y="289" text-anchor="middle" class="axis-label">LOT MOISTURE →</text>
  <text x="${pendingX}" y="261" text-anchor="middle">Pending lab</text>
  <text x="${pendingX}" y="280" text-anchor="middle" class="chart-small">No value</text>
  <text x="${x(6) + 8}" y="41" class="chart-small">6% screen</text>
  <text x="${left + 8}" y="${y(95) - 8}" class="chart-small">95% target</text>
  ${related
    .map((r) => {
      const pending = r.lab.status !== "final",
        px = pending ? pendingX : x(r.lab.moisture),
        py = y(r.yield),
        selected = r.id === b.id;
      return `<g class="plot-record" data-batch="${r.id}" tabindex="0" role="button" aria-label="Investigate ${r.id}: ${r.yield}% yield, ${pending ? "moisture pending" : r.lab.moisture + "% lot moisture"}"><title>${r.id} · ${r.lab.id} · ${r.lab.status}</title>
    <circle cx="${px}" cy="${py}" r="18" fill="transparent"/>
    ${selected ? `<circle cx="${px}" cy="${py}" r="12" fill="none" stroke="#136c50" opacity=".35"/>` : ""}
    <circle cx="${px}" cy="${py}" r="6" fill="${selected ? "#136c50" : "#397da1"}" stroke="white" stroke-width="2"/>
    <text x="${compact && pending ? px : px + 14}" y="${compact && pending ? py - 15 : py + 4}" text-anchor="${compact && pending ? "middle" : "start"}" class="point-label">${r.id}</text></g>`;
    })
    .join("")}</svg>`;
  const shared = related.filter((r) => r.lab.id === "LAB-118").length > 1;
  $("#plot-caption").textContent =
    `${shared ? "B-241 and B-242 share LAB-118: one moisture sample, two batch outcomes. " : "Each point pairs batch yield with its lot-level result. "}Shaded area: below-target yield and above-screen moisture. This is a descriptive view, not a causal estimate.`;
}
function showView(view, focus = false) {
  document.querySelectorAll("[data-view]").forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  $("#comparison-view").hidden = view !== "comparison";
  $("#objects-view").hidden = view !== "objects";
}

function render() {
  const b = resolveBatch($("#batch").value),
    scope = $("#scope").value,
    related = linkedBatches(b.id, scope);
  selectedEvidence = new Set(related.map((r) => r.id));
  const final = b.lab.status === "final",
    low = b.yield < 95,
    high = final && b.lab.moisture > 6;
  $("#metrics").innerHTML = [
    ["INVESTIGATING", b.id, `${b.equipment.name} · ${b.equipment.line}`, ""],
    [
      "ACCEPTED YIELD",
      `${b.yield}<em>%</em>`,
      `${(b.yield - 95).toFixed(1)} pp vs. 95% target`,
      low ? "exception" : "",
    ],
    [
      "LOT MOISTURE",
      final ? `${b.lab.moisture}<em>%</em>` : "Pending",
      final ? `${b.lab.id} · screen ≤6%` : `${b.lab.id} · no numeric value`,
      high || !final ? "exception" : "",
    ],
    [
      "EVIDENCE IN SCOPE",
      `${related.length}<em> / 5</em>`,
      `${new Set(related.map((r) => r.lab.id)).size} distinct lot results`,
      "",
    ],
  ]
    .map(
      ([label, v, d, c]) =>
        `<div class="metric ${c}"><small>${label}</small><strong>${v}</strong><span>${d}</span></div>`,
    )
    .join("");
  renderGraph(b);
  renderPlot(b, related);
  $("#rows").innerHTML = related
    .map(
      (r) =>
        `<tr class="${r.id === b.id ? "selected-row" : ""}"><td><input type="checkbox" data-evidence="${r.id}" aria-label="Include ${r.id} in review" checked /></td><td><button class="table-batch" data-batch="${r.id}">${r.id}<span aria-hidden="true"><svg class="arrow-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8"/></svg></span></button>${r.id === b.id ? '<span class="current-label">Investigating</span>' : ""}</td><td>${r.equipment.name}</td><td><span class="entity-text">${r.lot.id}</span><small>${r.supplier.name}</small></td><td><strong class="${r.yield < 95 ? "warning" : ""}">${r.yield}%</strong><small>${r.yield < 95 ? "Below target" : "Meets target"}</small></td><td>${r.lab.status === "final" ? `<strong>${r.lab.moisture}%</strong>` : '<span class="pending-pill">Pending</span>'}<small>${r.lab.status === "final" ? "Lot-level sample" : "No numeric value"}</small></td><td><span class="entity-text">${r.lab.id}</span><small>${r.lab.status === "final" ? "Final laboratory result" : "Awaiting laboratory result"}</small></td></tr>`,
    )
    .join("");
  $("#scope-note").textContent =
    `Showing ${related.length} batches sharing ${scope === "all" ? "equipment or supplier" : scope} with ${b.id}. Shared lot measurements reference the same result, not independent samples.`;
  const comparator = low
    ? linkedBatches(b.id, "equipment").find(
        (r) => r.yield >= 95 && r.lot.supplierId !== b.lot.supplierId,
      )
    : null;
  let evidence = !final
    ? `<div class="finding"><span class="finding-label">OBSERVED / INCOMPLETE</span><p>Yield is <strong>${b.yield}%</strong>; ${b.lab.id} is pending. There is no finalized moisture value.</p></div><p><strong>Hypothesis withheld.</strong> A moisture explanation cannot be assessed until the laboratory result is final.</p>`
    : low && high
      ? `<div class="finding"><span class="finding-label">OBSERVED / EXCEPTION</span><p><strong>${b.id}</strong> is below the yield target. Its lot ${b.lot.id} is above the moisture screen at <strong>${b.lab.moisture}%</strong> (${b.lab.id}).</p></div><p><strong>Working hypothesis.</strong> Material condition may contribute. These records establish coincidence, not a cause. B-241 and B-242 share one lot measurement.</p>`
      : `<div class="finding"><span class="finding-label">OBSERVED</span><p>Yield <strong>${low ? "falls below" : "meets"}</strong> the illustrative target; finalized lot moisture <strong>${high ? "exceeds" : "meets"}</strong> the screen (${b.lab.id}).</p></div><p><strong>Interpretation.</strong> This record alone does not establish which process or material conditions affected yield.</p>`;
  $("#comparator").hidden = true;
  if (comparator) {
    const visible = related.some((r) => r.id === comparator.id);
    evidence += `<div class="comparison"><span class="finding-label">EQUIPMENT COMPARATOR</span><p><strong>${comparator.id} · ${comparator.yield}% yield</strong><br />Same ${comparator.equipment.name}, different supplier lot. ${visible ? "Visible in the current scope." : "Outside the current supplier scope."}</p><p>A single passing run does not rule out equipment effects or other differences.</p></div>`;
    $("#comparator").hidden = visible;
  }
  $("#evidence").innerHTML =
    evidence +
    '<p class="note">Verify run settings, composition, measurement variation and sampling comparability before isolating a cause.</p>';
  invalidateDraft();
}
function chooseBatch(id) {
  if ($("#batch").value === id) return;
  $("#batch").value = id;
  render();
}
document.querySelectorAll("[data-view]").forEach((tab) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
  tab.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      showView(
        e.key === "Home"
          ? "comparison"
          : e.key === "End"
            ? "objects"
            : tab.dataset.view === "comparison"
              ? "objects"
              : "comparison",
        true,
      );
    }
  });
});
$("#inspect-linked").addEventListener("click", () => {
  showView("objects");
  document.querySelector('.graph-node[aria-pressed="true"]').focus();
});
window
  .matchMedia("(max-width: 760px)")
  .addEventListener("change", () =>
    renderPlot(
      resolveBatch($("#batch").value),
      linkedBatches($("#batch").value, $("#scope").value),
    ),
  );
$("#batch").addEventListener("change", render);
$("#scope").addEventListener("change", render);
$("#entity-select").addEventListener("change", (e) => inspect(e.target.value));
$("#graph").addEventListener("click", (e) => {
  const n = e.target.closest("[data-entity]");
  if (n) inspect(n.dataset.entity);
});
$("#inspector").addEventListener("click", (e) => {
  const n = e.target.closest("[data-inspect]");
  if (n) {
    inspect(n.dataset.inspect);
    $("#entity-select").focus();
  }
});
$("#rows").addEventListener("click", (e) => {
  const n = e.target.closest("[data-batch]");
  if (n) chooseBatch(n.dataset.batch);
});
$("#rows").addEventListener("change", (e) => {
  if (e.target.dataset.evidence) {
    e.target.checked
      ? selectedEvidence.add(e.target.dataset.evidence)
      : selectedEvidence.delete(e.target.dataset.evidence);
    invalidateDraft();
  }
});
$("#plot").addEventListener("click", (e) => {
  const n = e.target.closest("[data-batch]");
  if (n) chooseBatch(n.dataset.batch);
});
$("#plot").addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.dataset.batch) {
    e.preventDefault();
    chooseBatch(e.target.dataset.batch);
    $("#batch").focus();
  }
});
$("#comparator").addEventListener("click", () => {
  $("#scope").value = "equipment";
  render();
  $("#scope").focus();
});
$("#reset").addEventListener("click", () => {
  $("#batch").value = "B-241";
  $("#scope").value = "all";
  $("#review-note").value = "";
  render();
});
$("#review-note").addEventListener("input", invalidateDraft);
$("#simulate").addEventListener("click", () => {
  draft = reviewDraft(
    $("#batch").value,
    $("#scope").value,
    [...selectedEvidence],
    $("#review-note").value,
  );
  $("#export").disabled = false;
  $("#simulate").textContent = "Refresh review draft";
  $("#action").textContent =
    `Draft prepared for ${draft.selectedBatch}: ${draft.evidence.length} batch records, ${draft.labResults.length} distinct laboratory results. No review was sent.`;
  $("#draft-preview").hidden = false;
  $("#draft-preview").innerHTML =
    `<strong>${draft.title}</strong><p>${draft.evidence.map((r) => r.batchId).join(" · ")}</p>${draft.reviewerNote ? `<p>${escape(draft.reviewerNote)}</p>` : ""}<ul>${draft.requestedChecks.map((s) => `<li>${s}</li>`).join("")}</ul><p class="note">Export includes source IDs, deduplicated laboratory results, pending values as null, and all six interpretation limitations.</p>`;
});
$("#export").addEventListener("click", () => {
  if (!draft) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `quality-review-${draft.selectedBatch}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("#action").textContent =
    "Review JSON exported locally. No system record was changed.";
});
render();
