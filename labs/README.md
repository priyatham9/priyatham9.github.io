# Analytical projects

Independent public demonstrations by Priyatham Chimmani. Start at `/labs/`.
The personal homepage is maintained separately; this release changes the project
workspaces and their launch index only.

| Workspace | Data | Useful workflow |
| --- | --- | --- |
| Foundry | Five synthetic batches and normalized linked entities | Compare batches, inspect relationships, select evidence and export a local review draft |
| AI | 68 committed public benchmark cases, 23 minimal pairs | Search a case, inspect contrast and evidence, export an evaluation brief |
| CRM | Synthetic cumulative cohorts and a separate aging snapshot | Compare source conversions, select a transition, test a final-stage assumption and export |
| Finance | Illustrative baseline or visitor-entered assumptions | Change operating days, reconcile signed working capital and compare a temporary pinned scenario |
| EHS | Public OSHA aggregates in the independent `ehs-osha-analysis` project | Inspect annual patterns and peer groups with explicit aggregation limits |

## Run locally

From the repository root:

```sh
PORT=8140 node scripts/dev-server.mjs
```

The static workflows also work without the optional calculation API. CRM and
Finance show server verification only when a compatible endpoint is available.
No demonstration pretends to send an operational action or run a live language model.

## Validate

```sh
python3 -m unittest discover -s tests -v
node --test labs/models.test.mjs labs/signed-scale.test.mjs labs/scenario-tools.test.mjs labs/foundry/*.test.mjs labs/crm/*.test.mjs labs/finance/*.test.mjs labs/ai/*.test.mjs tests/analysis.test.mjs
python3 scripts/build_site.py
```

The AI corpus manifest records its original commit, paths, license and exact
artifact hashes. Its historical source verification is distinct from current
regulatory verification or model evaluation. The Foundry export deduplicates
shared laboratory measurements and preserves pending values as null. CRM stage
rates use explicit preceding-stage denominators; unadvanced leads are not
necessarily lost. Finance changes represent steady-state working-capital cash
requirements, not profit or guaranteed cash realization.

Financial inputs stay in the browser unless the visitor explicitly shares the
scenario URL or invokes compatible server verification. Pinned scenarios are
in-memory and disappear on reload. Exported files state their assumptions.

Optional browser checks require Playwright and its Chromium browser. Run
`python labs/ai/verify-browser.py` or `node labs/foundry/browser-check.cjs`
with the matching Python/Node Playwright package installed. Override deployment
URLs with `AI_STUDIO_URL` and `FOUNDRY_URL`. The AI accessibility script accepts
a locally installed `axe.min.js` path as its required argument.
