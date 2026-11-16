# Selected-account cash-flow evidence audit

This independent operational-finance audit compares two different disclosed quantities. It does **not** estimate policy cash release or rank companies.

- Microsoft: receivables, inventory and accounts payable; an optional common inventory/payables subset.
- Costco: inventory and accounts payable only. A separate receivables operating adjustment is not identified in the cash-flow statement; absence is never imputed as zero.
- Fiscal 2025 and 2026, using each year's original 10-K accession. The actual reporting dates differ by company.

## Reproduce offline

```sh
python3 scripts/finance_filings/build.py --check
python3 -m unittest discover -s scripts/finance_filings -p 'test_*.py' -v
```

`build.py` verifies the compressed and decompressed hashes of the complete **factual CompanyFacts responses**. For annual reports it verifies only the **curated extract bytes**, their original-source provenance binding, the 200-word prose limit per report, and exact membership of displayed quotations in those extracts. It deterministically builds `labs/finance/filings.data.json`. All dependencies are in Python's standard library.

The public repository does **not** contain complete corporate annual-report HTML. `sources/*.extract.json` contains two selected excerpts per report: 70 quoted prose words for each Microsoft report, and selected financial-table facts for each Costco report. Each extract records the original URL, accession, retrieval time, full-response SHA-256/length and curation membership check. The manifest separately names `extractSha256`/`extractBytes`; these are never represented as hashes of the original report. Complete factual SEC CompanyFacts responses remain compressed with mtime=0. CompanyFacts is a current retrieved snapshot, not an archival capture made on the original filing date.

### Verify original reports separately

```sh
python3 scripts/finance_filings/verify_originals.py --online
```

This opt-in operation retrieves the four original URLs into memory, checks each full response against its recorded SHA-256/length, and checks every excerpt against whitespace-normalized source text. It does not store or republish the full reports. If a publisher changes the response, the original hash check fails rather than silently updating the evidence. Network availability is not needed for the ordinary offline build.

The original reports used during analysis are retained only in the local archive outside this public repository. When that archive is available, the same verification can run without network access:

```sh
python3 scripts/finance_filings/verify_originals.py --local-originals /workspace/release-artifacts/finance-filings-originals
```

For a **new**, separately reviewable local discovery snapshot:

```sh
python3 scripts/finance_filings/fetch.py --destination /workspace/release-artifacts/new-finance-snapshot
```

This requires a nonexistent destination **outside the public repository** and does not change the pinned inputs or public output. Full reports in this local snapshot must not be committed or rehosted. A newer SEC snapshot is evidence to review, not an automatic replacement. The dataset is intentionally not a live feed.

## Selection and signs

Exact namespace/tag, USD unit, start/end dates, original accession, form 10-K and filing date are required. The opening balance comes from that same filing. The fiscal-year label and frame are not selection keys: comparative facts can carry the later report's fiscal-year label. Repeated identical facts collapse with a count; conflicts fail. Later annual observations and same-day alternate filings/amendments are retained separately; they never overwrite the selected value. Missing coverage raises an error instead of returning zero.

Asset balance proxy = opening − closing. Liability balance proxy = closing − opening. SEC's `IncreaseDecreaseInAccountsReceivable` and `IncreaseDecreaseInInventories` values are multiplied by −1; `IncreaseDecreaseInAccountsPayable` by +1. These signs were independently checked against the readable reports. Residual = reported operating cash-flow adjustment − balance proxy. Gross absolute residual = sum of absolute component residuals. Net agreement can result from cancellation.

Amounts are integer USD in the SEC feed but disclosed in whole millions. If each input is rounded to the nearest million, the residual's conservative uncertainty is ±1.5 million per account (three rounded amounts), **not a statistical confidence interval**. Costco's FY2026 +2 million net residual may be indistinguishable from zero at that precision; the +55/−53 million component differences remain material relative to rounding.

## Interpretation boundaries

The Microsoft FY2026 three-account sign mismatch is a finding about these selected statement lines, not total working capital or total operating cash flow. Costco's two-account data cannot be ranked against Microsoft's three-account data. A common two-account view aligns arithmetic scope but does not establish economic comparability.

Microsoft Note 6 confirms property-and-equipment purchases in accounts payable. Its FY2026 change is 19.8 billion, which does **not** equal the 9.424 billion accounts-payable residual. The note is evidence of mixed scope, not a quantified reconciliation. Foreign-currency translation, acquisitions, noncash activity and classification can affect balance changes; this audit leaves their individual contributions unallocated. Costco's noncash capital-expenditure disclosure says liabilities, not specifically accounts payable.

The public JSON includes every selected raw fact, its sign treatment, exact vintage, later comparative observations, eight curated source excerpts, the original response hashes and separately identified extract hashes. UI exports bind that full dataset to the selected scope and exact downloaded dataset bytes using SHA-256.
