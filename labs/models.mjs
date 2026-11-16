export const cohorts = {
  all: [240, 168, 96, 48, 24],
  inbound: [140, 112, 70, 35, 21],
  outbound: [100, 56, 26, 13, 3],
};
export function pipeline(key = "all", rate = 0.5) {
  if (!Object.hasOwn(cohorts, key)) throw new RangeError("Unknown cohort");
  if (!Number.isFinite(rate) || rate < 0 || rate > 1)
    throw new RangeError("Closing rate must be between zero and one");
  const s = cohorts[key];
  return {
    stages: s,
    winRate: s[4] / s[0],
    lost: s[0] - s[4],
    forecast: s[3] * rate,
    increment: s[3] * rate - s[4],
  };
}
export function cash({
  revenue = 12000000,
  cogs = 7200000,
  dso = 45,
  dio = 60,
  dpo = 30,
} = {}) {
  if (
    ![revenue, cogs, dso, dio, dpo].every(
      (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
    )
  )
    throw new RangeError("Financial inputs must be finite nonnegative numbers");
  const ar = (revenue / 365) * dso,
    inventory = (cogs / 365) * dio,
    ap = (cogs / 365) * dpo;
  return { ar, inventory, ap, nwc: ar + inventory - ap, ccc: dso + dio - dpo };
}
// Synthetic ontology: properties live on the entity that owns them.
export const suppliers = {
  northstar: { id: "northstar", name: "Northstar" },
  cedar: { id: "cedar", name: "Cedar" },
};
export const equipment = {
  m04: { id: "m04", name: "Mixer M-04", line: "Line 01" },
  m07: { id: "m07", name: "Mixer M-07", line: "Line 02" },
};
export const labResults = {
  "LAB-118": {
    id: "LAB-118",
    status: "final",
    moisture: 8.4,
    source: "Synthetic receiving-lot laboratory sample NS-118",
  },
  "LAB-067": {
    id: "LAB-067",
    status: "final",
    moisture: 5.1,
    source: "Synthetic receiving-lot laboratory sample CD-067",
  },
  "LAB-119": {
    id: "LAB-119",
    status: "pending",
    moisture: null,
    source: "Synthetic receiving-lot laboratory sample NS-119",
  },
  "LAB-068": {
    id: "LAB-068",
    status: "final",
    moisture: 5.3,
    source: "Synthetic receiving-lot laboratory sample CD-068",
  },
};
export const materialLots = {
  "NS-118": { id: "NS-118", supplierId: "northstar", labResultId: "LAB-118" },
  "CD-067": { id: "CD-067", supplierId: "cedar", labResultId: "LAB-067" },
  "NS-119": { id: "NS-119", supplierId: "northstar", labResultId: "LAB-119" },
  "CD-068": { id: "CD-068", supplierId: "cedar", labResultId: "LAB-068" },
};
export const batches = [
  { id: "B-241", equipmentId: "m04", materialLotId: "NS-118", yield: 91.2 },
  { id: "B-242", equipmentId: "m04", materialLotId: "NS-118", yield: 89.7 },
  { id: "B-243", equipmentId: "m07", materialLotId: "CD-067", yield: 97.4 },
  { id: "B-244", equipmentId: "m07", materialLotId: "NS-119", yield: 95.8 },
  { id: "B-245", equipmentId: "m04", materialLotId: "CD-068", yield: 96.9 },
];
export function resolveBatch(id) {
  const batch = batches.find((b) => b.id === id);
  if (!batch) throw new RangeError("Unknown batch");
  const lot = materialLots[batch.materialLotId];
  return {
    ...batch,
    equipment: equipment[batch.equipmentId],
    lot,
    supplier: suppliers[lot.supplierId],
    lab: labResults[lot.labResultId],
  };
}
export function linkedBatches(id, scope = "all") {
  if (!["all", "equipment", "supplier"].includes(scope))
    throw new RangeError("Unknown scope");
  const selected = resolveBatch(id);
  return batches
    .map((b) => resolveBatch(b.id))
    .filter((b) =>
      scope === "equipment"
        ? b.equipmentId === selected.equipmentId
        : scope === "supplier"
          ? b.lot.supplierId === selected.lot.supplierId
          : b.equipmentId === selected.equipmentId ||
            b.lot.supplierId === selected.lot.supplierId,
    );
}
