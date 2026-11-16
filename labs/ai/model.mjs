export const DOMAIN_LABELS = {
  confined_space: "Confined space",
  pressure_relief_devices: "Pressure relief",
  lockout_tagout: "Lockout / tagout",
  process_safety_management: "Process safety",
  injury_recordkeeping: "Recordkeeping",
  respiratory_protection_and_noise: "Respiratory & noise",
  machine_electrical_fire: "Machine & electrical",
  hazard_communication: "Hazard communication",
};
export function flatten(domains) {
  return domains.flatMap((d) =>
    d.items.map((i) => ({
      ...i,
      domain: d.domain,
      domain_title: d.domain_title,
    })),
  );
}
export function filterItems(
  items,
  { query = "", domain = "all", type = "all", paired = false } = {},
) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(
    (i) =>
      (domain === "all" || i.domain === domain) &&
      (type === "all" || i.item_type === type) &&
      (!paired || i.pair_id) &&
      words.every((w) =>
        [
          i.id,
          i.question,
          i.correct_answer,
          i.source.clause,
          i.adjacent_wrong.label,
          i.family,
        ]
          .join(" ")
          .toLowerCase()
          .includes(w),
      ),
  );
}
export function counterpart(items, item) {
  return item.pair_id
    ? items.find((i) => i.pair_id === item.pair_id && i.id !== item.id)
    : undefined;
}
export function stats(items) {
  return {
    total: items.length,
    factual: items.filter((i) => i.item_type === "factual").length,
    category: items.filter((i) => i.item_type === "category_error").length,
    pairs: new Set(items.filter((i) => i.pair_id).map((i) => i.pair_id)).size,
    domains: new Set(items.map((i) => i.domain)).size,
  };
}
export function parseState(search, items) {
  const p = new URLSearchParams(search);
  const id = items.some((i) => i.id === p.get("item"))
    ? p.get("item")
    : "cs-001";
  return {
    id,
    query: p.get("q") || "",
    domain: items.some((i) => i.domain === p.get("domain"))
      ? p.get("domain")
      : "all",
    type: ["factual", "category_error"].includes(p.get("type"))
      ? p.get("type")
      : "all",
    paired: p.get("paired") === "1",
    tab: ["evidence", "pair", "rubric"].includes(p.get("tab"))
      ? p.get("tab")
      : "evidence",
  };
}
export function stateSearch(state) {
  const p = new URLSearchParams();
  p.set("item", state.id);
  for (const [k, v] of [
    ["q", state.query],
    ["domain", state.domain === "all" ? "" : state.domain],
    ["type", state.type === "all" ? "" : state.type],
    ["paired", state.paired ? "1" : ""],
    ["tab", state.tab === "evidence" ? "" : state.tab],
  ])
    if (v) p.set(k, v);
  return "?" + p;
}
export function brief(item, items, manifest) {
  return {
    title: "Grounding inspection · evaluation brief",
    status: "Reference corpus only; no model evaluated",
    item,
    paired_item: counterpart(items, item) || null,
    evaluation_design: {
      factual:
        "Assess required concepts, forbidden concepts, numerical facts, entity fidelity and citation support separately.",
      category_error:
        "Reject the false premise; report category-error handling separately from factual accuracy.",
      paired:
        "Joint success requires a correct answer to both members. One correct member is not pair success.",
      abstention:
        "Report abstention and coverage separately; abstention on an answerable item is not a correct factual answer.",
      limitations:
        "Authored adjacent wrong answers are design probes, not observed model failures. Lexical concepts alone cannot establish correctness. Small US federal regulatory corpus; dated sources are not current compliance advice.",
    },
    provenance: manifest,
  };
}
