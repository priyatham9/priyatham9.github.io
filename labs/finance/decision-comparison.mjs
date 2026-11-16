import { evaluatePolicy } from "./decision-model.mjs";

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// A pin owns every input that produced its result. It never borrows context
// from a subsequent render, and excludes UI filters / constructed comparators.
export function snapshotPolicy({
  base,
  policy,
  assumptions,
  provenance,
  status,
  startingCase,
}) {
  const inputs = structuredClone({
    base,
    policy,
    assumptions,
    provenance,
    status,
    startingCase,
  });
  inputs.policy = {
    salesLoss: 0,
    discount: 0,
    discountShare: 0,
    supplierPremium: 0,
    supplierShare: 0,
    annualOperatingCost: 0,
    setupCost: 0,
    ...inputs.policy,
  };
  return freeze({
    ...inputs,
    result: evaluatePolicy(inputs.base, inputs.policy, inputs.assumptions),
  });
}

const fields = [
  ...["revenue", "cogs"].map((key) => ({
    path: `base.${key}`,
    label: key === "revenue" ? "Annual revenue" : "Annual variable COGS",
    group: "Business context",
    format: "money",
  })),
  ...["dso", "dio", "dpo"].map((key) => ({
    path: `base.${key}`,
    label: `Baseline ${key.toUpperCase()}`,
    group: "Business context",
    format: "days",
  })),
  ...["dso", "dio", "dpo"].map((key) => ({
    path: `policy.${key}`,
    label: `Policy ${key.toUpperCase()}`,
    group: "Policy",
    format: "days",
  })),
  ...Object.entries({
    salesLoss: "Sales volume lost",
    discount: "Customer discount",
    discountShare: "Share receiving discount",
    supplierPremium: "Supplier premium",
    supplierShare: "Share paying supplier premium",
  }).map(([key, label]) => ({
    path: `policy.${key}`,
    label,
    group: "Policy",
    format: "percent",
  })),
  ...Object.entries({
    annualOperatingCost: "Annual operating cost",
    setupCost: "Setup cost",
  }).map(([key, label]) => ({
    path: `policy.${key}`,
    label,
    group: "Policy",
    format: "money",
  })),
  {
    path: "assumptions.rate",
    label: "Annual opportunity cost",
    group: "Business context",
    format: "percent",
  },
  {
    path: "assumptions.years",
    label: "Policy horizon",
    group: "Business context",
    format: "years",
  },
  ...["dso", "dio", "dpo"].flatMap((key) =>
    [0, 1].map((i) => ({
      path: `assumptions.limits.${key}.${i}`,
      label: `${key.toUpperCase()} ${i ? "maximum" : "minimum"}`,
      group: "Constraints",
      format: "days",
    })),
  ),
];
const at = (object, path) => path.split(".").reduce((o, key) => o[key], object);

export function comparePolicySnapshots(pinned, current) {
  const changes = fields.flatMap((field) => {
    const before = at(pinned, field.path),
      after = at(current, field.path);
    return before === after ? [] : [{ ...field, before, after }];
  });
  return {
    changes,
    sameContext: changes.every((change) => change.group === "Policy"),
    currentMinusPinnedNpv: current.result.npv - pinned.result.npv,
    currentMinusPinnedRelease: current.result.release - pinned.result.release,
    interpretation:
      "Each policy uses its own complete frozen or current assumptions. Differences are descriptive model comparisons, not causal effects or evidence of achievability.",
  };
}
