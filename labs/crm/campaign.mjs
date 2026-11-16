const $ = (id) => document.getElementById(id);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const count = (value) => Number(value).toLocaleString("en-US");
const decimal = (value, digits = 3) =>
  value == null ? "Not defined" : Number(value).toFixed(digits);
const percent = (value, digits = 1) =>
  value == null ? "Not defined" : `${(100 * value).toFixed(digits)}%`;
const signed = (value, digits = 3) =>
  value == null
    ? "Not defined"
    : `${value >= 0 ? "+" : ""}${decimal(value, digits)}`;
const list = (items) =>
  `<ul>${items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>`;
const json = (value) =>
  `<pre class="raw-json" tabindex="0" role="region" aria-label="Raw protocol or provenance data">${escape(JSON.stringify(value, null, 2))}</pre>`;
let data,
  artifactSha256,
  records,
  byRow,
  selected,
  order = "gap";

function validate(value) {
  if (
    !value ||
    !value.protocol ||
    !value.source ||
    !value.provenance ||
    !Array.isArray(value.records)
  )
    throw Error("Incomplete evaluation artifact");
  if (value.records.length !== value.split.holdout.n || !value.records.length)
    throw Error("Holdout coverage does not match the record count");
  const seen = new Set();
  for (const row of value.records) {
    if (
      !Number.isInteger(row.row) ||
      seen.has(row.row) ||
      ![0, 1].includes(row.outcome) ||
      !Number.isFinite(row.durationSeconds) ||
      row.durationSeconds < 0 ||
      ![row.withoutDuration, row.withDuration].every(
        (v) => Number.isFinite(v) && v >= 0 && v <= 1,
      )
    )
      throw Error("Invalid held-out record");
    seen.add(row.row);
  }
  for (const key of ["withoutDuration", "withDuration", "constantBaseline"]) {
    if (
      !["averagePrecision", "brier", "logLoss"].every((metric) =>
        Number.isFinite(value.models[key].metrics[metric]),
      )
    )
      throw Error("Incomplete model metrics");
  }
  if (!seen.has(value.recordDefaultRow))
    throw Error("Default record is outside the holdout");
}

function renderMetrics() {
  const a = data.models.withoutDuration.metrics,
    b = data.models.withDuration.metrics;
  const baseline = data.models.constantBaseline.metrics;
  const averageScore = (key) =>
    data.calibration[key].reduce(
      (total, bin) => total + (bin.n ? bin.meanProbability * bin.n : 0),
      0,
    ) / data.split.holdout.n;
  $("calibration-warning").innerHTML =
    `<strong>Ranking gains do not establish calibration.</strong> Average holdout scores are ${percent(averageScore("withoutDuration"), 2)} without duration and ${percent(averageScore("withDuration"), 2)} with it, against ${percent(data.split.holdout.prevalence, 2)} observed subscriptions. Inspect the score bins below.`;
  const definitions = [
    [
      "averagePrecision",
      "Average precision",
      "Higher is better · ranking summary",
      "Noninterpolated average precision",
    ],
    [
      "brier",
      "Brier score",
      "Lower is better · squared prediction error",
      "Mean squared error against observed outcomes",
    ],
    [
      "logLoss",
      "Logarithmic loss",
      "Lower is better · penalizes confident errors",
      "Binary logarithmic loss",
    ],
  ];
  $("metrics").innerHTML = definitions
    .map(
      ([key, label, note]) =>
        `<div class="metric-row"><div class="metric-label"><strong>${label}</strong><span>${note}</span></div><div class="metric-value"><div class="metric-number">${decimal(a[key])}<small>Duration excluded</small></div></div><div class="metric-value with-value"><div class="metric-number">${decimal(b[key])}<small>Duration included</small></div></div></div>`,
    )
    .join("");
  $("comparison-context").textContent =
    `${count(data.split.holdout.n)} later source rows · ${count(data.split.holdout.positives)} subscriptions · ${percent(data.split.holdout.prevalence)} holdout base rate. Both models are fitted only on the preceding ${count(data.split.train.n)} rows.`;
  $("base-rate-shift").innerHTML =
    `<strong>The outcome base rate shifts:</strong> ${percent(data.split.train.prevalence, 2)} in training → ${percent(data.split.holdout.prevalence, 2)} in the later holdout. These are different source periods; the scores have not been recalibrated on the holdout.`;
  $("without-description").textContent =
    "Profile and prior-campaign fields, assumed available before this call. The release has no ingestion timestamps to verify that assumption.";
  const n = a.topBudget.count;
  $("budget-title").textContent =
    `The highest-scored ${percent(a.topBudget.fraction, 0)} · ${count(n)} records`;
  $("budget-comparison").innerHTML = `<div class="budget-results">${[
    ["Duration excluded", a.topBudget],
    ["Duration included", b.topBudget],
  ]
    .map(
      ([label, v]) =>
        `<div><h3>${label}</h3><strong>${percent(v.precision)} <span class="unit">precision</span></strong><p>${count(v.positives)} observed subscriptions / ${count(v.count)} selected records<br>${percent(v.recall)} of all holdout subscriptions captured</p></div>`,
    )
    .join(
      "",
    )}</div><p class="record-footnote">The same selection count applies to both models; exact score ties break by original source row. The two selected sets can contain different records. Holdout base rate: ${percent(data.split.holdout.prevalence)}.</p>`;
  $("metric-table").innerHTML =
    `<table><caption>Metrics on the same ${count(data.split.holdout.n)} holdout rows. The constant baseline predicts the training subscription rate (${percent(data.split.train.prevalence, 3)}) for every row.</caption><thead><tr><th scope="col">Metric</th><th scope="col">Duration excluded</th><th scope="col">Duration included</th><th scope="col">Constant baseline</th></tr></thead><tbody>${definitions.map(([key, label]) => `<tr><th scope="row">${label}</th><td>${decimal(a[key], 8)}</td><td>${decimal(b[key], 8)}</td><td>${decimal(baseline[key], 8)}</td></tr>`).join("")}<tr><th scope="row">Top-budget precision</th><td>${a.topBudget.positives} / ${a.topBudget.count} (${percent(a.topBudget.precision, 4)})</td><td>${b.topBudget.positives} / ${b.topBudget.count} (${percent(b.topBudget.precision, 4)})</td><td>Not evaluated</td></tr></tbody></table>`;
  const resampling = data.comparison.blockResampling;
  $("uncertainty").innerHTML =
    `<h3>Paired block-resampling sensitivity</h3><p>${escape(resampling.interpretation)}</p><p>${count(resampling.replicates)} draws of complete held-out month-label blocks, with the same draw for both fixed models. These are descriptive sensitivity ranges, not population confidence intervals. Differences below are duration included minus duration excluded.</p><div class="table-scroll" tabindex="0" role="region" aria-label="Paired block-resampling differences"><table><thead><tr><th scope="col">Difference</th><th scope="col">Observed</th><th scope="col">2.5th–97.5th percentiles</th><th scope="col">Valid replicates</th></tr></thead><tbody>${[
      ["averagePrecision", "Average precision"],
      ["brier", "Brier score"],
      ["precisionAtBudget", "Top-budget precision"],
    ]
      .map(([key, label]) => {
        const r = resampling.ranges[key];
        return `<tr><th scope="row">${label}</th><td>${signed(data.comparison.deltas[key], 6)}</td><td>${signed(r.low, 6)} to ${signed(r.high, 6)}</td><td>${count(r.validReplicates)}</td></tr>`;
      })
      .join(
        "",
      )}</tbody></table></div><p>Undefined average-precision replicates: ${count(resampling.undefinedAPReplicates)}. Replicate sizes vary from ${count(resampling.replicateRows.min)} to ${count(resampling.replicateRows.max)} rows. No models are refitted within this resampling.</p>`;
  renderCalibration();
}

function renderCalibration() {
  $("calibration").innerHTML = ["withoutDuration", "withDuration"]
    .map((key) => {
      const bins = data.calibration[key],
        label =
          key === "withoutDuration" ? "Duration excluded" : "Duration included";
      const points = bins
        .filter((bin) => bin.n > 0)
        .map(
          (bin) =>
            `<circle cx="${45 + bin.meanProbability * 390}" cy="${230 - bin.observedRate * 195}" r="5" fill="${key === "withoutDuration" ? "#206455" : "#923f29"}"/>`,
        )
        .join("");
      return `<section class="calibration-model"><h3>${label}</h3><svg viewBox="0 0 480 280" role="img" aria-label="${label}: mean model score versus observed subscription rate; exact bin counts in the table below"><line x1="45" y1="230" x2="435" y2="35" stroke="#83928a" stroke-dasharray="5 5"/><path d="M45 30V230H440" stroke="#738278" fill="none"/>${points}<text x="45" y="250">0</text><text x="430" y="250">1</text><text x="25" y="234">0</text><text x="25" y="39">1</text><text x="245" y="274" text-anchor="middle">Mean model score</text><text x="55" y="20">Observed subscription rate</text></svg><div class="table-scroll" tabindex="0" role="region" aria-label="${label} calibration bins"><table><thead><tr><th scope="col">Score bin</th><th scope="col">Records</th><th scope="col">Subscriptions</th><th scope="col">Mean score</th><th scope="col">Observed rate</th></tr></thead><tbody>${bins.map((bin, i) => `<tr><th scope="row">[${decimal(bin.lower, 1)}, ${decimal(bin.upper, 1)}${i === bins.length - 1 ? "]" : ")"}</th><td>${count(bin.n)}</td><td>${count(bin.positives)}</td><td>${decimal(bin.meanProbability, 4)}</td><td>${percent(bin.observedRate, 2)}</td></tr>`).join("")}</tbody></table></div></section>`;
    })
    .join("");
}

function setOrder(next) {
  order = next === "chronological" ? "chronological" : "gap";
  records = [...data.records].sort(
    order === "chronological"
      ? (a, b) => a.row - b.row
      : (a, b) =>
          Math.abs(b.withDuration - b.withoutDuration) -
            Math.abs(a.withDuration - a.withoutDuration) || a.row - b.row,
  );
  $("record-order").value = order;
}

function updateUrl() {
  const url = new URL(location.href);
  url.searchParams.set("row", selected.row);
  url.searchParams.set("order", order);
  history.replaceState(null, "", url);
}

function showRecord(row, announce = true) {
  selected = byRow.get(Number(row));
  $("record").setAttribute("aria-invalid", String(!selected));
  $("record-inspector").hidden = !selected;
  for (const id of [
    "export-record",
    "copy-link",
    "previous-record",
    "next-record",
  ])
    $(id).disabled = !selected;
  if (!selected) {
    $("record-status").textContent =
      `Enter a whole source row from ${data.split.holdout.firstRow} to ${data.split.holdout.lastRow}. No record is selected.`;
    return;
  }
  $("record").value = selected.row;
  const position = records.findIndex((r) => r.row === selected.row),
    block = data.split.blocks.find((b) => b.id === selected.blockId);
  $("previous-record").disabled = position === 0;
  $("next-record").disabled = position === records.length - 1;
  const budget = data.models.withoutDuration.metrics.topBudget.count;
  const change = selected.withDuration - selected.withoutDuration;
  $("record-inspector").innerHTML =
    `<div class="record-grid"><div class="record-side"><span class="condition">A / Duration excluded</span><div class="record-score">${decimal(selected.withoutDuration, 6)}</div><p class="score-caption">Uncalibrated model score · range 0–1</p><dl class="fact-grid"><div><dt>Source row</dt><dd>${count(selected.row)}</dd></div><div><dt>Source month-label block</dt><dd>${selected.blockId} · ${escape(block.month)}</dd></div><div><dt>Rank within later batch</dt><dd>${count(selected.rankWithoutDuration)} / ${count(data.records.length)}</dd></div><div><dt>In highest-scored 10%?</dt><dd>${selected.rankWithoutDuration <= budget ? "Yes" : "No"}</dd></div></dl><h3>Information used</h3><p class="record-footnote">Profile and prior-campaign features only. Their availability before the call is assumed, not timestamp-verified. This minimal public record view does not reproduce demographic fields.</p></div><div class="record-side"><span class="condition">B / Duration included</span><div class="record-score">${decimal(selected.withDuration, 6)}</div><p class="score-caption">${signed(change, 6)} score difference on the same row · both models fitted separately</p><dl class="fact-grid"><div><dt>Rank within later batch</dt><dd>${count(selected.rankWithDuration)} / ${count(data.records.length)}</dd></div><div><dt>In highest-scored 10%?</dt><dd>${selected.rankWithDuration <= budget ? "Yes" : "No"}</dd></div></dl><div class="duration"><span>Known only after the call</span><strong>${count(selected.durationSeconds)} ${selected.durationSeconds === 1 ? "second" : "seconds"}</strong><p>Observed last-contact duration. The comparator adds log1p(duration) to the same profile/history specification. This score difference is not a causal effect of a longer call.</p></div></div></div><div class="outcome"><details id="outcome-disclosure"><summary>Reveal the observed subscription outcome</summary><p><strong>${selected.outcome === 1 ? "Subscribed · y = yes" : "Did not subscribe · y = no"}</strong>. This held-out label was used to evaluate predictions; it did not determine the default record or browsing order.</p></details></div><p class="record-footnote">All ${count(data.records.length)} holdout rows are available. This is record ${count(position + 1)} in the selected browsing order. Row ordinals are source positions, not verified unique client identifiers.</p>`;
  updateUrl();
  if (announce)
    $("record-status").textContent =
      `Source row ${selected.row} selected. Both scores and the post-call duration are shown; the outcome is hidden.`;
}

function renderProtocol() {
  const p = data.protocol;
  $("timeline").innerHTML = `<div class="split-timeline">${[
    ["train", "Training"],
    ["holdout", "Later holdout"],
  ]
    .map(([key, label]) => {
      const s = data.split[key];
      return `<div class="split-segment" style="flex:${s.n}"><strong>${label} · ${count(s.n)} records</strong><span>Original rows ${count(s.firstRow)}–${count(s.lastRow)}</span><span>${count(s.positives)} subscriptions · ${percent(s.prevalence)} base rate</span></div>`;
    })
    .join(
      "",
    )}</div><p class="timeline-note">Source order → boundary fixed at the end of a contiguous month-label block. ${escape(p.split.dateLimit)} No validation set or tuning.</p><details><summary>Inspect all source-order blocks and later base rates</summary><div class="table-scroll" tabindex="0" role="region" aria-label="Source-order blocks"><table><thead><tr><th scope="col">Block</th><th scope="col">Month label</th><th scope="col">Original rows</th><th scope="col">Partition</th><th scope="col">Records</th><th scope="col">Holdout subscriptions</th></tr></thead><tbody>${data.split.blocks
    .map((block) => {
      const m = data.monthly.find((v) => v.blockId === block.id);
      return `<tr><th scope="row">${block.id}</th><td>${escape(block.month)}</td><td>${block.firstRow}–${block.lastRow}</td><td>${escape(block.partition)}</td><td>${count(block.n)}</td><td>${m ? `${count(m.positives)} (${percent(m.prevalence)})` : "Not part of holdout"}</td></tr>`;
    })
    .join("")}</tbody></table></div></details>`;
  $("model-protocol").innerHTML =
    `<p>One fixed L2 logistic-regression pipeline (C=${p.model.C}), fit independently under the two input specifications. Encoders and scaling are learned from training rows only.</p><p><strong>Shared profile inputs:</strong> ${p.features.profile.map(escape).join(", ")}.<br><strong>Prior-campaign inputs:</strong> ${p.features.history.map(escape).join(", ")}.</p><p>${escape(p.preprocessing.duration)}</p><p>${escape(p.split.validation)}</p><details><summary>Exact frozen specification</summary>${json(p)}</details>`;
  $("timing-protocol").innerHTML =
    `<p>${escape(p.decisionPoint)}</p><p><strong>Excluded from both models:</strong> ${[...p.features.excludedCallMetadata, ...p.features.excludedMacro].map(escape).join(", ")}.</p><p>${escape(p.features.availabilityNotes.excludedMacro)}</p><p>${escape(p.preprocessing.pdays)}</p><p>${escape(p.preprocessing.categoricalEncoding)}</p><details><summary>Observed data quality and missing-value handling</summary>${json(data.dataQuality)}<p>${escape(p.preprocessing.missing)}</p></details>`;
  $("limitations").innerHTML = list(data.limitations || p.limits);
  const s = data.source;
  $("provenance").innerHTML =
    `<p><a href="${escape(s.url)}">${escape(s.dataset)}</a> · DOI <a href="https://doi.org/${escape(s.doi)}">${escape(s.doi)}</a>. Creators: ${s.creators.map(escape).join(", ")}.</p><p>Licensed under <a href="${escape(s.license.url)}">${escape(s.license.name)}</a>. ${escape(s.license.changes)}</p><p>The source documents that duration is unavailable before a call. This audit demonstrates that documented boundary under the frozen model and split.</p><dl class="hash-list"><dt>Source CSV SHA-256</dt><dd class="hash">${s.data.sha256}</dd><dt>Frozen protocol SHA-256</dt><dd class="hash">${data.provenance.protocolSha256}</dd><dt>Analysis source SHA-256</dt><dd class="hash">${data.provenance.analysisSourceSha256}</dd><dt>Loaded evaluation artifact SHA-256</dt><dd class="hash">${artifactSha256}</dd></dl><p><a href="https://github.com/priyatham9/priyatham9.github.io/tree/main/scripts/crm_campaign_audit">Read the analysis and reproduction instructions ↗</a> · <a href="campaign.data.json" download>Download the exact evaluation artifact ↓</a></p><details><summary>Full source manifest and fitted-model provenance</summary>${json({ source: s, provenance: data.provenance })}</details>`;
  $("source-credit").innerHTML =
    `Data: ${s.creators.map(escape).join(", ")} · <a href="${escape(s.url)}">UCI Bank Marketing</a> · <a href="${escape(s.license.url)}">${escape(s.license.spdx)}</a>. Source CSV retained unchanged; this investigation adds preprocessing, fitted predictions and evaluation. No names or invented identities are displayed.`;
}

function downloadReview() {
  if (!selected) return;
  const review = {
    schemaVersion: "crm-campaign-review/1",
    artifact: {
      path: "campaign.data.json",
      sha256: artifactSha256,
      schemaVersion: data.schemaVersion,
    },
    source: data.source,
    provenance: data.provenance,
    protocol: data.protocol,
    split: data.split,
    models: data.models,
    comparison: data.comparison,
    calibration: data.calibration,
    view: {
      row: selected.row,
      order,
      outcomeRevealed: $("outcome-disclosure").open,
      defaultSelectionRule: data.protocol.recordBrowser.defaultRule,
    },
    record: selected,
    scoreInterpretation:
      "Uncalibrated logistic-model outputs; duration is known only after the call. Prediction differences do not identify causal impact.",
    limitations: data.limitations,
  };
  const blob = new Blob([JSON.stringify(review, null, 2) + "\n"], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `campaign-review-row-${selected.row}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("record-status").textContent =
    `Exported source row ${selected.row}, both scores, observed outcome, full protocol and artifact hash.`;
}

async function start() {
  try {
    const response = await fetch("campaign.data.json");
    if (!response.ok) throw Error(`Artifact HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    artifactSha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    data = JSON.parse(new TextDecoder().decode(bytes));
    validate(data);
    byRow = new Map(data.records.map((r) => [r.row, r]));
    renderMetrics();
    renderProtocol();
    $("record").min = data.split.holdout.firstRow;
    $("record").max = data.split.holdout.lastRow;
    $("record-selection").textContent =
      `Browse all ${count(data.records.length)} later rows. The default is the largest absolute score difference, with source-row order breaking ties. No held-out outcome is used to choose it. You can enter any holdout row directly.`;
    const params = new URLSearchParams(location.search);
    setOrder(params.get("order"));
    const requested = Number(params.get("row")),
      validRequested = byRow.has(requested);
    showRecord(validRequested ? requested : data.recordDefaultRow, false);
    if (params.has("row") && !validRequested)
      $("record-status").textContent =
        "The linked row is not in this holdout. Showing the protocol-defined default.";
    $("record").addEventListener("change", () =>
      showRecord(Number($("record").value)),
    );
    $("record-order").addEventListener("change", () => {
      setOrder($("record-order").value);
      showRecord(selected?.row ?? data.recordDefaultRow);
    });
    for (const [id, step] of [
      ["previous-record", -1],
      ["next-record", 1],
    ])
      $(id).addEventListener("click", () => {
        const index = records.findIndex((r) => r.row === selected.row);
        showRecord(records[index + step].row);
      });
    $("export-record").addEventListener("click", downloadReview);
    $("copy-link").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        $("record-status").textContent =
          "Copied the current row and browsing order. The outcome opens hidden.";
      } catch {
        $("record-status").textContent =
          "Copy is unavailable in this browser. The address bar contains this review link.";
      }
    });
    $("load-status").hidden = true;
    $("audit").hidden = false;
  } catch (error) {
    $("audit").hidden = true;
    $("load-status").textContent =
      "The pinned evaluation could not be loaded or validated. No result values are shown.";
    $("load-fallback").hidden = false;
    console.error("Campaign evidence unavailable:", error);
  }
}
start();
