import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  DOMAIN_LABELS,
  flatten,
  filterItems,
  counterpart,
  stats,
  parseState,
  stateSearch,
  brief,
} from "./model.mjs";
const read = async (name) =>
  JSON.parse(
    await readFile(new URL("./data/" + name, import.meta.url), "utf8"),
  );
const manifest = await read("manifest.json");
const domains = await Promise.all(
  manifest.files
    .filter((f) => f.source_path.startsWith("corpus/items/"))
    .map((f) => read(f.file)),
);
const items = flatten(domains);
const report = await read("source_verification.json");
test("every copied artifact matches the pinned commit manifest hash", async () => {
  assert.match(manifest.commit, /^[a-f0-9]{40}$/);
  for (const f of manifest.files) {
    const bytes = await readFile(new URL("./data/" + f.file, import.meta.url));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      f.sha256,
      f.file,
    );
  }
});
test("corpus composition, IDs and verification report agree", () => {
  assert.deepEqual(stats(items), {
    total: 68,
    factual: 63,
    category: 5,
    pairs: 23,
    domains: 8,
  });
  assert.equal(new Set(items.map((i) => i.id)).size, 68);
  assert.equal(report.n_ok, 68);
  for (const i of items) {
    const r = report.results.find((r) => r.item_id === i.id);
    assert.ok(
      r?.ok && r.anchor_present && r.anchor_in_cited_paragraph !== false,
      i.id,
    );
    assert.equal(i.verification.source_edition_date, manifest.edition_date);
  }
});
test("all 23 pairs are reciprocal and contain exactly a and b roles", () => {
  for (const i of items.filter((i) => i.pair_id)) {
    const p = counterpart(items, i);
    assert.ok(p);
    assert.equal(counterpart(items, p).id, i.id);
    assert.notEqual(i.pair_role, p.pair_role);
    assert.equal(items.filter((x) => x.pair_id === i.pair_id).length, 2);
  }
  assert.equal(items.filter((i) => counterpart(items, i)).length, 46);
});
test("filters compose across domains, types, full-text and paired membership", () => {
  assert.equal(filterItems(items, { type: "category_error" }).length, 5);
  assert.equal(filterItems(items, { domain: "confined_space" }).length, 8);
  assert.equal(filterItems(items, { paired: true }).length, 46);
  assert.equal(
    filterItems(items, {
      domain: "confined_space",
      query: "  VENTILATION  reclassify ",
    }).some((i) => i.id === "cs-001"),
    true,
  );
  assert.deepEqual(filterItems(items, { query: "nonexistent_zzzz" }), []);
  assert.equal(
    filterItems(items, { paired: true, type: "category_error" }).length,
    0,
  );
});
test("deep links round-trip filters, case and tab; invalid IDs and enums are normalized", () => {
  const state = {
    id: "cs-002",
    domain: "confined_space",
    query: "ventilation & hazard",
    type: "factual",
    paired: true,
    tab: "pair",
  };
  assert.deepEqual(parseState(stateSearch(state), items), state);
  assert.deepEqual(
    parseState("?item=missing&domain=nope&type=bad&tab=bad&paired=no", items),
    {
      id: "cs-001",
      domain: "all",
      type: "all",
      tab: "evidence",
      query: "",
      paired: false,
    },
  );
});
test("brief carries original reference, counterpart, provenance and non-evaluation caveats", () => {
  const i = items.find((i) => i.id === "cs-001");
  const b = brief(i, items, manifest);
  assert.equal(b.paired_item.id, "cs-002");
  assert.equal(b.item.source.anchor_text, i.source.anchor_text);
  assert.equal(b.provenance.commit, manifest.commit);
  assert.match(b.status, /no model evaluated/);
  assert.match(b.evaluation_design.limitations, /not observed model failures/);
  const single = brief(
    items.find((i) => i.id === "prd-009"),
    items,
    manifest,
  );
  assert.equal(single.paired_item, null);
  assert.equal(single.item.abstention_acceptable, true);
});

test("domain navigation covers every source domain without unrecognized or empty labels", () => {
  assert.deepEqual(
    Object.keys(DOMAIN_LABELS).sort(),
    [...new Set(items.map((i) => i.domain))].sort(),
  );
  for (const id of Object.keys(DOMAIN_LABELS))
    assert.ok(filterItems(items, { domain: id }).length > 0);
});
