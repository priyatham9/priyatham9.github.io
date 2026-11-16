import { test } from "node:test";
import assert from "node:assert/strict";
import { batches } from "../models.mjs";
import { neighborhood, reviewDraft } from "./graph.mjs";
test("every graph connects the five normalized entities without dangling edges", () => {
  for (const b of batches) {
    const graph = neighborhood(b.id);
    assert.equal(graph.nodes.length, 5);
    assert.equal(new Set(graph.nodes.map((n) => n.id)).size, 5);
    assert.equal(graph.edges.length, 4);
    for (const e of graph.edges) {
      assert.ok(graph.nodes.some((n) => n.id === e.from));
      assert.ok(graph.nodes.some((n) => n.id === e.to));
    }
    assert.equal(graph.edges[0].to, b.equipmentId);
    assert.equal(graph.edges[1].to, b.materialLotId);
  }
});
test("review exports selected evidence and deduplicates shared lot results", () => {
  const draft = reviewDraft(
    "B-241",
    "supplier",
    ["B-241", "B-242", "B-244"],
    "Verify samples",
  );
  assert.equal(draft.evidence.length, 3);
  assert.equal(draft.labResults.length, 2);
  assert.equal(draft.labResults.find((l) => l.id === "LAB-119").moisture, null);
  assert.equal(draft.labResults.filter((l) => l.id === "LAB-118").length, 1);
  assert.equal(draft.reviewerNote, "Verify samples");
  assert.equal(draft.limitations.length, 6);
});
test("review respects active scope and requires evidence", () => {
  assert.throws(() => reviewDraft("B-241", "supplier", ["B-245"]), RangeError);
  assert.throws(() => reviewDraft("B-241", "all", []), RangeError);
  assert.equal(
    reviewDraft("B-241", "equipment", ["B-245"]).evidence[0].batchId,
    "B-245",
  );
});
