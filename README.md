# Priyatham Chimmani — Personal portfolio

The original rich portfolio, evolved with independent working labs and server verification. Original Archivo typography, light/dark themes, evidence-led name hero, architecture map, work filters, research, reports, experience, awards, education, certifications, and command palette are preserved. Optional GSAP animation loads from a CDN; all content remains visible when it is unavailable. Run `node scripts/dev-server.mjs` and open http://127.0.0.1:8000 for the portfolio and verification API. Set `PORT` to change the port. No packages or build step are required for local development. A static-only server also serves the pages, but server verification requires the API.

- `index.html`: rich original portfolio with five independent focus areas and dedicated interactive labs.
- `assets/kit.css` and `assets/kit.js`: restored original shared navigation, mobile menu, and progressive enhancements.
- `assets/portfolio.css`: focused layout refinements, lab section, visible animation fallback, keyboard focus states, and reduced-motion support.
- `labs/`: standalone interactive demonstrations with synthetic defaults. Finance also accepts optional user-entered revenue and COGS assumptions, validates them locally, and compares day changes against a baseline using the same annual amounts. Share links include entered amounts; explicit verification submits the scenario to the stateless calculation endpoint.

The original portfolio remains available at https://priyatham-personal-site.vercel.app and is linked from both the header area and footer. Case studies link back to the original site. Research links point to the public research projects. Demonstrations are not employer production systems.

## Decision audits and empirical research

[Open the project directory](https://priyatham9.github.io/labs/) for the new contract-review, channel-decision and financial-policy workspaces, plus independent empirical research audits.

- [Data contract review](labs/foundry/contract.html): import local JSON, inspect typed dependencies and compare a proposed change with its baseline. Review bundles bind exact inputs and diagnostics with SHA-256. This is an independent prototype, not a live Palantir integration.
- [Local prediction review](labs/ai/prediction-audit.html): open a CSV with two score columns and binary outcomes, compare ranking and calibration on the same cohort, inspect records and export a source-bound review. Files are processed in memory without upload or browser storage. Includes an explicitly fetched public example with provenance.
- [CRM campaign evidence](labs/crm/campaign.html): inspect two fixed models on a chronological UCI Bank Marketing holdout, with explicit information timing, calibration, source order and record-level exports. This quantifies a documented leakage problem; it does not estimate causal campaign impact.
- [CRM decision audit](labs/crm/decision.html): separate customer-mix standardization from unresolved-outcome bounds using explicitly constructed cohorts.
- [Official-filings evidence audit](labs/finance/filings.html): compare selected Microsoft and Costco balance changes with the corresponding reported cash-flow adjustments, including exact filing vintages, account-level differences and rounding limits.
- [Financial decision audit](labs/finance/decision.html): compare hypothetical operating policies with their full modeled cash flows and costs, with frozen custom scenarios.
- [Research investigations](https://grounded-chi-five.vercel.app/investigations.html): public-data influence, fixed-format AI scoring, simulated inference and ontology translation fidelity.

New audit calculations run locally. The original applications and their verification API below remain available. Run `node --test labs/*/*.test.mjs` to verify the analytical models.

## Scenario verification API

`POST /api/analysis` with `Content-Type: application/json` accepts `{"model":"finance","inputs":{"dso":30,"dio":60,"dpo":30}}` or `{"model":"crm","inputs":{"cohort":"inbound","rate":0.5}}`. Finance additionally accepts revenue and cogs; omitted fields use lab defaults. CRM cohorts are all, inbound, and outbound. Responses include version, synthetic, model, normalized inputs, and result.

The stateless Node function shares the labs' pure formulas. It rejects unknown fields, nonnumeric values, negative values, rates above 1, days above 3650, dollar inputs above 1 trillion, and bodies above 4096 bytes. It requires no secrets, accounts, database, or external services. This verifies reproducibility of illustrative calculations, rather than real-world forecasting accuracy.

Run backend and HTTP checks with `node --test tests/analysis.test.mjs`.

### Browser regression checks

Install `playwright==1.62.0`, run `python -m playwright install chromium`, then
`python scripts/check_project_ui.py`. The script serves an isolated local copy
and checks review gates, frozen policy comparisons, invalid-input recovery,
source-bound exports and responsive layouts. These checks run in CI.

Run `python scripts/check_campaign_ui.py` and
`python scripts/check_prediction_ui.py` for the empirical campaign and local CSV
workflows. `node --test labs/ai/prediction-model.test.mjs` verifies parsing,
metrics, boundary cases and every public-example row against the frozen study.
