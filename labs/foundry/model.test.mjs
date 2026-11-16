import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batches,
  equipment,
  suppliers,
  materialLots,
  labResults,
  resolveBatch,
  linkedBatches,
} from "../models.mjs";
test("normalized ontology has unique keys and referential integrity", () => {
  assert.equal(new Set(batches.map((b) => b.id)).size, batches.length);
  for (const collection of [equipment, suppliers, materialLots, labResults])
    for (const [key, value] of Object.entries(collection))
      assert.equal(value.id, key);
  for (const b of batches) {
    assert.ok(equipment[b.equipmentId]);
    assert.ok(materialLots[b.materialLotId]);
    assert.ok(!Object.hasOwn(b, "moisture"));
  }
  for (const lot of Object.values(materialLots)) {
    assert.ok(suppliers[lot.supplierId]);
    assert.ok(labResults[lot.labResultId]);
  }
});
test("shared lots resolve the same measurement while retaining batch outcomes", () => {
  const a = resolveBatch("B-241"),
    b = resolveBatch("B-242");
  assert.equal(a.lot, b.lot);
  assert.equal(a.lab, b.lab);
  assert.equal(a.lab.moisture, 8.4);
  assert.notEqual(a.yield, b.yield);
  for (const result of Object.values(labResults))
    if (result.status === "pending") assert.equal(result.moisture, null);
    else assert.ok(Number.isFinite(result.moisture));
  assert.equal(resolveBatch("B-244").lab.status, "pending");
});
test("evidence scope reveals comparator only when equipment is included", () => {
  assert.deepEqual(
    linkedBatches("B-241", "supplier").map((b) => b.id),
    ["B-241", "B-242", "B-244"],
  );
  assert.deepEqual(
    linkedBatches("B-241", "equipment").map((b) => b.id),
    ["B-241", "B-242", "B-245"],
  );
  assert.deepEqual(
    linkedBatches("B-241", "all").map((b) => b.id),
    ["B-241", "B-242", "B-244", "B-245"],
  );
  assert.throws(() => resolveBatch("unknown"), RangeError);
  assert.throws(() => linkedBatches("B-241", "unknown"), RangeError);
});
