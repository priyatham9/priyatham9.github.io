const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const integer = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const million = (n, { signed = false } = {}) =>
  (signed && n > 0 ? "+" : "") + integer(n / 1e6);
const money = (n) =>
  `${n < 0 ? "−" : n > 0 ? "+" : ""}$${(Math.abs(n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}m`;
const canonical = (x) =>
  x === null || typeof x !== "object"
    ? JSON.stringify(x)
    : Array.isArray(x)
      ? `[${x.map(canonical).join(",")}]`
      : `{${Object.keys(x)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`)
          .join(",")}}`;
const digest = async (text) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
let data,
  rawData,
  dataSha,
  selectedCompany,
  selectedYear,
  selectedScope,
  selectedRows;
const names = {
  receivables: "Receivables",
  inventory: "Inventory",
  payables: "Payables",
};
function source(id) {
  return data.sources.find((s) => s.id === id);
}
function updateUrl() {
  const u = new URL(location.href);
  for (const [k, v] of Object.entries({
    company: $("company").value,
    year: $("year").value,
    scope: $("scope").value,
    account: $("account").value,
  }))
    u.searchParams.set(k, v);
  history.replaceState(null, "", u);
}
function setScopes(preferred) {
  const scopes =
    selectedCompany.id === "msft"
      ? [
          ["threeAccounts", "Receivables + inventory + payables"],
          ["inventoryPayables", "Inventory + payables"],
        ]
      : [["inventoryPayables", "Inventory + payables"]];
  $("scope").innerHTML = scopes
    .map(([v, l]) => `<option value="${v}">${l}</option>`)
    .join("");
  $("scope").value = scopes.some(([v]) => v === preferred)
    ? preferred
    : scopes[0][0];
}
function chart() {
  const w = Math.max(288, $("plot").clientWidth),
    compact = w < 600,
    left = compact ? 100 : 150,
    right = 24,
    top = 40,
    step = 62,
    rows = [
      ...selectedRows.map((r) => ({ ...r, label: names[r.account] })),
      { label: "Selected total", ...selectedScope },
    ],
    h = top + step * rows.length + 32;
  const max =
    Math.max(
      1,
      ...rows.flatMap((r) => [
        Math.abs(r.balanceProxy),
        Math.abs(r.reportedAdjustment),
      ]),
    ) / 1e6;
  const limit =
      Math.ceil(max / (max > 1000 ? 1000 : 100)) * (max > 1000 ? 1000 : 100),
    x = (n) => left + ((n / 1e6 + limit) / (2 * limit)) * (w - left - right),
    zero = x(0),
    ticks = compact
      ? [-limit, 0, limit]
      : [-limit, -limit / 2, 0, limit / 2, limit];
  let s = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="plot-title plot-desc"><title id="plot-title">Balance proxies and operating cash-flow adjustments by account</title><desc id="plot-desc">Diverging bars in USD millions, with zero at the center. Exact amounts and residuals are in the following table. Blue represents the balance proxy; green the reported adjustment.</desc>`;
  for (const t of ticks) {
    const tx = x(t * 1e6);
    s += `<line x1="${tx}" x2="${tx}" y1="25" y2="${h - 25}" stroke="${t === 0 ? "#8c9b9e" : "#d7dcd7"}"/><text class="plot-tick" x="${tx}" y="14" text-anchor="${t === -limit ? "start" : t === limit ? "end" : "middle"}">${integer(t)}</text>`;
  }
  rows.forEach((r, i) => {
    const y = top + i * step;
    s += `<text class="plot-label" x="0" y="${y + 18}">${esc(r.label)}</text>`;
    for (const [j, key, color] of [
      [0, "balanceProxy", "#215b7b"],
      [1, "reportedAdjustment", "#0d7166"],
    ]) {
      const end = x(r[key]);
      s += `<rect x="${Math.min(zero, end)}" y="${y + j * 15}" width="${Math.max(0.8, Math.abs(end - zero))}" height="11" fill="${color}"><title>${esc(r.label)}: ${key === "balanceProxy" ? "balance proxy" : "reported adjustment"} ${money(r[key])}</title></rect>`;
    }
  });
  $("plot").innerHTML = s + "</svg>";
}
function renderFacts() {
  const r =
    selectedRows.find((x) => x.account === $("account").value) ||
    selectedRows[0];
  $("account").value = r.account;
  document
    .querySelectorAll("#bridge-rows tr")
    .forEach((tr) =>
      tr.classList.toggle("selected", tr.dataset.account === r.account),
    );
  $("sign-rule").textContent =
    `${r.kind === "asset" ? "Asset proxy = opening − closing" : "Liability proxy = closing − opening"} = ${money(r.balanceProxy)}. Raw cash-flow fact × ${r.cashSign === -1 ? "−1" : "+1"} = ${money(r.reportedAdjustment)}.`;
  $("fact-caption").textContent =
    `${selectedCompany.name} · ${r.label} · fiscal ${selectedYear.fy}. Raw values below are USD, not millions.`;
  $("fact-rows").innerHTML = [
    ["Opening balance", r.opening],
    ["Closing balance", r.closing],
    ["Cash-flow adjustment", r.flow],
  ]
    .map(
      ([label, f]) =>
        `<tr><th scope="row">${label}</th><td><code>us-gaap:${esc(f.tag)}</code></td><td>${f.start ? `${esc(f.start)} → ${esc(f.end)}` : `As of ${esc(f.end)}`}</td><td>${integer(f.value)}</td></tr>`,
    )
    .join("");
  const report = source(selectedYear.reportSource),
    api = source(r.flow.sourceId);
  $("filing-basis").innerHTML =
    `All three facts: <strong>10-K ${esc(selectedYear.accession)}</strong>, filed ${esc(selectedYear.filed)}. <a href="${esc(report.url)}" target="_blank" rel="noopener">Read official annual report ↗</a> · <a href="${esc(api.url)}" target="_blank" rel="noopener">SEC CompanyFacts ↗</a>. Instant balances and exact annual duration are selected from this same accession.`;
  $("vintages").innerHTML = [
    ["Opening balance", r.opening],
    ["Closing balance", r.closing],
    ["Cash-flow adjustment", r.flow],
  ]
    .map(
      ([label, f]) =>
        `<div class="vintage-entry"><strong>${label}</strong> · ${f.identicalRows} identical selected row${f.identicalRows === 1 ? "" : "s"}. ${f.laterAnnualObservations.length ? f.laterAnnualObservations.map((v) => `<div>${esc(v.form)} ${esc(v.accession)}, filed ${esc(v.filed)}: ${integer(v.value)} USD — <strong>${v.changed ? "changed comparative value" : "same reported value"}</strong>.</div>`).join("") : "No later annual observation for this exact period in the pinned snapshot."}</div>`,
    )
    .join("");
  updateUrl();
}
function render() {
  selectedCompany = data.companies.find((c) => c.id === $("company").value);
  selectedYear = selectedCompany.years.find(
    (y) => y.fy === Number($("year").value),
  );
  selectedScope = selectedYear.scopes[$("scope").value];
  selectedRows = selectedYear.rows.filter((r) =>
    selectedScope.accounts.includes(r.account),
  );
  $("period").textContent =
    `Fiscal ${selectedYear.fy}: ${selectedYear.start} → ${selectedYear.end} · ${selectedYear.days} days · original 10-K filed ${selectedYear.filed} · ${selectedCompany.business}`;
  $("coverage").textContent =
    selectedCompany.id === "cost"
      ? "Coverage: two accounts. Costco groups other operating assets and liabilities; a separate receivables adjustment is not identified. Receivables are excluded, not zero."
      : $("scope").value === "threeAccounts"
        ? "Coverage: three accounts only. This includes receivables, which are not separately available for Costco in this audit. Use the two-account view for aligned arithmetic scope; do not rank unequal coverage."
        : "Coverage: inventory and payables only. Receivables are deliberately excluded from this view. The same account labels across companies do not establish equal operating scope.";
  const {
    balanceProxy: p,
    reportedAdjustment: f,
    residual: r,
    grossAbsoluteResidual: g,
  } = selectedScope;
  if (selectedScope.signMismatch) {
    $("verdict-title").textContent =
      `${money(p)} in the proxy. ${money(f)} in the reported adjustments.`;
    $("verdict-text").textContent =
      `The signs reverse for these ${selectedRows.length} accounts. Substituting balance changes for the operating adjustments would change the direction of the selected cash signal. The ${money(r)} difference is unreconciled in this audit.`;
  } else if (g > Math.abs(r) * 4 && g > 0) {
    $("verdict-title").textContent =
      `A $${million(Math.abs(r))}m net difference hides $${million(g)}m of component differences.`;
    $("verdict-text").textContent =
      `The proxy totals ${money(p)} and the reported adjustments total ${money(f)}. Inventory and payables differences offset. A close aggregate is not evidence that the individual balance changes measure operating cash adjustments.`;
  } else {
    $("verdict-title").textContent =
      `${money(p)} in the proxy; ${money(f)} in the reported adjustments.`;
    $("verdict-text").textContent =
      `Both totals have the same sign, but the selected lines differ by ${money(r)}. The comparison identifies a measurement difference; it does not allocate that difference to an operating cause.`;
  }
  $("verdict-title").innerHTML = esc($("verdict-title").textContent).replace(
    /([+−]?\$[\d,]+m)/g,
    '<span class="amount">$1</span>',
  );
  $("bridge-rows").innerHTML = selectedRows
    .map(
      (row) =>
        `<tr data-account="${row.account}"><th scope="row"><button type="button" data-inspect="${row.account}" aria-label="Inspect ${esc(row.label)} source facts">${esc(row.label)} ↘</button></th><td>${million(row.opening.value)}</td><td>${million(row.closing.value)}</td><td>${million(row.balanceProxy, { signed: true })}</td><td>${million(row.reportedAdjustment, { signed: true })}</td><td class="residual">${million(row.residual, { signed: true })}</td></tr>`,
    )
    .join("");
  $("bridge-total").innerHTML =
    `<tr><th scope="row">Selected total</th><td aria-label="Not totaled">—</td><td aria-label="Not totaled">—</td><td>${million(p, { signed: true })}</td><td>${million(f, { signed: true })}</td><td>${million(r, { signed: true })}</td></tr>`;
  $("net-residual").textContent = money(r);
  $("gross-residual").textContent = `$${million(g)}m`;
  const bound = selectedScope.roundingBoundIfNearestMillion;
  $("rounding").textContent =
    `At reported precision. If each published amount is rounded to the nearest $1m, the residual has a conservative ±$${bound / 1e6}m rounding bound (${money(r - bound)} to ${money(r + bound)}). This is not a statistical confidence interval.${Math.abs(r) <= bound ? " Zero lies inside this conditional rounding interval; the net difference alone is not distinguishable from rounding." : ""}`;
  const prior = $("account").value;
  $("account").innerHTML = selectedRows
    .map((x) => `<option value="${x.account}">${esc(x.label)}</option>`)
    .join("");
  if (selectedRows.some((x) => x.account === prior)) $("account").value = prior;
  $("evidence").innerHTML = data.evidence
    .filter(
      (e) =>
        e.sourceId.startsWith(selectedCompany.id) &&
        e.fiscalYear === selectedYear.fy,
    )
    .map((e) => {
      const s = source(e.sourceId);
      return `<article class="evidence-item"><h3>${esc(e.section)}</h3><p><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(selectedCompany.name)} fiscal ${selectedYear.fy} official report ↗</a> · source ${esc(s.id)}</p><blockquote>${esc(e.quote)}</blockquote><p><strong>Supports:</strong> ${esc(e.supports)}</p><p class="boundary"><strong>Does not establish:</strong> ${esc(e.doesNotEstablish)}</p></article>`;
    })
    .join("");
  chart();
  renderFacts();
}
function choose(company, year, scope, account) {
  $("company").value = company;
  $("year").value = String(year);
  selectedCompany = data.companies.find((c) => c.id === company);
  setScopes(scope);
  render();
  $("account").value = account;
  renderFacts();
}
async function exportReview() {
  const button = $("export");
  button.disabled = true;
  const filename = `${selectedCompany.id}-${selectedYear.fy}-${$("scope").value}-filing-review.json`;
  try {
    const payload = {
      schemaVersion: "finance-filings-review/1",
      selection: {
        company: selectedCompany.id,
        fiscalYear: selectedYear.fy,
        scope: $("scope").value,
        account: $("account").value,
      },
      selectedResult: selectedScope,
      sourceDataset: {
        url: new URL("./filings.data.json", location.href).href,
        sha256: dataSha,
        hashBasis:
          "Exact UTF-8 response bytes, including whitespace and final newline",
      },
      evidence: data,
    };
    const review = {
      ...payload,
      reviewSha256: await digest(canonical(payload)),
      reviewDigestMethod:
        "SHA-256 of recursively key-sorted compact JSON for all fields except reviewSha256 and reviewDigestMethod; arrays preserve order",
    };
    const blob = new Blob([JSON.stringify(review, null, 2) + "\n"], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("export-status").textContent =
      "Downloaded exact selection, complete evidence ledger and verification hashes.";
  } catch (error) {
    $("export-status").textContent = `Export failed: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}
try {
  const response = await fetch("./filings.data.json");
  if (!response.ok) throw new Error(`Dataset HTTP ${response.status}`);
  rawData = await response.text();
  data = JSON.parse(rawData);
  dataSha = await digest(rawData);
  $("company").innerHTML = data.companies
    .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
    .join("");
  $("sources").innerHTML = data.sources
    .map(
      (s) =>
        `<div class="source"><strong>${esc(s.id)}</strong><br><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a><br>Retrieved ${esc(s.retrievedAt)} · ${integer(s.bytes)} original response bytes<br>Response SHA-256: <code>${esc(s.sha256)}</code><br>${s.storageKind === "curated-report-extract" ? `Curated extract SHA-256: <code>${esc(s.extractSha256)}</code><br>Extract: ${esc(s.extractFile)} · ${integer(s.extractBytes)} bytes · accession ${esc(s.accession)}. Offline checks verify this extract and its provenance binding. The full report is not packaged; its original response hash is recorded above for separate verification.` : `Pinned factual-response gzip SHA-256: <code>${esc(s.storedSha256)}</code>`}</div>`,
    )
    .join("");
  $("audit").hidden = false;
  $("load-status").hidden = true;
  const params = new URL(location.href).searchParams,
    company = data.companies.some((c) => c.id === params.get("company"))
      ? params.get("company")
      : "msft",
    year = ["2025", "2026"].includes(params.get("year"))
      ? params.get("year")
      : "2026";
  choose(
    company,
    year,
    params.get("scope") || "threeAccounts",
    params.get("account") || "payables",
  );
  $("company").addEventListener("change", () => {
    selectedCompany = data.companies.find((c) => c.id === $("company").value);
    setScopes($("scope").value);
    render();
  });
  $("year").addEventListener("change", render);
  $("scope").addEventListener("change", render);
  $("account").addEventListener("change", renderFacts);
  $("bridge-rows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-inspect]");
    if (!button) return;
    $("account").value = button.dataset.inspect;
    renderFacts();
    $("fact-title").scrollIntoView({ block: "start" });
    $("account").focus({ preventScroll: true });
  });
  $("case-sign").addEventListener("click", () =>
    choose("msft", 2026, "threeAccounts", "payables"),
  );
  $("case-offset").addEventListener("click", () =>
    choose("cost", 2026, "inventoryPayables", "inventory"),
  );
  $("export").addEventListener("click", exportReview);
  let resize;
  window.addEventListener("resize", () => {
    clearTimeout(resize);
    resize = setTimeout(chart, 120);
  });
} catch (error) {
  $("load-status").textContent =
    `The pinned evidence could not load: ${error.message}. The dataset link below remains available.`;
  $("load-status").hidden = false;
  $("load-fallback").hidden = false;
}
