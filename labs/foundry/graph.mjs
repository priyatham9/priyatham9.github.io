import { resolveBatch, linkedBatches } from "../models.mjs";
export function neighborhood(batchId) {
  const b = resolveBatch(batchId);
  const nodes = [
    {
      id: b.id,
      type: "Batch",
      label: b.id,
      detail: `${b.yield}% accepted yield`,
      source: "Synthetic production ledger",
      fields: [
        ["Accepted yield", `${b.yield}%`],
        ["Target deviation", `${(b.yield - 95).toFixed(1)} pp`],
        ["Measurement", "Accepted output ÷ input mass"],
        ["Freshness", "Final at batch close"],
      ],
      x: 20,
      y: 50,
    },
    {
      id: b.equipment.id,
      type: "Equipment",
      label: b.equipment.name,
      detail: b.equipment.line,
      source: "Synthetic run assignment log",
      fields: [
        ["Equipment ID", b.equipment.id],
        ["Assigned line", b.equipment.line],
        ["Freshness", "Snapshot 08:00 UTC"],
      ],
      x: 51,
      y: 20,
    },
    {
      id: b.lot.id,
      type: "Material lot",
      label: b.lot.id,
      detail: "Receiving lot",
      source: "Synthetic receiving ledger",
      fields: [
        ["Supplier ID", b.supplier.id],
        ["Lab result ID", b.lab.id],
        [
          "Consumed by",
          linkedBatches(b.id)
            .filter((r) => r.lot.id === b.lot.id)
            .map((r) => r.id)
            .join(", "),
        ],
      ],
      x: 51,
      y: 74,
    },
    {
      id: b.supplier.id,
      type: "Supplier",
      label: b.supplier.name,
      detail: b.supplier.id,
      source: "Synthetic supplier register",
      fields: [
        ["Supplier ID", b.supplier.id],
        ["Relationship", `Supplies ${b.lot.id}`],
      ],
      x: 83,
      y: 39,
    },
    {
      id: b.lab.id,
      type: "Lab result",
      label: b.lab.id,
      detail:
        b.lab.status === "final"
          ? `${b.lab.moisture}% moisture · final`
          : "Pending · no measurement",
      source: b.lab.source,
      fields: [
        ["Applies to lot", b.lot.id],
        ["Status", b.lab.status],
        [
          "Moisture",
          b.lab.status === "final" ? `${b.lab.moisture}%` : "No numeric value",
        ],
        ["Unit of evidence", "One lot-level sample"],
      ],
      x: 83,
      y: 87,
    },
  ];
  return {
    nodes,
    edges: [
      { from: b.id, to: b.equipment.id, label: "runs on" },
      { from: b.id, to: b.lot.id, label: "consumes" },
      { from: b.lot.id, to: b.supplier.id, label: "supplied by" },
      { from: b.lot.id, to: b.lab.id, label: "tested by" },
    ],
  };
}
export const limitations = [
  "Five synthetic batches cannot establish causality or statistical significance.",
  "Shared lot results are not independent moisture observations.",
  "Scope is not a complete production history.",
  "Run settings, material composition, measurement variation and sampling comparability require verification.",
  "Pending laboratory results contain no numeric moisture value.",
  "Yield and moisture thresholds are illustrative, not validated process specifications.",
];
export function reviewDraft(batchId, scope, ids, note = "") {
  const visible = linkedBatches(batchId, scope);
  if (!ids.length || ids.some((id) => !visible.some((b) => b.id === id)))
    throw new RangeError("Select evidence within the current scope");
  const records = visible.filter((b) => ids.includes(b.id));
  return {
    title: `Quality review: ${batchId}`,
    status: "Local draft — not submitted",
    demonstration:
      "Independent synthetic prototype; no Palantir integration or employer data",
    selectedBatch: batchId,
    scope,
    reviewerNote: note,
    sourceLineage: {
      yield: "Synthetic production ledger: accepted output / input mass; final at batch close",
      equipment: "Synthetic run assignment log: batch_id -> equipment_id; snapshot 08:00 UTC",
      material: "Synthetic receiving ledger: batch_id -> material_lot_id -> supplier_id",
      moisture: "Synthetic laboratory sample: material_lot_id -> lab_result_id; one measurement per lot",
    },
    evidence: records.map((b) => ({
      batchId: b.id,
      yield: b.yield,
      equipmentId: b.equipment.id,
      lotId: b.lot.id,
      supplierId: b.supplier.id,
      labResultId: b.lab.id,
    })),
    labResults: [
      ...new Map(
        records.map((b) => [b.lab.id, { ...b.lab, lotId: b.lot.id }]),
      ).values(),
    ],
    requestedChecks: [
      "Verify laboratory status and lot sampling",
      "Compare run settings and material composition",
      "Request quality-owner assessment before isolating a cause",
    ],
    limitations,
  };
}
