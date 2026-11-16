import { batches, resolveBatch, linkedBatches } from "../models.mjs";
const $ = (s) => document.querySelector(s);
$("#batch").innerHTML = batches.map((b) => `<option>${b.id}</option>`).join("");
function render() {
  const b = resolveBatch($("#batch").value),
    scope = $("#scope").value,
    related = linkedBatches(b.id, scope);
  const final = b.lab.status === "final",
    low = b.yield < 95,
    high = final && b.lab.moisture > 6;
  $("#metrics").innerHTML = [
    ["Selected batch", b.id, b.equipment.line],
    [
      "Accepted yield",
      b.yield + "%",
      `${(b.yield - 95).toFixed(1)} pp versus target`,
    ],
    [
      "Lot moisture",
      final ? b.lab.moisture + "%" : "Pending",
      final
        ? `${b.lab.id} · screening limit ≤6%`
        : `${b.lab.id} · no finalized measurement`,
    ],
    [
      "Linked records",
      related.length,
      `Scope: ${scope === "all" ? "equipment or supplier" : scope}`,
    ],
  ]
    .map(
      ([a, v, d]) =>
        `<div class="metric"><small>${a}</small><strong>${v}</strong><span>${d}</span></div>`,
    )
    .join("");
  $("#nodes").innerHTML = [
    ["BATCH", b.id, `runs on → ${b.equipment.name}`],
    ["EQUIPMENT", b.equipment.name, `assigned to → ${b.equipment.line}`],
    ["MATERIAL LOT", b.lot.id, `supplied by → ${b.supplier.name}`],
    ["LAB RESULT", b.lab.id, `${b.lab.status} · applies to lot ${b.lot.id}`],
  ]
    .map(
      ([type, v, d], i) =>
        `<div class="node ${i === 0 ? "selected" : ""}"><small>${type}</small><b>${v}</b><span>${d}</span></div>`,
    )
    .join("");
  $("#rows").innerHTML = related
    .map(
      (r) =>
        `<tr${r.id === b.id ? ' style="background:#e8eee4"' : ""}><td>${r.id}${r.id === b.id ? " •" : ""}</td><td>${r.equipment.name}</td><td>${r.lot.id}</td><td class="${r.yield < 95 ? "warning" : ""}">${r.yield}%</td><td>${r.lab.status === "final" ? `${r.lab.moisture}% · ${r.lab.id}` : `Pending · ${r.lab.id}`}</td></tr>`,
    )
    .join("");
  $("#scope-note").textContent =
    `Showing ${related.length} batches sharing ${scope === "all" ? "equipment or supplier" : scope} with ${b.id}. Shared lot measurements are the same result, not independent samples.`;
  const comparator = low
    ? linkedBatches(b.id, "equipment").find(
        (r) => r.yield >= 95 && r.lot.supplierId !== b.lot.supplierId,
      )
    : null;
  let evidence = !final
    ? `<p><strong>Observed:</strong> yield is ${b.yield}%; ${b.lab.id} is pending. There is no finalized moisture value.</p><p><strong>Hypothesis withheld:</strong> a moisture explanation cannot be assessed until the laboratory result is final.</p>`
    : low && high
      ? `<p><strong>Observed:</strong> ${b.id} has below-target yield and its consumed lot ${b.lot.id} has moisture above the illustrative screen (${b.lab.moisture}%, ${b.lab.id}). B-241 and B-242 share this one lot measurement; they are not two independent moisture observations.</p><p><strong>Hypothesis:</strong> material condition may contribute to the yield exception. These records establish coincidence, not a cause.</p>`
      : `<p><strong>Observed:</strong> yield ${low ? "falls below" : "meets"} the illustrative target; finalized lot moisture ${high ? "exceeds" : "meets"} the screening threshold (${b.lab.id}).</p><p><strong>Interpretation:</strong> this record alone does not establish which process or material conditions affected yield.</p>`;
  if (comparator) {
    const visible = related.some((r) => r.id === comparator.id);
    evidence += `<p><strong>Comparison from the full synthetic dataset:</strong> ${comparator.id} uses ${comparator.equipment.name} with a different supplier lot and has ${comparator.yield}% yield. ${visible ? "It is visible in the current table." : "It is outside the current supplier scope; switch scope to inspect it."} A single passing run does not rule out equipment effects or other differences.</p>`;
    $("#comparator").hidden = visible;
  } else $("#comparator").hidden = true;
  $("#evidence").innerHTML =
    evidence +
    '<p class="note">Verify run settings, material composition, measurement variation, and sampling comparability before isolating a cause. This is not a complete production history.</p>';
  $("#source-result").textContent =
    `${b.lab.id} → ${b.lot.id} · ${b.lab.source} · ${final ? "Final: " + b.lab.moisture + "% moisture" : "Pending: no numeric result available"}`;
  $("#action").textContent =
    "A review is simulated locally; no system record is changed.";
  $("#simulate").textContent = "Simulate quality review";
  $("#simulate").disabled = false;
}
$("#batch").addEventListener("change", render);
$("#scope").addEventListener("change", render);
$("#comparator").addEventListener("click", () => {
  $("#scope").value = "equipment";
  render();
});
$("#reset").addEventListener("click", () => {
  $("#batch").value = "B-241";
  $("#scope").value = "all";
  render();
});
$("#simulate").addEventListener("click", () => {
  $("#action").textContent =
    `Draft review prepared for ${$("#batch").value}: verify laboratory result, compare run settings, and request quality-owner assessment. Simulation only; no review was sent or saved.`;
  $("#simulate").textContent = "Review draft prepared";
  $("#simulate").disabled = true;
});
render();
