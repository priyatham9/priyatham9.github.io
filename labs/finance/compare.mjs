import { cash } from "../models.mjs";

// A pin is an in-memory copy of the complete scenario, never browser storage.
export function snapshot(inputs) {
  const bounds = { revenue: [0, 1e12], cogs: [0, 1e12], dso: [15, 75], dio: [20, 100], dpo: [10, 75] };
  for (const [key, [min, max]] of Object.entries(bounds)) {
    if (!Number.isFinite(inputs[key]) || inputs[key] < min || inputs[key] > max || (!["revenue", "cogs"].includes(key) && !Number.isInteger(inputs[key]))) {
      throw new RangeError(`Invalid scenario ${key}`);
    }
  }
  const copy = Object.fromEntries(Object.keys(bounds).map(key => [key, inputs[key]]));
  return Object.freeze({ inputs: Object.freeze(copy), result: Object.freeze(cash(copy)) });
}

export function cashBridge(inputs) {
  const scenario = snapshot(inputs).result;
  const baseline = cash({ revenue: inputs.revenue, cogs: inputs.cogs });
  const changes = [scenario.ar - baseline.ar, scenario.inventory - baseline.inventory, baseline.ap - scenario.ap];
  let position = baseline.nwc;
  const steps = changes.map((change, i) => {
    const start = position;
    position += change;
    return { label: ["Collections", "Inventory", "Payments"][i], start, end: position, value: change };
  });
  return { baseline, scenario, release: baseline.nwc - scenario.nwc, steps };
}
