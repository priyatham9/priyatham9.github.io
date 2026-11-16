import { PredictionWorkerClient } from "./prediction-worker-client.mjs";
import { changeBudget, exportRecordsCSV } from "./prediction-model.mjs";

const $ = (id) => document.getElementById(id);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const count = (n) => n.toLocaleString("en-US");
const decimal = (v, places = 4) =>
  v == null ? "Undefined" : Number(v).toFixed(places);
const percent = (v, places = 1) =>
  v == null ? "Undefined" : `${(100 * v).toFixed(places)}%`;
const signed = (v) =>
  v == null ? "Undefined" : `${v >= 0 ? "+" : ""}${decimal(v, 6)}`;
const MAX_BYTES = 10 * 1024 * 1024,
  PAGE_SIZE = 25;
const LIMITATIONS = [
  "This tool evaluates supplied labels and scores. It does not train or query a model, establish that predictions are held out, or verify how the labels were obtained.",
  "A score in [0, 1] is not automatically a calibrated probability. Calibration bins describe this supplied cohort; they do not guarantee individual probabilities or future calibration.",
  "Information-availability notes are analyst declarations. The CSV contains no feature-ingestion timestamps or model provenance that can verify the decision-time boundary.",
  "Whole-cohort ranking and top-budget precision are retrospective descriptions. They do not identify the causal effect of contacting, treating or deploying to selected records.",
  "The tool reports no population confidence intervals or prospective performance guarantees. Repeated people, dependent records and cohort selection may affect interpretation.",
  "Viewing filters do not remove rows from the analysis. A source-byte hash identifies the exact input file, not the truth or completeness of its contents.",
];
const BASIS = {
  cohort:
    "All accepted data rows, shared by both score columns; no missing outcomes or scores dropped.",
  outcome:
    "Supplied binary outcome: 0 or 1. The tool cannot infer its substantive definition.",
  averagePrecision:
    "Noninterpolated average precision with tied-score groups evaluated together. Undefined when there are no positive labels.",
  brier:
    "Mean of (score - outcome)^2 over the full accepted cohort; smaller is better.",
  topBudget:
    "Take ceil(fraction * N) highest scores from the entire accepted batch. Exact ties break by original data-row ordinal. This is not a prospective policy.",
  calibration:
    "Ten fixed equal-width bins: left-closed/right-open, except the last includes 1. Empty bins retain zero counts and undefined means/rates.",
  viewingFilters:
    "Group and score-bin filters affect the ledger and optional filtered CSV export only. They never redefine the analytical cohort.",
};
let audit = null,
  source = null,
  filtered = [],
  selectedOrdinal = null,
  pageIndex = 0;
const analyzer = new PredictionWorkerClient();
let operation = 0,
  sampleController = null;

function rawJson(value) {
  return `<pre class="raw-data" tabindex="0" role="region" aria-label="Exact analysis values">${escape(JSON.stringify(value, null, 2))}</pre>`;
}
function paint() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 0)),
  );
}
function groupLabel(value) {
  return value === null ? "No group value" : value;
}

function eraseWorkingState() {
  audit = null;
  source = null;
  filtered = [];
  selectedOrdinal = null;
  pageIndex = 0;
  $("results").hidden = true;
  $("source-panel").hidden = true;
  $("empty-state").hidden = false;
  $("settings").disabled = true;
  $("availability").disabled = true;
  $("budget").value = "0.1";
  $("note-a").value = "";
  $("note-b").value = "";
  $("group-filter").replaceChildren();
  $("bin-filter").value = "all";
  $("bin-model").value = "a";
  $("csv-scope").value = "all";
  for (const id of [
    "source-details",
    "source-hash",
    "cohort-summary",
    "metric-comparison",
    "budget-results",
    "calibration",
    "record-rows",
    "record-detail",
    "view-summary",
    "metric-basis",
    "class-warning",
  ])
    $(id).replaceChildren();
  $("load-error").hidden = true;
  $("load-error").textContent = "";
  $("clear").disabled = true;
}
function clearInput() {
  operation++;
  analyzer.stop();
  sampleController?.abort();
  sampleController = null;
  eraseWorkingState();
  $("csv-file").value = "";
  $("load-example").disabled = false;
  $("main").setAttribute("aria-busy", "false");
  $("load-status").textContent =
    "No CSV loaded. Working records, source hash and availability notes have been cleared.";
}
function beginLoad(message) {
  operation++;
  if (analyzer.pending) analyzer.stop();
  sampleController?.abort();
  sampleController = null;
  eraseWorkingState();
  $("load-status").textContent = message;
  $("clear").disabled = false;
  $("load-example").disabled = true;
  $("main").setAttribute("aria-busy", "true");
  return operation;
}
function showError(error, token) {
  if (token !== operation) return;
  eraseWorkingState();
  $("csv-file").value = "";
  $("clear").disabled = false;
  const location = [
    error.row != null ? `row ${error.row}` : null,
    error.column != null ? `column ${error.column}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  $("load-error").textContent =
    `${error.code ? `${error.code}: ` : ""}${error.message || "The file could not be read."}${location ? ` (${location})` : ""} No rows were accepted; no previous result remains active.`;
  $("load-error").hidden = false;
  $("load-status").textContent =
    "Input rejected. Choose a valid CSV or clear the input.";
  $("load-example").disabled = false;
  $("main").setAttribute("aria-busy", "false");
}

async function acceptBytes(bytes, name, token, exampleManifest = null) {
  if (token !== operation) return;
  $("load-status").textContent =
    "Analyzing locally in a background worker… Clear input cancels this analysis.";
  const {
    audit: evaluated,
    columns,
    byteLength,
    sha256,
  } = await analyzer.run(bytes, exampleManifest);
  if (token !== operation) return;
  audit = evaluated;
  source = {
    fileName: name,
    byteLength,
    sha256,
    columns,
    kind: exampleManifest ? "public-campaign-example" : "user-selected-csv",
    exampleManifest,
  };
  if (exampleManifest) {
    $("note-a").value =
      "Public campaign example: profile/history model; call duration excluded. Pre-call feature availability is assumed, not timestamp-verified.";
    $("note-b").value =
      "Public campaign example: the same specification plus realized last-call duration, known only after the call. Retrospective comparator.";
  }
  $("settings").disabled = false;
  $("availability").disabled = false;
  $("source-panel").hidden = false;
  $("results").hidden = false;
  $("empty-state").hidden = true;
  $("load-example").disabled = false;
  $("main").setAttribute("aria-busy", "false");
  $("source-details").innerHTML =
    `<p><strong>${escape(name)}</strong><br>${count(byteLength)} original bytes · ${count(audit.n)} accepted data rows</p><p>${exampleManifest ? "Derived public campaign score ledger. This hash identifies the example CSV, not the original UCI source dataset." : "Local file. No records were sent to a server."}</p>`;
  $("source-hash").textContent = sha256;
  $("group-filter").innerHTML =
    '<option value="all">All groups</option>' +
    audit.groups
      .map(
        (g, i) =>
          `<option value="${i}">${escape(groupLabel(g.group))} · ${count(g.n)}</option>`,
      )
      .join("");
  $("group-filter").disabled = !columns.includes("group");
  $("load-status").textContent =
    `Accepted all ${count(audit.n)} data rows. Both score columns use the same cohort.`;
  renderSummary();
  renderView(true);
  if (matchMedia("(max-width: 780px)").matches) {
    $("summary-title").focus({ preventScroll: true });
    $("summary-title").scrollIntoView({ block: "start" });
  }
}

async function loadFile(file) {
  const token = beginLoad(`Reading ${file.name} locally…`);
  try {
    if (file.size > MAX_BYTES)
      throw Error("The original file exceeds the 10 MiB byte limit.");
    await paint();
    if (token !== operation) return;
    const bytes = await file.arrayBuffer();
    if (token !== operation) return;
    await acceptBytes(bytes, file.name, token);
  } catch (error) {
    showError(error, token);
  }
}
async function loadExample() {
  const token = beginLoad("Loading the pinned public campaign example…");
  $("csv-file").value = "";
  sampleController = new AbortController();
  const signal = sampleController.signal;
  try {
    const [csvResponse, manifestResponse] = await Promise.all([
      fetch("prediction-sample.csv", { signal }),
      fetch("prediction-sample.manifest.json", { signal }),
    ]);
    if (!csvResponse.ok || !manifestResponse.ok)
      throw Error(
        "The public example could not be loaded. You can still open a local CSV.",
      );
    const [bytes, manifest] = await Promise.all([
      csvResponse.arrayBuffer(),
      manifestResponse.json(),
    ]);
    if (token !== operation) return;
    await acceptBytes(bytes, "prediction-sample.csv", token, manifest);
  } catch (error) {
    showError(error, token);
  } finally {
    if (token === operation) sampleController = null;
  }
}

function summaryObject() {
  const model = (value) => ({
    averagePrecision: value.averagePrecision,
    brier: value.brier,
    topBudget: value.topBudget,
    calibration: value.calibration,
  });
  return {
    schemaVersion: audit.schemaVersion,
    n: audit.n,
    positives: audit.positives,
    prevalence: audit.prevalence,
    budgetFraction: audit.budgetFraction,
    models: { a: model(audit.models.a), b: model(audit.models.b) },
    deltas: audit.deltas,
    groups: audit.groups,
  };
}
function renderSummary() {
  $("cohort-summary").innerHTML =
    `<strong>${count(audit.n)} accepted rows</strong> · ${count(audit.positives)} positive labels · <strong>${percent(audit.prevalence, 2)} prevalence</strong><br>All values below use this complete cohort, regardless of the record-view filters.`;
  $("class-warning").hidden = audit.positives > 0 && audit.positives < audit.n;
  $("class-warning").textContent =
    audit.positives === 0
      ? "There are no positive labels. Average precision and recall are undefined. A zero positive count in the selected budget is not evidence of successful discrimination."
      : "Every supplied label is positive. Average precision is 1 for any ranking and cannot establish discrimination against negative cases.";
  $("metric-comparison").innerHTML =
    `<div class="metric-header"><span>Whole-cohort metric</span><span>Score A</span><span>Score B</span></div>${[
      ["averagePrecision", "Average precision", "Higher is better · ranking"],
      ["brier", "Brier score", "Lower is better · squared error"],
    ]
      .map(
        ([key, label, note]) =>
          `<div class="metric-row"><div class="metric-name">${label}<small>${note}</small></div>${["a", "b"].map((k) => `<div class="metric-value${audit.models[k][key] == null ? " undefined" : ""}">${decimal(audit.models[k][key])}</div>`).join("")}</div>`,
      )
      .join(
        "",
      )}<p class="fine">B minus A: average precision ${signed(audit.deltas.averagePrecision)}; Brier score ${signed(audit.deltas.brier)}. A negative Brier difference favors B on this supplied cohort.</p>`;
  $("budget-results").innerHTML =
    `<h3 class="budget-heading">Highest-scored ${percent(audit.budgetFraction, 0)} · ${count(audit.models.a.topBudget.count)} records per column</h3><div class="budget-grid">${[
      "a",
      "b",
    ]
      .map((key) => {
        const m = audit.models[key].topBudget;
        return `<div class="budget-column"><h3>Score ${key.toUpperCase()}</h3><strong>${percent(m.precision)} precision</strong><p>${count(m.positives)} positive labels / ${count(m.count)} selected<br>${percent(m.recall)} recall</p><p class="tie-note">Cutoff score ${decimal(m.cutoffScore, 6)}.<br>${count(m.boundaryTieSelected)} of ${count(m.boundaryTieSize)} rows tied at the cutoff were selected; file order breaks the tie.</p></div>`;
      })
      .join("")}</div>`;
  renderCalibration();
  $("metric-basis").innerHTML =
    Object.entries(BASIS)
      .map(
        ([key, value]) =>
          `<p><strong>${escape(key)}:</strong> ${escape(value)}</p>`,
      )
      .join("") + rawJson(summaryObject());
}
function renderCalibration() {
  $("calibration").innerHTML =
    `<p class="calibration-note">A point compares the mean supplied score with the observed positive rate in one bin. The dashed line marks agreement. Empty bins are not plotted; their counts and undefined means remain in the table.</p><div class="calibration-grid">${[
      "a",
      "b",
    ]
      .map((key) => {
        const bins = audit.models[key].calibration;
        return `<section class="calibration-model"><h3>Score ${key.toUpperCase()}</h3><svg viewBox="0 0 430 270" role="img" aria-label="Score ${key.toUpperCase()} calibration; exact values and bin counts below"><path d="M40 30V220H400" fill="none" stroke="#819187"/><path d="M40 220L395 35" stroke="#8c9a90" stroke-dasharray="5 5"/>${bins
          .filter((bin) => bin.n > 0)
          .map(
            (bin) =>
              `<circle cx="${40 + bin.meanProbability * 355}" cy="${220 - bin.observedRate * 185}" r="4" fill="${key === "a" ? "#206355" : "#315e80"}"/>`,
          )
          .join(
            "",
          )}<text x="40" y="240">0</text><text x="390" y="240">1</text><text x="20" y="224">0</text><text x="20" y="39">1</text><text x="215" y="264" text-anchor="middle">Mean supplied score</text><text x="50" y="20">Observed positive rate</text></svg><div class="table-scroll" tabindex="0" role="region" aria-label="Score ${key.toUpperCase()} calibration table"><table><thead><tr><th scope="col">Score bin</th><th scope="col">Rows</th><th scope="col">Positive</th><th scope="col">Mean</th><th scope="col">Observed</th></tr></thead><tbody>${bins.map((bin, i) => `<tr><th scope="row">[${decimal(bin.lower, 1)}, ${decimal(bin.upper, 1)}${i === 9 ? "]" : ")"}</th><td>${count(bin.n)}</td><td>${count(bin.positives)}</td><td>${decimal(bin.meanProbability)}</td><td>${percent(bin.observedRate)}</td></tr>`).join("")}</tbody></table></div></section>`;
      })
      .join("")}</div>`;
}

function matchingRecords() {
  const groupIndex = $("group-filter").value,
    bin = $("bin-filter").value,
    model = $("bin-model").value;
  return audit.records.filter((row) => {
    if (
      groupIndex !== "all" &&
      row.group !== audit.groups[Number(groupIndex)].group
    )
      return false;
    if (bin !== "all") {
      const i = Number(bin),
        score = model === "a" ? row.scoreA : row.scoreB;
      if (score < i / 10 || (i === 9 ? score > 1 : score >= (i + 1) / 10))
        return false;
    }
    return true;
  });
}
function renderView(reset = false) {
  if (!audit) return;
  filtered = matchingRecords();
  if (reset) {
    pageIndex = 0;
    selectedOrdinal = filtered[0]?.ordinal ?? null;
  }
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  pageIndex = Math.min(pageIndex, pageCount - 1);
  if (!filtered.some((row) => row.ordinal === selectedOrdinal))
    selectedOrdinal = filtered[pageIndex * PAGE_SIZE]?.ordinal ?? null;
  const k = audit.models.a.topBudget.count,
    inBudget = { a: 0, b: 0 };
  for (const row of filtered) {
    if (audit.models.a.ranks[row.ordinal - 1] <= k) inBudget.a++;
    if (audit.models.b.ranks[row.ordinal - 1] <= k) inBudget.b++;
  }
  $("view-summary").textContent =
    `Viewing ${count(filtered.length)} of ${count(audit.n)} rows. Of these matches, ${count(inBudget.a)} are in A’s whole-cohort budget and ${count(inBudget.b)} in B’s. Viewing filters do not change any analysis metric above.`;
  const rows = filtered.slice(
    pageIndex * PAGE_SIZE,
    (pageIndex + 1) * PAGE_SIZE,
  );
  $("record-rows").innerHTML = rows
    .map(
      (row) =>
        `<tr${row.ordinal === selectedOrdinal ? ' class="selected"' : ""}><th scope="row"><button class="row-button" type="button" data-row="${row.ordinal}" aria-pressed="${row.ordinal === selectedOrdinal}">Data row ${count(row.ordinal)}</button><span class="record-id">${row.recordId === null ? "No record ID" : escape(row.recordId)}</span></th><td>${row.outcome}</td><td>${decimal(row.scoreA)}</td><td>${decimal(row.scoreB)}</td></tr>`,
    )
    .join("");
  for (const button of $("record-rows").querySelectorAll("button"))
    button.addEventListener("click", () => {
      selectedOrdinal = Number(button.dataset.row);
      renderView();
      $("record-rows")
        .querySelector(`[data-row="${selectedOrdinal}"]`)
        ?.focus();
      $("load-status").textContent =
        `Data row ${selectedOrdinal} selected. Analysis still uses all ${count(audit.n)} records.`;
    });
  $("no-records").hidden = filtered.length > 0;
  $("page-label").textContent =
    `Page ${pageIndex + 1} / ${pageCount} · ${PAGE_SIZE} rows per page`;
  $("previous-page").disabled = pageIndex === 0;
  $("next-page").disabled = pageIndex >= pageCount - 1;
  $("export-csv").disabled =
    $("csv-scope").value === "visible" && filtered.length === 0;
  renderDetail();
}
function renderDetail() {
  if (selectedOrdinal === null) {
    $("record-detail").innerHTML =
      '<h3>No matching record</h3><p class="fine">Change the viewing filters to inspect a row. Whole-cohort metrics remain available.</p>';
    return;
  }
  const row = audit.records[selectedOrdinal - 1],
    k = audit.models.a.topBudget.count;
  $("record-detail").innerHTML =
    `<h3>Data row ${count(row.ordinal)}</h3><dl><div><dt>Original record ID</dt><dd>${row.recordId === null ? "Not supplied" : escape(row.recordId)}</dd></div><div><dt>Group</dt><dd>${escape(groupLabel(row.group))}</dd></div><div><dt>Supplied outcome</dt><dd>${row.outcome} · ${row.outcome === 1 ? "positive" : "negative"}</dd></div></dl><div class="detail-scores">${[
      "a",
      "b",
    ]
      .map((key) => {
        const score = key === "a" ? row.scoreA : row.scoreB,
          rank = audit.models[key].ranks[row.ordinal - 1];
        return `<div><span>Score ${key.toUpperCase()}</span><strong>${decimal(score, 6)}</strong><small>Rank ${count(rank)} / ${count(audit.n)}<br>${rank <= k ? "In" : "Outside"} whole-cohort budget</small></div>`;
      })
      .join(
        "",
      )}</div><p class="fine">These are supplied scores. The file does not verify when their input information became available. Duplicate record IDs remain distinct data rows.</p>`;
}

function save(name, body, type) {
  const url = URL.createObjectURL(new Blob([body], { type })),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function viewSettings() {
  const group = $("group-filter").value,
    bin = $("bin-filter").value;
  return {
    groupFilter:
      group === "all"
        ? { mode: "all" }
        : { mode: "value", value: audit.groups[Number(group)].group },
    scoreBin:
      bin === "all"
        ? null
        : {
            model: $("bin-model").value,
            index: Number(bin),
            lower: Number(bin) / 10,
            upper: (Number(bin) + 1) / 10,
          },
    matchingRows: filtered.length,
    totalRows: audit.n,
    page: pageIndex + 1,
    selectedOrdinal,
    csvScope: $("csv-scope").value,
  };
}
function exportReview() {
  if (!audit) return;
  const row =
    selectedOrdinal === null ? null : audit.records[selectedOrdinal - 1];
  const review = {
    schemaVersion: "local-prediction-review/1",
    source,
    scope: {
      analysis: "All accepted data rows; viewing filters do not exclude rows",
      export:
        "Whole-cohort metric summary and selected record only. Raw rows are available through the separate CSV export.",
    },
    settings: {
      budgetFraction: audit.budgetFraction,
      availabilityDeclarations: {
        a: $("note-a").value,
        b: $("note-b").value,
        verified: false,
      },
      view: viewSettings(),
    },
    analysis: summaryObject(),
    selectedRecord: row
      ? {
          ...row,
          rankA: audit.models.a.ranks[row.ordinal - 1],
          rankB: audit.models.b.ranks[row.ordinal - 1],
        }
      : null,
    metricBasis: BASIS,
    limitations: LIMITATIONS,
  };
  save(
    `prediction-review-${source.sha256.slice(0, 12)}.json`,
    JSON.stringify(review, null, 2) + "\n",
    "application/json",
  );
  $("load-status").textContent =
    `Exported a review of all ${count(audit.n)} accepted rows, plus ${row ? "one selected record" : "no selected record"}. Viewing filters are recorded separately.`;
}
function exportCSV() {
  if (!audit) return;
  const scope = $("csv-scope").value,
    rows = scope === "visible" ? filtered : audit.records;
  if (!rows.length) return;
  save(
    `prediction-records-${scope}-${source.sha256.slice(0, 12)}.csv`,
    exportRecordsCSV(rows, { includeHeader: true }),
    "text/csv;charset=utf-8",
  );
  $("load-status").textContent =
    `Exported ${count(rows.length)} ${scope === "visible" ? "view-matching" : "accepted"} records. Text IDs and groups are formula-protected; this exported CSV has different bytes from the original source.`;
}

$("bin-filter").innerHTML += [...Array(10)]
  .map(
    (_, i) =>
      `<option value="${i}">[${decimal(i / 10, 1)}, ${decimal((i + 1) / 10, 1)}${i === 9 ? "]" : ")"}</option>`,
  )
  .join("");
$("limitations").innerHTML = LIMITATIONS.map(
  (text) => `<li>${escape(text)}</li>`,
).join("");
$("csv-file").addEventListener("change", () => {
  const file = $("csv-file").files[0];
  if (file) loadFile(file);
});
$("load-example").addEventListener("click", loadExample);
$("clear").addEventListener("click", clearInput);
for (const id of ["group-filter", "bin-model", "bin-filter"])
  $(id).addEventListener("change", () => renderView(true));
$("csv-scope").addEventListener("change", () => renderView());
$("previous-page").addEventListener("click", () => {
  pageIndex--;
  selectedOrdinal = filtered[pageIndex * PAGE_SIZE]?.ordinal ?? null;
  renderView();
});
$("next-page").addEventListener("click", () => {
  pageIndex++;
  selectedOrdinal = filtered[pageIndex * PAGE_SIZE]?.ordinal ?? null;
  renderView();
});
$("budget").addEventListener("change", () => {
  if (!audit) return;
  audit = changeBudget(audit, Number($("budget").value));
  renderSummary();
  renderView();
  $("load-status").textContent =
    `Retrospective budget changed to ${percent(audit.budgetFraction, 0)}. Average precision, Brier scores, calibration and ranks are unchanged.`;
});
$("export-review").addEventListener("click", exportReview);
$("export-csv").addEventListener("click", exportCSV);
for (const name of ["dragenter", "dragover"])
  $("drop-zone").addEventListener(name, (event) => {
    event.preventDefault();
    $("drop-zone").classList.add("dragging");
  });
for (const name of ["dragleave", "drop"])
  $("drop-zone").addEventListener(name, (event) => {
    event.preventDefault();
    $("drop-zone").classList.remove("dragging");
  });
$("drop-zone").addEventListener("drop", (event) => {
  const files = event.dataTransfer.files;
  if (files.length !== 1) {
    const token = beginLoad("Reading dropped files…");
    showError(Error("Choose exactly one CSV file at a time."), token);
    return;
  }
  $("csv-file").value = "";
  loadFile(files[0]);
});
