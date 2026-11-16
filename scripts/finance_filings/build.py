#!/usr/bin/env python3
"""Offline, deterministic audit of selected operating-asset/liability changes.

Uses pinned SEC CompanyFacts; never selects by frame, FY label, or latest value.
Run: python3 scripts/finance_filings/build.py [--check]
"""

from __future__ import annotations
import argparse, datetime as dt, gzip, hashlib, json, pathlib
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCES = pathlib.Path(__file__).parent / "sources"
OUTPUT = ROOT / "labs/finance/filings.data.json"
AS_OF = "2026-11-16"
COMPANIES = [
    {
        "id": "msft",
        "name": "Microsoft",
        "business": "Software, cloud and devices",
        "cik": "0000789019",
        "accounts": ["receivables", "inventory", "payables"],
        "years": [
            {
                "fy": 2025,
                "start": "2024-07-01",
                "end": "2025-06-30",
                "opening": "2024-06-30",
                "accession": "0000950170-25-100235",
                "filed": "2025-07-30",
                "reportSource": "msft-ar25",
            },
            {
                "fy": 2026,
                "start": "2025-07-01",
                "end": "2026-06-30",
                "opening": "2025-06-30",
                "accession": "0001193125-26-323660",
                "filed": "2026-07-29",
                "reportSource": "msft-ar26",
            },
        ],
    },
    {
        "id": "cost",
        "name": "Costco",
        "business": "Membership warehouse retail",
        "cik": "0000909832",
        "accounts": ["inventory", "payables"],
        "years": [
            {
                "fy": 2025,
                "start": "2024-09-02",
                "end": "2025-08-31",
                "opening": "2024-09-01",
                "accession": "0000909832-25-000101",
                "filed": "2025-10-08",
                "reportSource": "cost-2025-10k",
            },
            {
                "fy": 2026,
                "start": "2025-09-01",
                "end": "2026-08-30",
                "opening": "2025-08-31",
                "accession": "0000909832-26-000093",
                "filed": "2026-10-07",
                "reportSource": "cost-2026-10k",
            },
        ],
    },
]
ACCOUNTS = {
    "receivables": {
        "label": "Accounts receivable, net",
        "balanceTag": "AccountsReceivableNetCurrent",
        "flowTag": "IncreaseDecreaseInAccountsReceivable",
        "cashSign": -1,
        "kind": "asset",
    },
    "inventory": {
        "label": "Inventory",
        "balanceTag": "InventoryNet",
        "flowTag": "IncreaseDecreaseInInventories",
        "cashSign": -1,
        "kind": "asset",
    },
    "payables": {
        "label": "Accounts payable",
        "balanceTag": "AccountsPayableCurrent",
        "flowTag": "IncreaseDecreaseInAccountsPayable",
        "cashSign": 1,
        "kind": "liability",
    },
}


class SelectionError(ValueError):
    pass


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def normalized_text(data):
    p = TextParser()
    p.feed(data.decode("utf-8"))
    return " ".join(" ".join(p.parts).split())


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_source(meta):
    """Verify complete factual responses, or the curated extract—not the full report."""
    if meta["storageKind"] == "curated-report-extract":
        stored = (SOURCES / meta["extractFile"]).read_bytes()
        if sha(stored) != meta["extractSha256"] or len(stored) != meta["extractBytes"]:
            raise SelectionError(
                "Curated extract digest/length mismatch: " + meta["id"]
            )
        extract = json.loads(stored)
        binding = {
            "sourceId": meta["id"],
            "originalUrl": meta["url"],
            "accession": meta["accession"],
            "originalResponseSha256": meta["sha256"],
            "originalResponseBytes": meta["bytes"],
            "originalRetrievedAt": meta["retrievedAt"],
        }
        if any(extract.get(k) != v for k, v in binding.items()):
            raise SelectionError(
                "Curated extract provenance binding mismatch: " + meta["id"]
            )
        if extract.get(
            "schemaVersion"
        ) != "finance-report-extract/1" or not extract.get("excerpts"):
            raise SelectionError("Invalid curated extract structure")
        if any(
            x.get("kind") not in ["prose", "financial-table"]
            or not isinstance(x.get("text"), str)
            for x in extract["excerpts"]
        ):
            raise SelectionError("Invalid excerpt kind/text")
        count = sum(
            len(x["text"].split()) for x in extract["excerpts"] if x["kind"] == "prose"
        )
        if count != extract.get("quotedProseWordCount") or count > 200:
            raise SelectionError(
                "Report prose excerpt exceeds declared 200-word budget"
            )
        return extract
    if meta["storageKind"] != "complete-factual-response":
        raise SelectionError("Unknown source storage kind")
    stored = (SOURCES / meta["storedFile"]).read_bytes()
    if sha(stored) != meta["storedSha256"]:
        raise SelectionError("Stored factual response digest mismatch: " + meta["id"])
    raw = gzip.decompress(stored)
    if sha(raw) != meta["sha256"] or len(raw) != meta["bytes"]:
        raise SelectionError("Factual response digest/length mismatch: " + meta["id"])
    return raw


def verify_original(meta, raw, extract=None):
    """Separate full-response verification, requiring freshly fetched or local bytes."""
    if sha(raw) != meta["sha256"] or len(raw) != meta["bytes"]:
        raise SelectionError("Original response digest/length mismatch: " + meta["id"])
    if meta["storageKind"] == "curated-report-extract":
        evidence = read_source(meta) if extract is None else extract
        original_text = normalized_text(raw)
        for excerpt in evidence["excerpts"]:
            if excerpt["text"] not in original_text:
                raise SelectionError(
                    "Excerpt not found in original response: " + excerpt["id"]
                )
    return True


def select_fact(
    facts, tag, *, end, start=None, accession, filed, as_of=AS_OF, unit="USD"
):
    """Exact accession + period + unit. Identical repeats collapse; conflicts fail.

    filed is required and checked; a 10-K/A never silently replaces a pinned 10-K.
    The separate later-comparative ledger discloses eligible later annual observations.
    """
    if filed > as_of:
        raise SelectionError("Pinned filing is after the information cutoff")
    series = (
        facts.get("facts", {})
        .get("us-gaap", {})
        .get(tag, {})
        .get("units", {})
        .get(unit, [])
    )
    period = [x for x in series if x.get("end") == end and x.get("start") == start]
    exact = [
        x
        for x in period
        if x.get("accn") == accession
        and x.get("form") == "10-K"
        and x.get("filed") == filed
        and x["filed"] <= as_of
    ]
    if not exact:
        raise SelectionError(
            f"Missing exact fact: {tag} {start}/{end} {accession} {unit}"
        )
    values = {x["val"] for x in exact}
    if len(values) != 1:
        raise SelectionError(f"Conflicting exact facts: {tag} {accession}")
    value = next(iter(values))
    if isinstance(value, bool) or not isinstance(value, int):
        raise SelectionError("Expected integer USD fact")
    later = {}
    for x in period:
        if (
            x.get("accn") != accession
            and x.get("form") in ["10-K", "10-K/A"]
            and filed <= x.get("filed", "") <= as_of
        ):
            k = (x["accn"], x["filed"], x["form"], x["val"])
            later[k] = {
                "accession": k[0],
                "filed": k[1],
                "form": k[2],
                "value": k[3],
                "changed": k[3] != value,
            }
    return {
        "taxonomy": "us-gaap",
        "tag": tag,
        "unit": unit,
        "start": start,
        "end": end,
        "value": value,
        "accession": accession,
        "filed": filed,
        "form": "10-K",
        "identicalRows": len(exact),
        "laterAnnualObservations": [later[k] for k in sorted(later)],
    }


def bridge(opening, closing, flow, sign):
    if sign not in [-1, 1]:
        raise ValueError("Cash sign must be -1 for an asset or +1 for a liability")
    proxy = sign * (closing - opening)
    reported = sign * flow
    return {
        "balanceChange": closing - opening,
        "balanceProxy": proxy,
        "reportedAdjustment": reported,
        "residual": reported - proxy,
    }


def scope_total(rows, accounts):
    chosen = [x for x in rows if x["account"] in accounts]
    if len(chosen) != len(accounts):
        raise SelectionError("Cannot total an unavailable account as zero")
    result = {
        k: sum(x[k] for x in chosen)
        for k in ["balanceProxy", "reportedAdjustment", "residual"]
    }
    result["grossAbsoluteResidual"] = sum(abs(x["residual"]) for x in chosen)
    result["roundingBoundIfNearestMillion"] = 1500000 * len(chosen)
    result["offsettingResidual"] = result["grossAbsoluteResidual"] - abs(
        result["residual"]
    )
    result.update(
        accounts=accounts,
        signMismatch=result["balanceProxy"] * result["reportedAdjustment"] < 0,
    )
    return result


def quotation(extract, exact):
    if not any(x["text"] == exact for x in extract["excerpts"]):
        raise SelectionError(
            "Curated extract does not contain exact requested quotation: " + exact[:80]
        )
    return exact


def build():
    all_sources = json.loads((SOURCES / "manifest.json").read_text())
    sources = {s["id"]: s for s in all_sources}
    raw = {k: read_source(v) for k, v in sources.items()}
    companies = []
    for spec in COMPANIES:
        facts = json.loads(raw[spec["id"] + "-companyfacts"])
        years = []
        if str(facts["cik"]).zfill(10) != spec["cik"]:
            raise SelectionError("Company CIK mismatch")
        for period in spec["years"]:
            common = {"accession": period["accession"], "filed": period["filed"]}

            def pick(tag, end, start=None):
                fact = select_fact(facts, tag, end=end, start=start, **common)
                fact["sourceId"] = spec["id"] + "-companyfacts"
                return fact

            rows = []
            for account in spec["accounts"]:
                definition = ACCOUNTS[account]
                opening = pick(definition["balanceTag"], period["opening"])
                closing = pick(definition["balanceTag"], period["end"])
                flow = pick(definition["flowTag"], period["end"], period["start"])
                rows.append(
                    {
                        "account": account,
                        **definition,
                        "opening": opening,
                        "closing": closing,
                        "flow": flow,
                        **bridge(
                            opening["value"],
                            closing["value"],
                            flow["value"],
                            definition["cashSign"],
                        ),
                    }
                )
            scopes = {"inventoryPayables": scope_total(rows, ["inventory", "payables"])}
            if "receivables" in spec["accounts"]:
                scopes["threeAccounts"] = scope_total(
                    rows, ["receivables", "inventory", "payables"]
                )
            years.append(
                {
                    **period,
                    "days": (
                        dt.date.fromisoformat(period["end"])
                        - dt.date.fromisoformat(period["start"])
                    ).days
                    + 1,
                    "rows": rows,
                    "scopes": scopes,
                    "operatingCashFlow": pick(
                        "NetCashProvidedByUsedInOperatingActivities",
                        period["end"],
                        period["start"],
                    ),
                }
            )
        companies.append(
            {k: v for k, v in spec.items() if k != "years"} | {"years": years}
        )
    quotes = [
        {
            "id": "msft-ppe-2026",
            "sourceId": "msft-ar26",
            "section": "Note 6 — Property and Equipment",
            "quote": quotation(
                raw["msft-ar26"],
                next(
                    x["text"]
                    for x in raw["msft-ar26"]["excerpts"]
                    if x["id"] == "msft-ppe-2026"
                ),
            ),
            "supports": "Accounts payable includes property-and-equipment purchases. Its balance change is not a pure merchandise-supplier financing measure.",
            "doesNotEstablish": "The note does not reconcile the selected operating cash-flow adjustments to balance changes. Do not assign the residual to capital expenditure.",
        },
        {
            "id": "msft-fx",
            "sourceId": "msft-ar26",
            "section": "Note 1 — Accounting Policies / Foreign Currencies",
            "quote": quotation(
                raw["msft-ar26"],
                next(
                    x["text"]
                    for x in raw["msft-ar26"]["excerpts"]
                    if x["id"] == "msft-fx"
                ),
            ),
            "supports": "Reported balance changes can include translation effects.",
            "doesNotEstablish": "The source does not allocate a quantified translation effect to this audit’s three-account residual.",
        },
        {
            "id": "cost-other",
            "sourceId": "cost-2026-10k",
            "section": "Consolidated Statements of Cash Flows",
            "quote": quotation(
                raw["cost-2026-10k"],
                next(
                    x["text"]
                    for x in raw["cost-2026-10k"]["excerpts"]
                    if x["id"] == "cost-other"
                ),
            ),
            "supports": "The statement separately reports merchandise inventories and accounts payable; other operating balances are grouped.",
            "doesNotEstablish": "No separately reported receivables cash-flow adjustment is identified here. Missing coverage is not zero.",
        },
        {
            "id": "cost-capex",
            "sourceId": "cost-2026-10k",
            "section": "Consolidated Statements of Cash Flows / Supplemental disclosure",
            "quote": quotation(
                raw["cost-2026-10k"],
                next(
                    x["text"]
                    for x in raw["cost-2026-10k"]["excerpts"]
                    if x["id"] == "cost-capex"
                ),
            ),
            "supports": "The filing discloses noncash capital expenditure in liabilities.",
            "doesNotEstablish": "The disclosure says liabilities, not exclusively accounts payable, and does not reconcile this two-account residual.",
        },
    ]
    for q in quotes:
        q["fiscalYear"] = 2026
    for q in list(quotes):
        prior = q.copy()
        prior["id"] = q["id"] + "-prior"
        prior["fiscalYear"] = 2025
        prior["sourceId"] = (
            "msft-ar25" if q["sourceId"] == "msft-ar26" else "cost-2025-10k"
        )
        prior["quote"] = next(
            x["text"]
            for x in raw[prior["sourceId"]]["excerpts"]
            if x["id"] == prior["id"]
        )
        quotation(raw[prior["sourceId"]], prior["quote"])
        quotes.append(prior)
    return {
        "schemaVersion": "finance-filings-audit/1",
        "asOf": AS_OF,
        "title": "Can balance changes stand in for operating cash-flow adjustments?",
        "amountUnit": "USD",
        "method": {
            "selection": "Each fiscal year uses its own pinned original 10-K accession and filing date, including the opening balance reported in that filing. Require exact USD unit and exact start/end dates; instant facts have no start. Identical repeats collapse; conflicting values fail. No frame/FY-label/latest-value heuristic. Later or same-day alternate annual observations are recorded separately and never substituted. No amended 10-K is silently substituted.",
            "proxy": "For each selected asset: opening balance − closing balance. For accounts payable: closing balance − opening balance.",
            "reported": "Multiply IncreaseDecreaseInAccountsReceivable and IncreaseDecreaseInInventories by −1; multiply IncreaseDecreaseInAccountsPayable by +1. These signs match the displayed cash-flow statements.",
            "residual": "Reported operating adjustment minus balance-change proxy. This difference is unreconciled in this selected-account audit. It is not an attributed reconciliation or an assertion of financial-statement error.",
            "scope": "Only the selected accounts. Not total working capital, total operating cash flow, free cash flow, policy cash release, or an efficiency measure. Company fiscal periods differ. Do not rank the companies using unequal three-account/two-account coverage.",
            "precision": "Integer USD facts at published precision. The statements display whole USD millions. If each amount is rounded to the nearest million, three terms per account imply a conservative residual uncertainty bound of ±$1.5 million per account (±$3 million for two; ±$4.5 million for three). This is a conditional rounding bound, not a statistical confidence interval. Zero residual would establish arithmetic agreement, not causal equivalence.",
            "vintage": "Point-in-time at the pinned annual filing, as represented in the retrieved SEC CompanyFacts snapshot. Original response hashes record the full reports retrieved at curation; compact extracts preserve selected readable evidence. Offline checks verify extract integrity and provenance binding, not unavailable full-report bytes. This is not a reconstructed historical SEC API snapshot.",
            "causalLimit": "FX, acquisitions, disposals, noncash changes and classification/scope can create differences. This audit does not quantify their contributions and makes no attribution unless a complete bridge is disclosed.",
        },
        "sources": all_sources,
        "companies": companies,
        "evidence": quotes,
        "excludedCoverage": [
            {
                "company": "cost",
                "account": "receivables",
                "status": "not-separately-identified",
                "reason": "Cash-flow statement reports Other operating assets and liabilities, net; a standalone receivables adjustment was not identified. It is excluded, never filled with zero.",
            }
        ],
    }


def output_bytes(result):
    return (json.dumps(result, indent=2, ensure_ascii=False) + "\n").encode()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = output_bytes(build())
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != data:
            raise SystemExit("Generated filings.data.json is stale")
        print(
            "Verified factual-response hashes, curated-extract integrity/bindings and deterministic filings.data.json; full report verification is separate"
        )
    else:
        OUTPUT.write_bytes(data)
        print(f"Wrote {OUTPUT}: {len(data):,} bytes")
