#!/usr/bin/env python3
"""Build the data block of reports/findings-digest/index.html.

Every finding is extracted from a committed file on the main branch of one of
the research repositories with a regular expression, so each number is copied
from its source and nothing is typed by hand. Each stated limitation is a
verbatim sentence from a source file. The only text written here is the
criterion-neutral "why it matters" line, which contains no digits.

The block between the DIGEST markers holds a JSON copy of the rows, the chart
and the table. Deterministic: no timestamps, fixed ordering, numbers copied as
strings.

Usage:
  python3 scripts/build_findings_digest.py            # rewrite the page
  python3 scripts/build_findings_digest.py --check    # exit 1 if stale
  python3 scripts/build_findings_digest.py --print    # print the block
Sources (first that applies):
  DIGEST_SOURCES=<dir>  plain files at <dir>/<repo>/<path>
  default               `git show origin/main:<path>` in /home/user/<repo>
                        (run `git fetch origin` there first)
  --raw                 raw.githubusercontent.com main
"""
import csv
import html
import io
import json
import os
import re
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "reports", "findings-digest", "index.html")
BEGIN, END = "<!-- BEGIN DIGEST-DATA -->", "<!-- END DIGEST-DATA -->"
GH = "https://github.com/priyatham9/{repo}/blob/main/{path}"
RAW = "https://raw.githubusercontent.com/priyatham9/{repo}/main/{path}"
CLONES = os.environ.get("DIGEST_CLONES", "/home/user")

OA, CP, AG, HF, SEM = ("ehs-osha-analysis", "ehs-chemical-peers",
                       "ehs-ai-grounding-eval", "ehs-human-factors-ontology",
                       "ehs-risk-sem")

NUM_RE = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")


def read(repo, path, raw=False):
    """Text of a file as committed on the repository's main branch."""
    d = os.environ.get("DIGEST_SOURCES")
    if d:
        with open(os.path.join(d, repo, path), encoding="utf-8") as fh:
            return fh.read()
    if raw or "--raw" in sys.argv:
        with urllib.request.urlopen(RAW.format(repo=repo, path=path), timeout=60) as r:
            return r.read().decode("utf-8")
    return subprocess.check_output(
        ["git", "-C", os.path.join(CLONES, repo), "show", "origin/main:" + path]
    ).decode("utf-8")


def norm(t):
    return re.sub(r"\s+", " ", t).strip()


def numbers(text):
    return NUM_RE.findall(text)


def number_in(tok, source):
    """True if tok occurs in source as a whole number token."""
    return re.search(r"(?<![\d.,])" + re.escape(tok) + r"(?![\d]|\.\d|,\d)", source) is not None


# ---- finding specs -------------------------------------------------------
# finding: list of (path, regex) parts; groups are numbered across parts and
# filled into `tpl`. limit: (path, regex); all groups joined by a space.
# why: written here, no digits.
SPECS = [
    dict(id="osha-trir-correction", repo=OA, path="README.md",
         section="README, Headline results",
         parts=[("README.md", r"raises the aggregate TRIR from ([\d.]+) to ([\d.]+), a ([\d.]+x) correction"),
                ("README.md", r"\| Flagged implausible \| [\d,]+ \(([\d.]+%)\) \|"),
                ("README.md", r"\| Share of all reported hours they hold \| ([\d.]+%) \|")],
         tpl="Screening implausible hours raises the pooled 2016-2024 aggregate TRIR from {0} to {1}, a {2} correction. The {3} of filings flagged hold {4} of reported hours.",
         limit=("README.md", r"(It does not identify which specific numbers on forms are wrong, nor does it address causes of injury, nor does it represent the broader US workforce\.)"),
         why="Injury rates built from unchecked, self-reported hours can look far better than they are. Checking hours before comparing rates keeps a benchmark from rewarding a data-entry error."),
    dict(id="osha-threshold-range", repo=OA, path="docs/THRESHOLD_ROBUSTNESS.md",
         section="Result 1 and Result 2",
         parts=[("docs/THRESHOLD_ROBUSTNESS.md", r"Screened aggregate TRIR runs from ([\d.]+) to ([\d.]+), a range"),
                ("docs/THRESHOLD_ROBUSTNESS.md", r"The flagged share runs from ([\d.]+%) \([\d,]+ filings\) to ([\d.]+%)")],
         tpl="Across all 25 pairs of screen bounds, the screened aggregate TRIR runs from {0} to {1}, while the flagged share runs from {2} to {3}.",
         limit=("docs/THRESHOLD_ROBUSTNESS.md", r"Robust to thresholds is not the same as correct\.\*\* (The analysis shows the aggregate is insensitive to where the bounds sit\. It does not show that every flagged filing is wrong or that the screened rate equals a true national rate; the data are self-reported and not a sample of the US workforce\.)"),
         why="A screening rule rests on a judgement call. Showing that the headline holds across reasonable settings, and quoting the share flagged with its range, makes the rule easier to defend."),
    dict(id="osha-detectability", repo=OA, path="docs/DETECTABILITY.md",
         section="Results",
         parts=[("docs/DETECTABILITY.md", r"A site of (1-19) employees that reports zero cases cannot rule out a TRIR of ([\d.]+) \(exact (95%) upper limit\), roughly ten times the band's aggregate rate of ([\d.]+)\."),
                ("docs/DETECTABILITY.md", r"Detecting a (25%) difference at (80%) power takes ([\d.]+) site-years per arm in the smallest band")],
         tpl="A site of {0} employees that reports zero cases cannot rule out a TRIR of {1} (exact {2} upper limit), roughly ten times the band's aggregate rate of {3}. Detecting a {4} difference at {5} power takes {6} site-years per arm in the smallest band.",
         limit=("docs/DETECTABILITY.md", r"(Poisson is a best case\. The same table shows variance-to-mean ratios from 3\.4 \(1-19\) to 241\.4 \(1000\+\) for establishment case counts, far above the Poisson value of 1, so real detectability is worse than reported here\.)"),
         why="A year with no recorded injuries at a very small site is weak evidence of a low underlying rate. Comparing small sites takes several years pooled, not one year's number."),
    dict(id="chem-rate-spread", repo=CP, path="docs/insights.md",
         section="Finding 1",
         parts=[("docs/insights.md", r"differ about (\d+-fold) between the highest and lowest product-type peer groups with (100) or more facilities\.\*\* Petrochemicals had ([\d.]+) accident records per 100 facility-years \(95% interval ([\d.]+) to ([\d.]+); (\d+) facilities\)\. Ethanol and biofuels had ([\d.]+) \(([\d.]+) to ([\d.]+); (\d+) facilities\)\.")],
         tpl="RMP accident-record rates differ about {0} between the highest and lowest product-type peer groups with {1} or more facilities. Petrochemicals had {2} accident records per 100 facility-years (95% interval {3} to {4}; {5} facilities). Ethanol and biofuels had {6} ({7} to {8}; {9} facilities).",
         limit=("docs/insights.md", r"(Only accidents that meet EPA's five-year-history criteria \(40 CFR 68\.42\) are on file\. A group with a higher count may report more, hold more, or have more covered processes\. Nothing here says why a rate is high or low, and none of it shows that a group is less safe\.)"),
         why="Chemical plants are better compared with plants of the same product type than with the whole sector. A single plant's accident count is best read against the closest group's interval."),
    dict(id="chem-concentration", repo=CP, path="docs/insights.md",
         section="Finding 2",
         parts=[("docs/insights.md", r"The (212) facilities in the top 10% by accident count account for ([\d.]+%) of all accident records, and the top 1% \((22) facilities\) for ([\d.]+%)\."),
                ("docs/insights.md", r"Facilities holding 5 million lb or more of regulated chemicals had ([\d.]+) records per 100 facility-years \(([\d.]+%) had at least one\), against ([\d.]+) \(([\d.]+%)\) for facilities under 100,000 lb\.")],
         tpl="The {0} facilities in the top 10% by accident count account for {1} of all accident records, and the top 1% ({2} facilities) for {3}. Facilities holding 5 million lb or more of regulated chemicals had {4} records per 100 facility-years ({5} had at least one), against {6} ({7}) for facilities under 100,000 lb.",
         limit=("docs/insights.md", r"(Inventory and product type overlap \(large holders are concentrated in some product types\), so these two findings are not independent\.)"),
         why="Because records concentrate in a few facilities and the largest inventories, a list ordered by accident history and inventory puts the facilities behind most records first. It is a prioritisation aid and not a finding about any facility."),
    dict(id="chem-rank-stability", repo=CP, path="docs/insights.md",
         section="Finding 3",
         parts=[("docs/insights.md", r"Ranking the (13) product-type groups with at least (100) facility-years in each half, the rank correlation between their (2010-2016) rate and their (2017-2024) rate is ([\d.]+) \(Spearman\)\. Across the (12) chemical families it is ([\d.]+)\. Rates were lower in the later half in (11) of (13) product types")],
         tpl="Ranking the {0} product-type groups with at least {1} facility-years in each half, the rank correlation between their {2} rate and their {3} rate is {4} (Spearman). Across the {5} chemical families it is {6}. Rates were lower in the later half in {7} of {8} product types.",
         limit=("docs/insights.md", r"(An accident is on file only if it fell in the five years before a submission\. Facilities that stopped filing, or filed more than five years apart, may have unobserved accidents counted as accident-free years\. The fall in later-period rates may partly reflect this and also reporting changes; the data cannot separate these\.)"),
         why="A peer group's standing relative to other groups holds up across periods, so it is usable context year to year, even though the level of the rate moved."),
    dict(id="grounding-baselines", repo=AG, path="results/baselines_breakdown.md",
         section="all_factual row",
         parts=[("results/baselines_breakdown.md", r"\| all_factual \| (63) \| ([\d.]+% \[[\d.]+, [\d.]+\]) \| ([\d.]+% \[[\d.]+, [\d.]+\]) \| ([\d.]+% \[[\d.]+, [\d.]+\]) \|")],
         tpl="On {0} factual items, the random floor scores {1} while TF-IDF retrieval scores {2} and BM25 retrieval scores {3}.",
         limit=("results/assistant_eval.md", r"(Caveat: as in the repository's retrieval baselines, the governing passage of every question is in the index \(the question text is not removed from it\), so retrieval is tested for selecting that passage, not for finding evidence in an unseen corpus\.)"),
         why="Keyword retrieval over regulatory text is not enough on its own to answer EHS compliance questions reliably. Answers need to be checked against the clause they cite."),
    dict(id="grounding-item-analysis", repo=AG, path="results/item_analysis.md",
         section="Difficulty and Agreement across retrievers",
         parts=[("results/item_analysis.md", r"Items no retriever solves: (45) of (63)\."),
                ("results/item_analysis.md", r"Fleiss kappa over 4 retrievers and 63 items \(binary correct/incorrect\): ([\d.]+)\.")],
         tpl="No retriever solves {0} of the {1} factual items, and the 4 retrievers agree closely (Fleiss kappa {2}).",
         limit=("results/item_analysis.md", r"(The 4 retrievers are not independent raters\. TF-IDF, BM25, BM25\+ and RRF \(which fuses TF-IDF and BM25\) share one tokenizer and one 68-document index, so high agreement is expected by construction and says little about item quality\.)"),
         why="Questions that every simple method misses are candidates for review and for human-checked answers. Agreement among similar tools should not be read as accuracy."),
    dict(id="grounding-assistant", repo=AG, path="results/assistant_eval.md",
         section="Headline and Release gate",
         parts=[("results/assistant_eval.md", r"\| accuracy, factual items \(abstention counts as not correct\) \| ([\d.]+%) \|"),
                ("results/assistant_eval.md", r"\| answered factual items \| (\d+) of (63) \|"),
                ("results/assistant_eval.md", r"\| citation precision \(answered, correct clause\) \| ([\d.]+%) \|"),
                ("results/assistant_eval.md", r"\| category-error items declined \| [\d.]+% \((5 of 5)\) \|"),
                ("results/assistant_eval.md", r"\| citation precision on answered >= (0\.80) \| (0\.780) \| (FAIL) \|")],
         tpl="The grounded assistant answered {1} of {2} factual items. Accuracy was {0} with abstentions counted as not correct, and citation precision on answered items was {3}. It declined {4} category-error items. Against the release gate set before the first run (citation precision on answered at least {5}) it observed {6}: {7}.",
         limit=("results/assistant_eval.md", r"\*\*(No language model was used\.)\*\* (The answer composer is `MockModel`, which is extractive: it quotes the top retrieved corpus passage verbatim and cites its clause\.)"),
         why="A pass or fail gate fixed in advance, and a rule to decline when unsure, make an EHS assistant's limits visible before anyone relies on it."),
    dict(id="hfo-suggester", repo=HF, path="incidents/suggester_eval.md",
         section="Held-out cohort",
         parts=[("incidents/suggester_eval.md", r"## Held-out cohort \((13) investigations, (42) pairs, rules not fit to these\)\s+\| Rule set .*?\| baseline \([^|]*\| \d+ \| \d+ \| \d+ \| \d+ \| ([\d.]+) \| ([\d.]+) \|.*?\| curated \(crosswalk[^|]*\| \d+ \| (\d+) \| (\d+) \| (\d+) \| ([\d.]+) \| ([\d.]+) \|")],
         tpl="On {0} held-out CSB investigations ({1} coded factor pairs), the curated keyword rules reached precision {7} and recall {8} ({4} true positives, {5} false positives, {6} missed), against precision {2} and recall {3} for the untuned baseline built from ontology label words.",
         limit=("incidents/suggester_eval.md", r"(Nothing here is an estimate of performance on other incidents; the held-out cohort is the closest thing to one and it is small, so one pair moves a PIF's precision or recall by many points\.)"),
         why="Rule-based suggestions can point an analyst to human-factor conditions worth checking in an investigation report. A person still decides which conditions apply."),
    dict(id="hfo-adopted-taxonomy", repo=HF, path="README.md",
         section="At a glance and The claim, stated up front",
         parts=[("README.md", r"It provides (20) PIFs, (90) alignments to SPAR-H, CREAM, HFACS and the HSE PIF list"),
                ("README.md", r"The four context dimensions are not new; they are adopted from IDHEAS-G \((NUREG-2198), (2021)\)\.")],
         tpl="The four context dimensions are not new; they are adopted from IDHEAS-G ({2}, {3}). The repository encodes {0} PIFs with {1} alignments to SPAR-H, CREAM, HFACS and the HSE PIF list.",
         limit=("README.md", r"(What is contributed is the encoding, the crosswalk and the traceability - and those are worth less than a new taxonomy would be if a new taxonomy were warranted\.)"),
         why="Putting the same human-factor conditions from several methods in one traceable table shows where different methods use different words for the same condition."),
    dict(id="sem-sample-size", repo=SEM, path="docs/methods-note.md",
         section="Abstract",
         parts=[("docs/methods-note.md", r"reaches (80%) power at N = (153)\. Estimating a single path to a standard error of (0\.05) needs N = (369)\. Telling a path of (0\.45) from one of (0\.30) needs N = (770), and telling (-0\.25) from (-0\.20) needs N = ([\d,]+)\.")],
         tpl="For a five-latent model with three indicators per latent, the test of close fit reaches {0} power at N = {1}. Estimating a single path to a standard error of {2} needs N = {3}. Telling a path of {4} from one of {5} needs N = {6}, and telling {7} from {8} needs N = {9}.",
         limit=("docs/methods-note.md", r"(Every number comes from generated data; no real injury data were analysed\.)"),
         why="Before ranking or weighting safety factors from a model, check whether the sample at hand can support the comparison. Passing fit cutoffs does not show that."),
    dict(id="sem-coverage", repo=SEM, path="docs/methods-note.md",
         section="Abstract",
         parts=[("docs/methods-note.md", r"too narrow at every sample size studied, with (95%) coverage between ([\d.]+) and ([\d.]+); a percentile bootstrap restored coverage to ([\d.]+) to ([\d.]+) at N = (500)")],
         tpl="Analytic standard errors from the two-step estimator are too narrow at every sample size studied, with {0} coverage between {1} and {2}. A percentile bootstrap restored coverage to {3} to {4} at N = {5}.",
         limit=("README.md", r"(Nothing here analyses real injury data\.) Every number this repository produces comes from data generated by a model whose parameters are known in advance\."),
         why="An interval that looks precise can mislead. Resampling-based intervals give a more honest range for decisions that depend on an estimate."),
]


def extract(spec):
    vals = []
    for path, rx in spec["parts"]:
        m = re.search(rx, norm(read(spec["repo"], path)), re.S)
        if not m:
            raise SystemExit("no match for %s in %s" % (spec["id"], path))
        vals.extend(m.groups())
    return spec["tpl"].format(*vals)


def extract_limit(spec):
    path, rx = spec["limit"]
    m = re.search(rx, norm(read(spec["repo"], path)), re.S)
    if not m:
        raise SystemExit("no limitation match for %s in %s" % (spec["id"], path))
    return " ".join(m.groups())


def build_rows():
    rows = []
    for s in SPECS:
        finding = extract(s)
        limit = extract_limit(s)
        lpath = s["limit"][0]
        # every number must be in its cited source file
        for text, path in ((finding, s["path"]), (limit, lpath)):
            src = norm(read(s["repo"], path))
            for tok in numbers(text):
                if not number_in(tok, src):
                    raise SystemExit("%s: %s not in %s" % (s["id"], tok, path))
        assert not numbers(s["why"]), s["id"]
        rows.append(dict(id=s["id"], repo=s["repo"], path=s["path"], section=s["section"],
                         url=GH.format(repo=s["repo"], path=s["path"]),
                         finding=finding,
                         limit=limit, limit_path=lpath,
                         limit_url=GH.format(repo=s["repo"], path=lpath),
                         why=s["why"]))
    return rows


# ---- chart ---------------------------------------------------------------
CHART_SRC = (CP, "outputs/accident_by_subsector.csv")
MIN_FAC = 100
AXIS_MAX = 10.0
X0, XW = 8.0, 290.0
ROW_H = 56.0


def chart_rows():
    r = csv.DictReader(io.StringIO(read(*CHART_SRC)))
    out = [x for x in r if int(x["facilities"]) >= MIN_FAC]
    out.sort(key=lambda x: (-float(x["rate_per_100fy"]), x["group"]))
    return out


def fmt(v):
    return ("%.2f" % v).rstrip("0").rstrip(".")


def build_chart(rows):
    def px(v):
        return X0 + XW * float(v) / AXIS_MAX
    h = ROW_H * len(rows) + 8
    parts = ['<svg class="chart" viewBox="0 0 480 %s" role="img" aria-labelledby="chTitle chDesc" xmlns="http://www.w3.org/2000/svg">' % fmt(h),
             '<title id="chTitle">RMP accident records per 100 facility-years by product type, with 95% intervals</title>',
             '<desc id="chDesc">Dot and interval for each NAICS 325 product-type peer group with 100 or more facilities, highest rate first. Values are printed beside each interval.</desc>']
    # gridlines at equal steps of the axis, unlabelled; the axis starts at zero
    for i in range(0, 6):
        x = X0 + XW * i / 5.0
        parts.append('<line class="grid" x1="%s" x2="%s" y1="0" y2="%s"/>' % (fmt(x), fmt(x), fmt(h - 8)))
    for i, r in enumerate(rows):
        y = 8 + ROW_H * i
        cy = y + 36
        lo, mid, hi = r["rate_lo"], r["rate_per_100fy"], r["rate_hi"]
        parts.append('<g class="crow" data-group="%s">' % html.escape(r["group"], quote=True))
        parts.append('<text class="cl" x="0" y="%s">%s, <tspan class="dl">%s</tspan> facilities</text>' % (fmt(y + 14), html.escape(r["group"]), r["facilities"]))
        parts.append('<line class="ci" x1="%s" x2="%s" y1="%s" y2="%s"/>' % (fmt(px(lo)), fmt(px(hi)), fmt(cy), fmt(cy)))
        parts.append('<line class="cap" x1="%s" x2="%s" y1="%s" y2="%s"/>' % (fmt(px(lo)), fmt(px(lo)), fmt(cy - 5), fmt(cy + 5)))
        parts.append('<line class="cap" x1="%s" x2="%s" y1="%s" y2="%s"/>' % (fmt(px(hi)), fmt(px(hi)), fmt(cy - 5), fmt(cy + 5)))
        parts.append('<circle class="pt" cx="%s" cy="%s" r="5"/>' % (fmt(px(mid)), fmt(cy)))
        parts.append('<text class="cv" x="%s" y="%s"><tspan class="dl">%s</tspan> (<tspan class="dl">%s</tspan> to <tspan class="dl">%s</tspan>)</text>' % (fmt(px(hi) + 10), fmt(cy + 4), mid, lo, hi))
        parts.append('</g>')
    parts.append('</svg>')
    return "\n".join(parts)


# ---- block ---------------------------------------------------------------
def build_block():
    rows = build_rows()
    crows = chart_rows()
    out = [BEGIN]
    data = dict(rows=rows,
                chart=dict(source=GH.format(repo=CHART_SRC[0], path=CHART_SRC[1]),
                           groups=[dict(group=r["group"], facilities=r["facilities"],
                                        rate_per_100fy=r["rate_per_100fy"], rate_lo=r["rate_lo"],
                                        rate_hi=r["rate_hi"]) for r in crows]))
    out.append('<script type="application/json" id="digest-data">')
    out.append(json.dumps(data, indent=1, sort_keys=True, ensure_ascii=True).replace("</", "<\\/"))
    out.append('</script>')
    out.append('<section class="section" id="chart"><div class="wrap">')
    out.append('<div class="sec-head"><span class="sec-num">S1</span><h2 class="display">RMP accident rate by peer group</h2></div>')
    out.append('<p class="sec-sub">Accident records per 100 facility-years for NAICS 325 product-type peer groups with 100 or more facilities, with the exact Poisson 95%% interval. Highest rate first. The axis starts at zero. Source: <a href="%s">%s/%s</a>.</p>' % (GH.format(repo=CHART_SRC[0], path=CHART_SRC[1]), CHART_SRC[0], CHART_SRC[1]))
    out.append('<figure class="figure">')
    out.append(build_chart(crows))
    out.append('<figcaption class="method">Reporting, not risk: only accidents that meet EPA\'s five-year-history criteria are on file, and the intervals assume independent accidents, so the true uncertainty is wider than shown. See the first chemical-peers row below.</figcaption>')
    out.append('</figure></div></section>')
    out.append('<section class="section" id="table"><div class="wrap">')
    out.append('<div class="sec-head"><span class="sec-num">S2</span><h2 class="display">Findings, sources and limits</h2></div>')
    out.append('<p class="sec-sub">One row per finding. The finding and the limitation are quoted or assembled from the linked file on the main branch of each repository.</p>')
    out.append('<table class="map" id="digest">')
    out.append('<thead><tr><th scope="col">Finding</th><th scope="col">Source</th><th scope="col">Stated limitation</th><th scope="col">Why it matters for EHS practice</th></tr></thead><tbody>')
    for r in rows:
        out.append('<tr id="%s">' % r["id"])
        out.append('<td data-h="Finding" class="f" data-src="%s/%s">%s</td>' % (r["repo"], r["path"], html.escape(r["finding"])))
        out.append('<td data-h="Source"><a class="file" href="%s">%s/%s</a><span class="sec">%s</span></td>' % (r["url"], r["repo"], r["path"], html.escape(r["section"])))
        lim = html.escape(r["limit"])
        if r["limit_path"] != r["path"]:
            lim += ' <a class="file" href="%s">%s</a>' % (r["limit_url"], html.escape(r["limit_path"]))
        out.append('<td data-h="Stated limitation" class="l" data-src="%s/%s">%s</td>' % (r["repo"], r["limit_path"], lim))
        out.append('<td data-h="Why it matters" class="w">%s</td>' % html.escape(r["why"]))
        out.append('</tr>')
    out.append('</tbody></table></div></section>')
    out.append(END)
    return "\n".join(out)


def main():
    block = build_block()
    if "--print" in sys.argv:
        print(block)
        return 0
    with open(PAGE, encoding="utf-8") as fh:
        page = fh.read()
    i, j = page.index(BEGIN), page.index(END) + len(END)
    new = page[:i] + block + page[j:]
    if "--check" in sys.argv:
        if new != page:
            print("findings digest is stale; run scripts/build_findings_digest.py")
            return 1
        return 0
    with open(PAGE, "w", encoding="utf-8") as fh:
        fh.write(new)
    return 0


if __name__ == "__main__":
    sys.exit(main())
