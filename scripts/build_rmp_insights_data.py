#!/usr/bin/env python3
"""Build reports/rmp-accident-insights/data.json and the generated block of
reports/rmp-accident-insights/index.html from the committed CSVs and docs of
priyatham9/ehs-chemical-peers.

Every number on the page is copied from a CSV (formatted to two decimals, or
as an integer). The limitation bullets are verbatim bullets from the source
docs. The JSON records the source repo, the file paths and the commit SHA the
files were read at. Deterministic: no timestamps, fixed ordering.

Usage:
  python3 scripts/build_rmp_insights_data.py            # rewrite JSON and page block
  python3 scripts/build_rmp_insights_data.py --check    # exit 1 if stale
Sources: RMP_PEERS_CLONE=<path to a clone of ehs-chemical-peers> (default
/home/user/ehs-chemical-peers); files are read with `git show <RMP_PEERS_REF>:<path>`
(default ref origin/main), and the commit SHA is `git rev-parse` of that ref.
"""
import csv
import html
import io
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "reports", "rmp-accident-insights")
PAGE = os.path.join(DIR, "index.html")
DATA = os.path.join(DIR, "data.json")
BEGIN, END = "<!-- BEGIN RMP-DATA -->", "<!-- END RMP-DATA -->"
REPO = "priyatham9/ehs-chemical-peers"
CLONE = os.environ.get("RMP_PEERS_CLONE", "/home/user/ehs-chemical-peers")
REF = os.environ.get("RMP_PEERS_REF", "origin/main")

CSVS = {
    "trend": "outputs/trend_by_year.csv",
    "trend_tests": "outputs/trend_tests.csv",
    "severity": "outputs/severity_overall.csv",
    "industry": "outputs/accident_by_subsector.csv",
}
DOCS = {"insights": "docs/insights.md", "severity": "docs/severity.md", "trend": "docs/trend.md"}
SMALL_GROUP = 30  # facilities; below this docs/insights.md calls a group "small"

MEASURE_LABEL = {
    "any_injury": "Any injury", "onsite_injury": "Worker or responder injury",
    "offsite_injury": "Public (offsite) injury", "fatality": "At least one death",
    "evacuation": "Offsite evacuation", "sheltering": "Sheltering in place",
    "property_damage": "Property damage",
}


def git(*args):
    return subprocess.check_output(["git", "-C", CLONE] + list(args)).decode("utf-8")


def show(path):
    return git("show", "%s:%s" % (REF, path))


def rows(path):
    return list(csv.DictReader(io.StringIO(show(path))))


def build():
    sha = git("rev-parse", REF).strip()
    tr = rows(CSVS["trend"])
    tt = rows(CSVS["trend_tests"])[0]
    sev = rows(CSVS["severity"])
    ind = rows(CSVS["industry"])
    data = {
        "source": {
            "repo": REPO, "commit": sha,
            "csv_paths": CSVS, "doc_paths": DOCS,
            "note": "Values are copied as strings from the CSV cells at this commit.",
        },
        "trend": [{k: r[k] for k in ("year", "facility_years", "accidents", "rate_per_100fy", "rate_lo", "rate_hi")} for r in tr],
        "trend_tests": {k: tt[k] for k in (
            "facility_years", "accidents", "rate_ratio_per_year", "rr_lo", "rr_hi", "pct_change_per_year",
            "mk_p", "dispersion", "rate_2010_2014", "rate_2010_2014_lo", "rate_2010_2014_hi",
            "accidents_2010_2014", "facility_years_2010_2014", "rate_2020_2024", "rate_2020_2024_lo",
            "rate_2020_2024_hi", "accidents_2020_2024", "facility_years_2020_2024")},
        "severity": [{k: r[k] for k in ("measure", "accidents", "with_measure", "pct", "pct_lo", "pct_hi")} for r in sev],
        "industry": sorted(
            [{k: r[k] for k in ("group", "facilities", "facility_years", "accidents", "rate_per_100fy", "rate_lo", "rate_hi")} for r in ind],
            key=lambda r: -float(r["rate_per_100fy"])),
        "limitations": limitations(),
    }
    return data


def bullet(doc, lead):
    """The verbatim text of the markdown bullet that starts with **lead**."""
    m = re.search(r"^\* \*\*%s\*\* (.+)$" % re.escape(lead), show(doc), re.M)
    if not m:
        raise SystemExit("bullet %r not found in %s" % (lead, doc))
    t = re.sub(r"`([^`]*)`", r"\1", m.group(1))
    t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t)
    return {"lead": lead, "text": t, "doc": doc}


def limitations():
    return [
        dict(bullet("docs/trend.md", "Late years are under-observed."), topic="Recent years are under-observed"),
        dict(bullet("docs/severity.md", "RMP-covered facilities only."), topic="RMP-covered facilities only"),
        dict(bullet("docs/severity.md", "Not done."), topic="No initiating-event field"),
        dict(bullet("docs/severity.md", "Reporting thresholds."), topic="Only reportable accidents are on file"),
    ]


# ---------------------------------------------------------------- rendering
def f2(s):
    return "%.2f" % float(s)


def i0(s):
    return "{:,}".format(int(s))


def esc(s):
    return html.escape(s, quote=True)


def scale(v, lo, hi, a, b):
    return a + (float(v) - lo) / (hi - lo) * (b - a)


def nice_max(v, step):
    n = int(float(v) / step) + 1
    return n * step


def svg_trend(d):
    W, H, L, R, T, B = 560, 300, 44, 14, 16, 36
    yrs = d["trend"]
    ymax = nice_max(max(float(r["rate_hi"]) for r in yrs), 1)
    xs = lambda i: L + i * (W - L - R) / (len(yrs) - 1)
    ys = lambda v: scale(v, 0, ymax, H - B, T)
    o = ['<svg class="chart" viewBox="0 0 %d %d" role="img" aria-labelledby="t1 d1">' % (W, H),
         '<title id="t1">Accident records per 100 facility-years by year, with 95 percent Poisson intervals</title>',
         '<desc id="d1">Line chart from %s to %s. The table below the chart lists every value.</desc>' % (yrs[0]["year"], yrs[-1]["year"])]
    for k in range(0, int(ymax) + 1):
        y = ys(k)
        o.append('<line class="grid" x1="%d" x2="%d" y1="%.1f" y2="%.1f"/><text class="cv" x="%d" y="%.1f" text-anchor="end">%d</text>' % (L, W - R, y, y, L - 6, y + 4, k))
    # last three years are shaded as under-observed (docs/trend.md, Limitations)
    x0 = xs(len(yrs) - 3) - 6
    o.append('<rect class="shade" x="%.1f" y="%d" width="%.1f" height="%d"/><text class="cv" x="%.1f" y="%d" text-anchor="end">under-observed</text>' % (x0, T, W - R - x0, H - B - T, W - R - 4, T + 12))
    up = " ".join("%.1f,%.1f" % (xs(i), ys(r["rate_hi"])) for i, r in enumerate(yrs))
    dn = " ".join("%.1f,%.1f" % (xs(i), ys(r["rate_lo"])) for i, r in reversed(list(enumerate(yrs))))
    o.append('<polygon class="band" points="%s %s"/>' % (up, dn))
    o.append('<polyline class="ln" points="%s"/>' % " ".join("%.1f,%.1f" % (xs(i), ys(r["rate_per_100fy"])) for i, r in enumerate(yrs)))
    for i, r in enumerate(yrs):
        o.append('<circle class="pt" cx="%.1f" cy="%.1f" r="3.5"><title>%s: %s per 100 facility-years (%s to %s)</title></circle>' % (xs(i), ys(r["rate_per_100fy"]), r["year"], f2(r["rate_per_100fy"]), f2(r["rate_lo"]), f2(r["rate_hi"])))
        if i % 2 == 0 or i == len(yrs) - 1:
            o.append('<text class="cv" x="%.1f" y="%d" text-anchor="middle">%s</text>' % (xs(i), H - B + 16, r["year"]))
    o.append('<text class="cv" x="%d" y="%d">per 100 facility-years</text>' % (L, 11))
    o.append("</svg>")
    return "".join(o)


def svg_rows(items, label, val, lo, hi, fmt_val, fmt_interval, title, desc, ident, axis_step, hollow=None, unit=""):
    """Horizontal chart: label line, then a mark with interval whiskers."""
    W, L, R, RH, T = 560, 8, 8, 46, 22
    vmax = nice_max(max(float(hi(r)) for r in items), axis_step)
    H = T + RH * len(items) + 8
    xs = lambda v: scale(v, 0, vmax, L, W - R)
    o = ['<svg class="chart" viewBox="0 0 %d %d" role="img" aria-labelledby="t%s d%s">' % (W, H, ident, ident),
         '<title id="t%s">%s</title><desc id="d%s">%s</desc>' % (ident, esc(title), ident, esc(desc))]
    k = 0.0
    while k <= vmax + 1e-9:
        x = xs(k)
        o.append('<line class="grid" x1="%.1f" x2="%.1f" y1="%d" y2="%d"/><text class="cv" x="%.1f" y="12" text-anchor="middle">%s%s</text>' % (x, x, T - 4, H - 6, x, ("%g" % k), unit))
        k += axis_step
    for i, r in enumerate(items):
        y = T + i * RH
        cy = y + 30
        small = hollow and hollow(r)
        o.append('<text class="cl" x="%d" y="%d">%s</text>' % (L, y + 16, esc(label(r))))
        o.append('<line class="ci" x1="%.1f" x2="%.1f" y1="%d" y2="%d"/><line class="cap" x1="%.1f" x2="%.1f" y1="%d" y2="%d"/><line class="cap" x1="%.1f" x2="%.1f" y1="%d" y2="%d"/>' % (
            xs(lo(r)), xs(hi(r)), cy, cy, xs(lo(r)), xs(lo(r)), cy - 5, cy + 5, xs(hi(r)), xs(hi(r)), cy - 5, cy + 5))
        o.append('<circle class="pt%s" cx="%.1f" cy="%d" r="5"><title>%s: %s (%s)</title></circle>' % (" hol" if small else "", xs(val(r)), cy, esc(label(r)), fmt_val(r), fmt_interval(r)))
        o.append('<text class="cv" x="%.1f" y="%d" text-anchor="%s">%s</text>' % (
            (xs(hi(r)) + 8) if xs(hi(r)) < W - 120 else (xs(lo(r)) - 8), cy + 4, "start" if xs(hi(r)) < W - 120 else "end", esc(fmt_val(r) + unit)))
    o.append("</svg>")
    return "".join(o)


def table(head, body):
    h = "".join("<th scope=\"col\">%s</th>" % esc(x) for x in head)
    b = "".join("<tr>" + "".join(("<th scope=\"row\">%s</th>" if j == 0 else "<td>%s</td>") % esc(c) for j, c in enumerate(r)) + "</tr>" for r in body)
    return '<div class="tw"><table class="dt"><thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>' % (h, b)


def render(d):
    src = d["source"]
    repo_url = "https://github.com/" + src["repo"]
    sha = src["commit"]
    blob = lambda p: "%s/blob/%s/%s" % (repo_url, sha, p)
    t, tt = d["trend"], d["trend_tests"]
    sev = {r["measure"]: r for r in d["severity"]}
    ind = d["industry"]
    top, bot = ind[0], ind[-1]
    p = [x for x in ind if int(x["facilities"]) >= SMALL_GROUP]
    ptop, pbot = p[0], p[-1]
    first, last = t[0], t[-1]
    o = []
    # headline numbers (the test compares these data-h values with data.json)
    o.append('<section class="section" id="headline"><div class="wrap"><div class="sec-head"><span class="sec-num">NOW</span><h2 class="display">Three numbers</h2></div>')
    o.append('<div class="stats">')
    o.append('<div class="stat"><span class="n mono" data-h="rate_2010_2014">%s</span><span class="u">to</span><span class="n mono" data-h="rate_2020_2024">%s</span><span class="c">accident records per 100 facility-years, 2010-2014 against 2020-2024 (%s and %s records).</span></div>' % (
        f2(tt["rate_2010_2014"]), f2(tt["rate_2020_2024"]), i0(tt["accidents_2010_2014"]), i0(tt["accidents_2020_2024"])))
    o.append('<div class="stat"><span class="n mono" data-h="any_injury_pct">%s%%</span><span class="c">of the %s reported accident records had at least one injury (95%% interval %s to %s).</span></div>' % (
        f2(sev["any_injury"]["pct"]), i0(sev["any_injury"]["accidents"]), f2(sev["any_injury"]["pct_lo"]), f2(sev["any_injury"]["pct_hi"])))
    o.append('<div class="stat"><span class="n mono" data-h="top_rate">%s</span><span class="c">records per 100 facility-years in %s (%s facilities), the highest of the %d product-type groups with %d or more facilities; the lowest is %s at %s.</span></div>' % (
        f2(ptop["rate_per_100fy"]), esc(ptop["group"]), i0(ptop["facilities"]), len(p), SMALL_GROUP, esc(pbot["group"]), f2(pbot["rate_per_100fy"])))
    o.append("</div></div></section>")

    # S1 trend
    o.append('<section class="section" id="trend"><div class="wrap"><div class="sec-head"><span class="sec-num">S1</span><h2 class="display">Trend by year</h2></div>')
    o.append('<p class="sec-sub">Accident records per 100 facility-years at EPA-registered NAICS 325 chemical facilities, %s to %s, with exact (Garwood) 95%% Poisson intervals. The rate is %s in %s and %s in %s. Poisson regression gives a rate ratio of %s per year (%s to %s), a %s%% change per year; Mann-Kendall p = %s.</p>' % (
        first["year"], last["year"], f2(first["rate_per_100fy"]), first["year"], f2(last["rate_per_100fy"]), last["year"],
        "%.3f" % float(tt["rate_ratio_per_year"]), "%.3f" % float(tt["rr_lo"]), "%.3f" % float(tt["rr_hi"]), f2(tt["pct_change_per_year"]), tt["mk_p"]))
    o.append('<figure class="figure">' + svg_trend(d) + '<figcaption class="method">Shaded: the latest years, where the source analysis warns that records are under-observed (see the limits box). The Poisson intervals are too narrow because accidents cluster in few facilities (dispersion %s).</figcaption></figure>' % f2(tt["dispersion"]))
    o.append('<details class="tbl"><summary>Table of values</summary>' + table(["Year", "Facility-years", "Records", "Rate per 100 facility-years", "95% interval"],
        [[r["year"], i0(r["facility_years"]), i0(r["accidents"]), f2(r["rate_per_100fy"]), "%s to %s" % (f2(r["rate_lo"]), f2(r["rate_hi"]))] for r in t]) + "</details>")
    o.append('<p class="method">Source: <a href="%s">outputs/trend_by_year.csv</a>, <a href="%s">outputs/trend_tests.csv</a>; write-up <a href="%s">docs/trend.md</a>.</p></div></section>' % (blob(src["csv_paths"]["trend"]), blob(src["csv_paths"]["trend_tests"]), blob(src["doc_paths"]["trend"])))

    # S2 severity
    o.append('<section class="section" id="severity"><div class="wrap"><div class="sec-head"><span class="sec-num">S2</span><h2 class="display">Severity shares</h2></div>')
    o.append('<p class="sec-sub">Share of the %s reported accident records with each consequence, with exact Clopper-Pearson 95%% intervals. This is a share of accidents that were reported, not a rate per plant or per year. %s records (%s%%) reported a death and %s (%s%%) an offsite evacuation.</p>' % (
        i0(sev["any_injury"]["accidents"]), i0(sev["fatality"]["with_measure"]), f2(sev["fatality"]["pct"]), i0(sev["evacuation"]["with_measure"]), f2(sev["evacuation"]["pct"])))
    sv = d["severity"]
    o.append('<figure class="figure">' + svg_rows(sv, lambda r: MEASURE_LABEL[r["measure"]], lambda r: r["pct"], lambda r: r["pct_lo"], lambda r: r["pct_hi"],
        lambda r: f2(r["pct"]) + "%", lambda r: "95%% interval %s to %s" % (f2(r["pct_lo"]), f2(r["pct_hi"])),
        "Share of accident records with each consequence", "Dot chart with 95 percent intervals; the table below lists every value.", "2", 10, unit="%") + '</figure>')
    o.append('<details class="tbl"><summary>Table of values</summary>' + table(["Consequence", "Records with it", "Share", "95% interval"],
        [[MEASURE_LABEL[r["measure"]], "%s of %s" % (i0(r["with_measure"]), i0(r["accidents"])), f2(r["pct"]) + "%", "%s to %s" % (f2(r["pct_lo"]), f2(r["pct_hi"]))] for r in sv]) + "</details>")
    o.append('<p class="method">Source: <a href="%s">outputs/severity_overall.csv</a>; write-up <a href="%s">docs/severity.md</a>.</p></div></section>' % (blob(src["csv_paths"]["severity"]), blob(src["doc_paths"]["severity"])))

    # S3 industry
    o.append('<section class="section" id="industry"><div class="wrap"><div class="sec-head"><span class="sec-num">S3</span><h2 class="display">Rate by industry</h2></div>')
    o.append('<p class="sec-sub">Accident records per 100 facility-years by product-type peer group within NAICS 325, with exact 95%% Poisson intervals, highest first. Hollow marks are groups with fewer than %d facilities; their intervals are wide. The highest group with at least %d facilities is %s at %s, the lowest %s at %s.</p>' % (
        SMALL_GROUP, SMALL_GROUP, esc(ptop["group"]), f2(ptop["rate_per_100fy"]), esc(pbot["group"]), f2(pbot["rate_per_100fy"])))
    o.append('<figure class="figure">' + svg_rows(ind, lambda r: "%s (%s facilities)" % (r["group"], i0(r["facilities"])), lambda r: r["rate_per_100fy"], lambda r: r["rate_lo"], lambda r: r["rate_hi"],
        lambda r: f2(r["rate_per_100fy"]), lambda r: "95%% interval %s to %s" % (f2(r["rate_lo"]), f2(r["rate_hi"])),
        "Accident records per 100 facility-years by product-type group", "Dot chart with 95 percent intervals; the table below lists every value.", "3", 5,
        hollow=lambda r: int(r["facilities"]) < SMALL_GROUP) + '</figure>')
    o.append('<details class="tbl"><summary>Table of values</summary>' + table(["Group", "Facilities", "Facility-years", "Records", "Rate per 100 facility-years", "95% interval"],
        [[r["group"], i0(r["facilities"]), i0(r["facility_years"]), i0(r["accidents"]), f2(r["rate_per_100fy"]), "%s to %s" % (f2(r["rate_lo"]), f2(r["rate_hi"]))] for r in ind]) + "</details>")
    o.append('<p class="method">Source: <a href="%s">outputs/accident_by_subsector.csv</a>; write-up <a href="%s">docs/insights.md</a>.</p></div></section>' % (blob(src["csv_paths"]["industry"]), blob(src["doc_paths"]["insights"])))

    # limitations
    o.append('<section class="section" id="limits"><div class="wrap"><div class="sec-head"><span class="sec-num">!</span><h2 class="display">What these numbers cannot tell you</h2></div>')
    o.append('<div class="limits"><p class="lim-lead">Read these rates as counts of reported accident records, not as a measure of how safe a plant or an industry is. The sentences below are copied from the source write-ups.</p><ul>')
    for l in d["limitations"]:
        o.append('<li><strong>%s.</strong> <span class="q">%s</span> <a class="acc" href="%s">%s</a></li>' % (esc(l["topic"]), esc(l["text"]), blob(l["doc"]), esc(l["doc"])))
    o.append("</ul></div></div></section>")

    # sources
    o.append('<section class="section" id="sources"><div class="wrap"><div class="sec-head"><span class="sec-num">SRC</span><h2 class="display">Sources</h2></div><ul class="sources">')
    o.append('<li>Repository: <a href="%s">%s</a>, files read at commit <a href="%s/commit/%s"><code>%s</code></a>. The same fields are in <a href="data.json">data.json</a>.</li>' % (repo_url, src["repo"], repo_url, sha, sha[:12]))
    for k in ("insights", "severity", "trend"):
        o.append('<li><a href="%s">%s</a></li>' % (blob(src["doc_paths"][k]), src["doc_paths"][k]))
    o.append('<li>Underlying data: EPA Risk Management Program database, five-year accident history (40 CFR 68.42); FOIA copy via the <a href="https://www.data-liberation-project.org/datasets/epa-risk-management-program-database/">Data Liberation Project</a>; see <a href="https://www.epa.gov/rmp">EPA RMP</a>.</li></ul></div></section>')
    return "\n".join(o)


def write_all(d):
    block = BEGIN + "\n" + render(d) + "\n" + END
    with open(PAGE, encoding="utf-8") as fh:
        page = fh.read()
    new = re.sub(re.escape(BEGIN) + ".*?" + re.escape(END), lambda m: block, page, flags=re.S)
    return new, json.dumps(d, indent=1, sort_keys=True, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    data = build()
    page, js = write_all(data)
    if "--check" in sys.argv:
        stale = open(PAGE, encoding="utf-8").read() != page or open(DATA, encoding="utf-8").read() != js
        print("stale" if stale else "up to date")
        sys.exit(1 if stale else 0)
    open(PAGE, "w", encoding="utf-8").write(page)
    open(DATA, "w", encoding="utf-8").write(js)
    print("wrote", DATA, "and", PAGE)
