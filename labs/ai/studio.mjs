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
const $ = (s) => document.querySelector(s);
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pin = (url, date) => url.replace("/current/", "/on/" + date + "/");
let items, manifest, verification, state, toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 3500);
}
function syncURL() {
  history.replaceState(null, "", stateSearch(state) + location.hash);
}
function focusInspector() {
  const heading = $("#inspector-content h2");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
  $("#case-inspector").scrollIntoView({ block: "start", behavior: "instant" });
}
function returnToCases() {
  const selected = $(".case[aria-current=true]");
  $("#case-browser").scrollIntoView({ block: "start", behavior: "instant" });
  if (selected) {
    selected.focus({ preventScroll: true });
    selected.scrollIntoView({ block: "nearest", behavior: "instant" });
  }
}
function selectItem(id) {
  const scroll = $("#case-list").scrollTop;
  state.id = id;
  if (!filterItems(items, state).some((i) => i.id === id)) {
    state = { ...state, query: "", domain: "all", type: "all", paired: false };
    updateControls();
    toast("Opened the paired case. Filters cleared to include it.");
  }
  syncURL();
  render();
  $("#case-list").scrollTop = scroll;
}

function evidence(item) {
  const record = verification.results.find((r) => r.item_id === item.id);
  return `<section class="evidence" aria-label="Authoritative source evidence"><div class="evidence-top"><h3 class="section-label">PRIMARY SOURCE ANCHOR</h3><a href="${escape(pin(item.source.url, item.verification.source_edition_date))}" target="_blank" rel="noopener">Open dated regulation ↗︎</a></div><blockquote>“${escape(item.source.anchor_text)}”</blockquote><p class="citation">${escape(item.source.clause)}</p><div class="evidence-foot"><span>${record?.ok ? (record.anchor_in_cited_paragraph === true ? "✓ Anchor verified in cited paragraph" : "✓ Anchor found in source section") : "Verification unavailable"}</span><span>Edition ${escape(item.verification.source_edition_date)}</span><span>Historical verification · not rechecked live</span></div></section>`;
}
function referencePanel(item) {
  return `<div class="answer-grid"><section class="reference"><h3 class="section-label">${item.item_type === "category_error" ? "REFERENCE · REJECT THE PREMISE" : "REFERENCE ANSWER"}</h3><p>${escape(item.correct_answer)}</p></section><section class="adjacent"><h3 class="section-label">ADJACENT WRONG ANSWER</h3><h3>${escape(item.adjacent_wrong.label)}</h3><p>${escape(item.adjacent_wrong.answer)}</p><span class="authored">Authored failure probe · not model output</span></section></div><div class="risk-note"><strong>Why the distinction matters ↗︎</strong><p>${escape(item.adjacent_wrong.why_dangerous)}</p></div>${evidence(item)}`;
}
function pairPanel(item) {
  const pair = counterpart(items, item);
  if (!pair)
    return `<div class="empty"><strong>This case stands alone.</strong><p>No paired member is defined in the source corpus. Inspect its evidence and scoring contract independently.</p><button id="find-pairs">Explore paired cases →</button></div>${evidence(item)}`;
  return `<p class="panel-intro">Same question family. A different regulated entity or condition. Assess both answers together to test discrimination.</p><div class="pair-grid">${[item, pair].map((p, index) => `<section class="pair-card ${index === 0 ? "current" : ""}"><div class="pair-id"><strong>${escape(p.id.toUpperCase())}</strong><span>${index === 0 ? "Selected case" : "Paired contrast"} · ${escape(p.pair_role.toUpperCase())}</span></div><h3>${escape(p.question)}</h3><span class="section-label">REFERENCE ANSWER</span><p>${escape(p.correct_answer)}</p><a href="${escape(pin(p.source.url, p.verification.source_edition_date))}" target="_blank" rel="noopener">${escape(p.source.clause)} ↗︎</a>${index === 1 ? `<br><button data-select="${escape(p.id)}">Inspect ${escape(p.id.toUpperCase())} →</button>` : ""}</section>`).join("")}</div><p class="contract-note"><strong>Pair success is stricter.</strong> Both members must be answered correctly. Getting one right by topic association does not demonstrate the ability to distinguish them. This view contains reference answers only; no pair accuracy has been measured.</p>`;
}
function rubricPanel(item) {
  const category = item.item_type === "category_error";
  const rows = [
    [
      "Response policy",
      category
        ? "Reject the false premise. Do not invent a value or requirement. The corpus accepts abstention for this case."
        : "Answer from the cited evidence. This is an answerable factual item; the corpus does not mark abstention as acceptable.",
    ],
    [
      "Concept coverage",
      `Assess all ${item.answer_key.required_concepts.length} required concept groups in context. Alternatives within each group are lexical cues, not a complete semantic correctness test.`,
    ],
    [
      "Entity fidelity",
      "Check whether the response answers the entity and conditions in the question. A plausible statement about its neighboring entity is a substitution error.",
    ],
    [
      "Citation support",
      "Confirm the cited clause supports the specific claim. A topical citation or a citation to the neighboring clause is insufficient.",
    ],
    [
      "Separate reporting",
      category
        ? "Report category-error handling separately from the 63 factual cases; do not fold premise rejection into factual accuracy."
        : "Report factual accuracy, adjacent substitution, citation correctness and abstention/coverage separately. Count paired success only if both members pass.",
    ],
  ];
  return `<p class="panel-intro">An evaluation contract for this case. These checks explain the design; this studio does not score or call a model.</p>${rows.map(([label, desc], i) => `<div class="rubric-row"><span class="num">0${i + 1}</span><strong>${label}</strong><p>${escape(desc)}</p></div>`).join("")}<details class="concepts"><summary>Inspect the source answer key · ${item.answer_key.required_concepts.length} concept groups</summary><ol>${item.answer_key.required_concepts.map((g) => `<li>${g.map(escape).join(' <span aria-label="or">/</span> ')}</li>`).join("")}</ol><p><strong>Forbidden concept groups:</strong> ${item.answer_key.forbidden_concepts.length ? item.answer_key.forbidden_concepts.map((g) => g.map(escape).join(" / ")).join("; ") : "None specified."}</p><p><strong>Numeric facts:</strong> ${item.answer_key.numeric_facts.length ? item.answer_key.numeric_facts.map((n) => `${escape(n.label)}: ${escape(n.value)} ${escape(n.unit)} (absolute tolerance ${escape(n.tolerance_abs)})`).join("; ") : "None specified."}</p><p><strong>Authored adjacency signatures:</strong> ${item.adjacent_wrong.signature_terms.map(escape).join(" · ")}</p></details><p class="contract-note"><strong>Answer or abstain is not a single accuracy score.</strong> Uncertainty-driven abstention should be reported as coverage. False-premise rejection is a separate capability. The corpus documents limitations in its lexical abstention detector; a reference answer that rejects a premise may not use the detector’s cue words.</p>`;
}
function renderInspector(item) {
  if (!item) {
    $("#inspector-content").innerHTML =
      '<div class="empty"><strong>No cases match these filters.</strong><p>Try a broader concept, choose another domain, or reset the filters.</p><button id="reset-inspector">Reset filters</button></div>';
    $("#reset-inspector").onclick = reset;
    return;
  }
  const pair = counterpart(items, item);
  const matches = filterItems(items, state);
  const index = matches.findIndex((i) => i.id === item.id);
  $("#inspector-content").innerHTML =
    `<div class="inspector-mobilebar"><button data-return>← Back to ${matches.length} cases</button><span>${escape(item.id.toUpperCase())} · ${index + 1} of ${matches.length}</span></div><div class="inspector-head"><div class="case-path"><span class="case-id">${escape(item.id)}</span><span class="separator">/</span><span>${escape(DOMAIN_LABELS[item.domain])}</span><span class="pill ${item.item_type === "category_error" ? "amber" : ""}">${item.item_type === "category_error" ? "False premise" : "Factual"}</span></div><div class="actions"><button id="copy-link" title="Copy a deep link to this case">Copy link ↗︎</button><button id="export">Export brief ↓</button></div></div><div class="question-block"><div class="question-label"><span>THE QUESTION</span><span class="risk">${escape(item.risk_tier.toUpperCase())} RISK · CORPUS LABEL</span></div><h2>${escape(item.question)}</h2><div class="question-meta"><span>${escape(item.source.standard)} · Public primary source</span><span>${pair ? "⇄ Paired with " + escape(pair.id.toUpperCase()) : "Standalone case"}</span></div></div><div class="tabs" role="tablist" aria-label="Inspection views">${[
      ["evidence", "Evidence & risk", ""],
      ["pair", "Minimal pair", pair ? "2" : "—"],
      ["rubric", "Scoring contract", ""],
    ]
      .map(
        ([id, label, count]) =>
          `<button id="tab-${id}" role="tab" aria-selected="${state.tab === id}" aria-controls="inspection-panel" tabindex="${state.tab === id ? "0" : "-1"}" data-tab="${id}">${label}${count ? `<span>${count}</span>` : ""}</button>`,
      )
      .join(
        "",
      )}</div><div class="panel" id="inspection-panel" role="tabpanel" tabindex="0" aria-labelledby="tab-${state.tab}">${state.tab === "evidence" ? referencePanel(item) : state.tab === "pair" ? pairPanel(item) : rubricPanel(item)}</div><div class="inspector-foot"><button data-step="-1" ${index <= 0 ? "disabled" : ""}>← Previous case</button><span>CASE ${index + 1} OF ${matches.length}</span><button data-step="1" ${index >= matches.length - 1 ? "disabled" : ""}>Next case →</button></div>`;
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      state.tab = btn.dataset.tab;
      syncURL();
      renderInspector(item);
      $("#tab-" + state.tab).focus();
    };
    btn.onkeydown = (e) => {
      const tabs = ["evidence", "pair", "rubric"];
      let index = tabs.indexOf(state.tab);
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      index =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? 2
            : (index + (e.key === "ArrowRight" ? 1 : 2)) % 3;
      state.tab = tabs[index];
      syncURL();
      renderInspector(item);
      $("#tab-" + state.tab).focus();
    };
  });
  document.querySelectorAll("[data-select]").forEach(
    (btn) =>
      (btn.onclick = () => {
        selectItem(btn.dataset.select);
        focusInspector();
      }),
  );
  document
    .querySelectorAll("[data-return]")
    .forEach((btn) => (btn.onclick = returnToCases));
  document.querySelectorAll("[data-step]").forEach(
    (btn) =>
      (btn.onclick = () => {
        const target = matches[index + Number(btn.dataset.step)];
        if (target) {
          selectItem(target.id);
          focusInspector();
        }
      }),
  );
  if ($("#find-pairs"))
    $("#find-pairs").onclick = () => {
      state.domain = "all";
      state.type = "all";
      state.query = "";
      state.paired = true;
      updateControls();
      render();
      syncURL();
    };
  $("#copy-link").onclick = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast("Case link copied.");
    } catch {
      toast("Copy the current address to share this view.");
    }
  };
  $("#export").onclick = () => {
    const data =
      JSON.stringify(
        {
          ...brief(item, items, manifest),
          inspection_context: {
            permalink: location.href,
            filters: {
              query: state.query,
              domain: state.domain,
              type: state.type,
              paired: state.paired,
            },
            view: state.tab,
            matching_cases: matches.map((i) => i.id),
          },
          source_verification: {
            generated_utc: verification.generated_utc,
            edition_date: verification.ecfr_edition_date,
            records: verification.results.filter((r) =>
              [item.id, pair?.id].includes(r.item_id),
            ),
          },
          dated_sources: [item, ...(pair ? [pair] : [])].map((i) => ({
            item_id: i.id,
            url: pin(i.source.url, i.verification.source_edition_date),
            clause: i.source.clause,
          })),
        },
        null,
        2,
      ) + "\n";
    const url = URL.createObjectURL(
      new Blob([data], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `grounding-brief-${item.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Evaluation brief exported with provenance.");
  };
}
function render() {
  const filtered = filterItems(items, state);
  if (filtered.length && !filtered.some((i) => i.id === state.id))
    state.id = filtered[0].id;
  $("#result-count").textContent = `${filtered.length} / ${items.length}`;
  $("#case-list").innerHTML = filtered.length
    ? filtered
        .map(
          (item) =>
            `<button class="case" data-item="${escape(item.id)}" aria-current="${state.id === item.id}"><span class="case-top"><span class="case-id">${escape(item.id)}</span><span>${escape(DOMAIN_LABELS[item.domain])}</span></span><span class="case-question">${escape(item.question)}</span><span class="case-bottom"><span>${item.item_type === "category_error" ? "False premise" : "Factual"}</span>${item.pair_id ? '<span class="pair-indicator">⇄ Minimal pair</span>' : ""}</span></button>`,
        )
        .join("")
    : '<div class="empty"><strong>No matching cases</strong><p>Search a concept such as “ventilation”, or reset your filters.</p><button id="reset-list">Reset filters</button></div>';
  document.querySelectorAll("[data-item]").forEach(
    (btn) =>
      (btn.onclick = () => {
        state.id = btn.dataset.item;
        syncURL();
        document
          .querySelectorAll("[data-item]")
          .forEach((b) =>
            b.setAttribute("aria-current", String(b.dataset.item === state.id)),
          );
        renderInspector(items.find((i) => i.id === state.id));
        if (matchMedia("(max-width:600px)").matches) focusInspector();
      }),
  );
  if ($("#reset-list")) $("#reset-list").onclick = reset;
  document
    .querySelectorAll("[data-domain]")
    .forEach((btn) =>
      btn.setAttribute(
        "aria-pressed",
        String(state.domain === btn.dataset.domain),
      ),
    );
  renderInspector(filtered.find((i) => i.id === state.id));
  syncURL();
}
function updateControls() {
  $("#search").value = state.query;
  $("#domain").value = state.domain;
  $("#type").value = state.type;
  $("#paired").checked = state.paired;
}
function reset() {
  state = { ...state, query: "", domain: "all", type: "all", paired: false };
  updateControls();
  render();
}
async function init() {
  manifest = await fetch("./data/manifest.json").then((r) => {
    if (!r.ok) throw Error("Manifest unavailable");
    return r.json();
  });
  const files = manifest.files.filter((f) =>
    f.source_path.startsWith("corpus/items/"),
  );
  const domains = await Promise.all(
    files.map((f) =>
      fetch("./data/" + f.file).then((r) => {
        if (!r.ok) throw Error("Corpus unavailable");
        return r.json();
      }),
    ),
  );
  verification = await fetch("./data/source_verification.json").then((r) =>
    r.json(),
  );
  items = flatten(domains);
  const s = stats(items);
  state = parseState(location.search, items);
  $("#stat-total").textContent = s.total;
  $("#stat-types").textContent =
    `${s.factual} factual · ${s.category} false premises`;
  $("#stat-pairs").textContent = s.pairs;
  $("#stat-verified").innerHTML =
    `${verification.n_ok}<span>/${s.total}</span>`;
  $("#source-sha").innerHTML =
    `<a href="${manifest.repository}/tree/${manifest.commit}" target="_blank" rel="noopener"><code>${manifest.commit.slice(0, 12)}</code> ↗︎</a>`;
  for (const [id, label] of Object.entries(DOMAIN_LABELS)) {
    $("#domain").insertAdjacentHTML(
      "beforeend",
      `<option value="${id}">${label}</option>`,
    );
  }
  $("#domain-chart").innerHTML = Object.entries(DOMAIN_LABELS)
    .sort(
      (a, b) =>
        items.filter((i) => i.domain === b[0]).length -
        items.filter((i) => i.domain === a[0]).length,
    )
    .map(([id, label]) => {
      const n = items.filter((i) => i.domain === id).length;
      return `<button class="domain-bar" data-domain="${id}" aria-label="Filter ${label}, ${n} cases" aria-pressed="false"><span>${label}</span><span><i style="width:${(n / 12) * 100}%"></i></span><b>${n}</b></button>`;
    })
    .join("");
  document.querySelectorAll("[data-domain]").forEach(
    (btn) =>
      (btn.onclick = () => {
        state.domain =
          state.domain === btn.dataset.domain ? "all" : btn.dataset.domain;
        updateControls();
        render();
      }),
  );
  $("#search").oninput = (e) => {
    state.query = e.target.value;
    render();
  };
  $("#domain").onchange = (e) => {
    state.domain = e.target.value;
    render();
  };
  $("#type").onchange = (e) => {
    state.type = e.target.value;
    render();
  };
  $("#paired").onchange = (e) => {
    state.paired = e.target.checked;
    render();
  };
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "/" &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(
        document.activeElement.tagName,
      ) &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      e.preventDefault();
      $("#search").focus();
    }
  });
  document.querySelectorAll("[data-start]").forEach(
    (btn) =>
      (btn.onclick = () => {
        state = {
          ...state,
          id: btn.dataset.start,
          domain: "all",
          query: "",
          paired: false,
          type: "all",
          tab: "evidence",
        };
        updateControls();
        render();
        focusInspector();
      }),
  );
  if (matchMedia("(max-width:600px)").matches) $(".coverage").open = false;
  window.addEventListener("popstate", () => {
    state = parseState(location.search, items);
    updateControls();
    render();
  });
  updateControls();
  render();
}
init().catch((error) => {
  console.error(error);
  $("#inspector-content").innerHTML =
    '<div class="empty"><strong>The corpus could not be loaded.</strong><p>Reload to try again, or inspect the <a href="data/manifest.json">static provenance manifest</a>.</p></div>';
  $("#result-count").textContent = "Unavailable";
});
