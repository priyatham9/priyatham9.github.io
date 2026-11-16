# UCI campaign decision-time audit

This study reproduces a **documented timing hazard** on real public records: UCI explicitly says last-call duration is unavailable before a call and is suitable only for retrospective benchmarking. The contribution is an inspectable, reproducible comparison and score ledger, not a new leakage theory or a marketing-allocation policy.

## Frozen design and first result

`protocol.json` was frozen before fitting models or inspecting holdout outcomes. Its exact SHA-256 is `8f847d7ad5cbbb71aa962dfdde9cfd3a34bb20dc594a4bb46268627ac9dc978b`. An independent reviewer verified the protocol, code and source-order boundary before the first evaluation. `execution-start.json` persisted the final analysis-source/protocol/data hashes and timestamp before fitting. The two fits converged in 403 and 350 iterations; no hyperparameter was changed after seeing results.

The official `bank-additional-full.csv` contains 41,188 rows and 20 inputs. The archive documentation says it is ordered by date, May 2008 through November 2010. The primary split preserves that order: rows **1–27,972** train; **27,973–41,188** are held out. The 70% target is moved backward to the final complete contiguous month-label block. There are 18 heldout blocks. **No full dates, years or client identities are reconstructed** from month/weekday labels; the same month name in separate runs remains a different block.

Both models use fixed L2 logistic regression (`C=1`, `lbfgs`, no class weights), training-only standardization and one-hot categories. Both use profile and previous-campaign fields under stated pre-call-availability assumptions. The second adds only standardized `log1p(duration_seconds)`. Both exclude current-call metadata (`contact`, `month`, `day_of_week`, `campaign`) and all five macroeconomic fields: their relevant decision-time or publication-vintage availability is not established. Profile/history timestamps are also absent, so the duration-excluded model is **not certified deployment-ready**.

| Heldout measure | Duration excluded | Duration included |
| --- | ---: | ---: |
| Noninterpolated average precision | 0.391838 | 0.533112 |
| Brier score, smaller is better | 0.199445 | 0.179244 |
| Logarithmic loss, smaller is better | 0.700339 | 0.687922 |
| Positives among top 1,322 recorded rows | 698 | 852 |
| Precision in that retrospective selection | 52.799% | 64.448% |

Training prevalence is **1,465 / 27,972 = 5.237%**; heldout prevalence is **3,175 / 13,216 = 24.024%**. Mean heldout model scores are only 9.915% and 10.436%, respectively. Better retrospective ranking does not establish pre-call usability or accurate probability calibration under this substantial shift. The constant training-prevalence predictor has heldout Brier 0.217818 and average precision equal to heldout prevalence, 0.240239.

These are observational associations on recorded outcomes, not incremental subscriptions, causal effects of longer calls, or gains from a new outreach policy. Even the fixed top-decile ranking sees the complete future evaluation batch; it is not an online budget allocation rule.

## Reproduce and verify

Python 3.12 with pinned dependencies:

```sh
python3 -m pip install -r scripts/crm_campaign_audit/requirements.txt
python3 -m unittest discover -s scripts/crm_campaign_audit -p 'test_*.py' -v
python3 scripts/crm_campaign_audit/build.py --check
```

The build forces BLAS/OMP threads to one before importing numerical libraries. `--check` verifies source, frozen protocol, execution-start and fitted-model digests; independently replays saved coefficients/scales/category dictionaries; and recomputes **every heldout score, ranking, aggregate metric, calibration bin, month-block result and paired resampling range**. It does not fit a new model. The public `campaign.data.json` contains all 13,216 heldout records, not a selected sample, and the parameters necessary for score replay.

The original one-time command was `python3 scripts/crm_campaign_audit/build.py --fit`. It now refuses to overwrite an existing artifact or execution-start record. To reproduce training from scratch, use an isolated checkout with those two generated artifacts absent while retaining the same frozen protocol, data and pinned dependencies. Do not replace a published study by silently refitting or altering its protocol. The published runtime is Python 3.12.14, NumPy 2.3.5, SciPy 1.17.0 and scikit-learn 1.8.0. Different numerical platforms can vary at floating-point precision; digest-bound verification is intentionally strict.

## Metric and uncertainty boundaries

- Average precision uses `average_precision_score`, the noninterpolated precision-recall summary. It is not trapezoidal PR-AUC. A batch with no positives produces null, not a fabricated zero.
- Brier is mean squared probability error; raw logistic outputs are **not recalibrated** using heldout labels. Calibration uses ten fixed equal-width probability bins, including empty bins.
- The retrospective budget is `ceil(0.10 * N)`. Exact score ties are broken by original source-row ordinal, never outcome. The browser's initial record maximizes the absolute probability difference, also without reading its outcome.
- Resampling draws the 18 entire heldout contiguous month-label blocks with replacement, using identical draws for both fixed models: 1,000 replicates, seed 20261116. The 2.5th–97.5th percentile ranges are **descriptive block-resampling sensitivity**, not independent-row or population confidence intervals. They omit training-estimation uncertainty. Blocks and repeated clients may remain dependent, and replicate sizes vary (3,901–32,909 rows here). All 1,000 draws had defined AP; the artifact records undefined counts explicitly.
- Month-block average precision also depends on each block's prevalence. Small blocks and severe mix changes limit comparisons. No alternate split, model search, validation-set tuning or calibrated operating threshold was introduced after results.

## Data, licensing and provenance

Official source: [UCI Bank Marketing](https://archive.ics.uci.edu/dataset/222/bank+marketing), DOI [10.24432/C5K306](https://doi.org/10.24432/C5K306). The dataset page explicitly identifies **Creative Commons Attribution 4.0 International (CC BY 4.0)**; see [license terms](https://creativecommons.org/licenses/by/4.0/).

Credit: Sérgio Moro, Paulo Cortez and Paulo Rita. Original associated study: *A Data-Driven Approach to Predict the Success of Bank Telemarketing*, Decision Support Systems (2014), [10.1016/j.dss.2014.03.001](https://doi.org/10.1016/j.dss.2014.03.001). The portal's generic API metadata mixes the older 45,211-row variant with descriptions of the newer release; this audit uses the **specific archive member and its bundled documentation**, not that generic count or the older `pdays=-1` definition.

`sources/manifest.json` pins the official outer archive, nested archive, exact CSV and documentation member hashes/lengths; it also records the official license statement and page hash. The CSV SHA-256 is `74adfc578bf77a7ff4bb1ba4a9f8709d9e3c6907342959c2c8416847e0afb4d8`. The public compressed CSV preserves the original bytes unchanged. Selected documentation excerpts record chronology, duration timing and the correct `pdays=999` sentinel. Full UCI HTML and irrelevant archive metadata are not republished. Changes are confined to derived features, fitted models, scores and the explanatory audit.

Optional independent official-source check:

```sh
python3 scripts/crm_campaign_audit/verify_source.py
```

This downloads the official archive into memory, verifies archive/member hashes and documentation excerpts, and confirms the current official page still displays the recorded CC BY 4.0 statement. It never replaces pinned evidence. Client IDs and full timestamps are absent; chronological validation cannot establish client-disjointness or event-time feature availability.
