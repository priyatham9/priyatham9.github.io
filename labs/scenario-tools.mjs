export const MODEL_VERSION = "1.1.0";
const limits = {
  finance: {
    revenue: [0, 1e12, 12000000],
    cogs: [0, 1e12, 7200000],
    dso: [15, 75, 45],
    dio: [20, 100, 60],
    dpo: [10, 75, 30],
  },
  crm: { rate: [0, 100, 50] },
};
export function readScenario(model, search = "") {
  const params = new URLSearchParams(search),
    result = {};
  for (const [key, [min, max, fallback]] of Object.entries(
    limits[model] || {},
  )) {
    const raw = params.get(key),
      value = raw !== null && raw.trim() !== "" ? Number(raw) : NaN;
    result[key] =
      Number.isFinite(value) &&
      (key === "revenue" || key === "cogs" || Number.isInteger(value)) &&
      value >= min &&
      value <= max
        ? value
        : fallback;
  }
  if (model === "crm")
    result.cohort = ["all", "inbound", "outbound"].includes(
      params.get("cohort"),
    )
      ? params.get("cohort")
      : "all";
  return result;
}
export function scenarioURL(model, state, href) {
  const url = new URL(href);
  for (const key of [
    ...Object.keys(limits[model]),
    ...(model === "crm" ? ["cohort"] : []),
  ])
    url.searchParams.delete(key);
  const valid = readScenario(model, new URLSearchParams(state).toString());
  for (const [key, value] of Object.entries(valid))
    url.searchParams.set(key, String(value));
  return url.href;
}
export function resetScenarioURL(model, href) {
  const url = new URL(href);
  for (const key of [
    ...Object.keys(limits[model]),
    ...(model === "crm" ? ["cohort"] : []),
  ])
    url.searchParams.delete(key);
  return url.href;
}
export function csv(rows) {
  return (
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value ?? "");
            if (/^[=+@\t\r]/.test(text) || /^-[^\d]/.test(text))
              text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n") + "\r\n"
  );
}
export function downloadCSV(filename, rows) {
  const url = URL.createObjectURL(
      new Blob([csv(rows)], { type: "text/csv;charset=utf-8" }),
    ),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function addScenarioTools({
  model,
  container,
  getState,
  getRows,
  getLabel = () => "Synthetic public demonstration",
  isValid = () => true,
}) {
  const controls = document.createElement("div");
  controls.className = "scenario-tools";
  controls.innerHTML =
    '<button class="secondary" type="button" data-share>Share scenario</button><button class="secondary" type="button" data-export>Export CSV</button><p class="note" role="status" aria-live="polite"></p><label class="share-fallback" hidden>Scenario link<input readonly type="url" aria-label="Scenario link"></label>';
  container.append(controls);
  const status = controls.querySelector("[role=status]");
  controls.querySelector("[data-share]").addEventListener("click", async () => {
    if (!isValid()) {
      status.textContent = "Enter valid business assumptions before sharing.";
      return;
    }
    const url = scenarioURL(model, getState(), location.href);
    history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url);
      status.textContent =
        model === "finance"
          ? "Scenario link copied. It includes your entered revenue and cost assumptions."
          : "Scenario link copied. It contains synthetic inputs only.";
    } catch {
      const fallback = controls.querySelector(".share-fallback");
      fallback.hidden = false;
      fallback.querySelector("input").value = url;
      fallback.querySelector("input").focus();
      fallback.querySelector("input").select();
      status.textContent = "Copy the selected scenario link below.";
    }
  });
  controls.querySelector("[data-export]").addEventListener("click", () => {
    if (!isValid()) {
      status.textContent = "Enter valid business assumptions before exporting.";
      return;
    }
    downloadCSV(`${model}-scenario.csv`, [
      [getLabel(), model],
      ["Model version", MODEL_VERSION],
      ...getRows(),
    ]);
    status.textContent = "Scenario exported with assumptions and formulas.";
  });
  return {
    reset() {
      history.replaceState(null, "", resetScenarioURL(model, location.href));
      controls.querySelector(".share-fallback").hidden = true;
      status.textContent =
        "Baseline restored; shared scenario inputs removed from the URL.";
    },
    invalidate() {
      if (model !== "finance")
        history.replaceState(
          null,
          "",
          scenarioURL(model, getState(), location.href),
        );
      controls.querySelector(".share-fallback").hidden = true;
      status.textContent =
        "Scenario changed. Share again to copy the current inputs.";
    },
  };
}

export function parseBusinessAmount(raw) {
  if (
    (typeof raw !== "string" && typeof raw !== "number") ||
    String(raw).trim() === ""
  )
    return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1e12 ? value : null;
}
