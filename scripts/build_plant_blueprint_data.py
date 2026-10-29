#!/usr/bin/env python3
"""Build the JSON block embedded in work/plant-blueprint.html.

Reads committed outputs of priyatham9/ehs-chemical-peers and
priyatham9/ehs-osha-analysis (local clones, or raw GitHub with --raw) and
writes the block between the PLANT-DATA markers in the page. Deterministic:
no timestamps, sorted keys, fixed rounding. Every number is copied from a
source table; the only derived values are shares computed in the browser.

Usage:
  python3 scripts/build_plant_blueprint_data.py            # rewrite the page
  python3 scripts/build_plant_blueprint_data.py --check    # exit 1 if stale
  python3 scripts/build_plant_blueprint_data.py --print    # print the block
Sources: PLANT_SOURCES=<dir holding ehs-chemical-peers/ and ehs-osha-analysis/>
(default /home/user), or --raw to read raw.githubusercontent.com main.
"""
import csv
import io
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "work", "plant-blueprint.html")
BEGIN, END = "<!-- BEGIN PLANT-DATA -->", "<!-- END PLANT-DATA -->"
CP, OA = "ehs-chemical-peers", "ehs-osha-analysis"
RAW = "https://raw.githubusercontent.com/priyatham9/{repo}/main/{path}"
USE_RAW = "--raw" in sys.argv
LOCAL = os.environ.get("PLANT_SOURCES", "/home/user")


def read(repo, path):
    if USE_RAW:
        with urllib.request.urlopen(RAW.format(repo=repo, path=path), timeout=60) as r:
            return r.read().decode("utf-8")
    with open(os.path.join(LOCAL, repo, path), encoding="utf-8") as fh:
        return fh.read()


def jload(repo, path):
    return json.loads(read(repo, path))


def rows(repo, path):
    return list(csv.DictReader(io.StringIO(read(repo, path))))


def pick(lst, key, label):
    for x in lst:
        if x[key] == label:
            return x
    raise KeyError(label)


def build():
    summ = jload(CP, "outputs/summary.json")
    comp = jload(CP, "docs/data/compare.json")
    stab = jload(CP, "outputs/peer_stability.json")
    ra = summ["release_anatomy_all"]
    ia = summ["injury_anatomy_all"]
    rp = summ["release_predictors"]
    groups = {g["id"]: g for g in comp["groups"]}
    S_SUM = CP + ":outputs/summary.json"
    S_CMP = CP + ":docs/data/compare.json"

    def flag(block, field, label):
        return {"label": label, "n": pick(ra[field], "label", label)["n"],
                "of": ra["releases"], "src": S_SUM,
                "key": "release_anatomy_all." + field}

    def cause(label):
        return flag(ra, "cause", label)

    def after(label):
        return flag(ra, "after", label) if "after" in ra else None

    # Release rate per plant-year by inventory band (stochastic driver).
    bands = []
    for gid, label in (("rel-inv-Under 100k lb", "Under 100k lb"),
                       ("rel-inv-100k-1M lb", "100k-1M lb"),
                       ("rel-inv-1M-5M lb", "1M-5M lb"),
                       ("rel-inv-5M+ lb", "5M+ lb")):
        g = groups[gid]
        bands.append({"label": label, "plant_years": g["n"], "events": g["events"],
                      "rate_pct": g["rate_pct"], "wilson_pct": g["wilson_pct"],
                      "exact_pct": g["exact_pct"]})

    # Other release peer groups (size, history, number of chemicals, chemical family).
    peer_groups = []
    for g in comp["groups"]:
        if g["id"].startswith("rel-") and not g["id"].startswith("rel-inv-"):
            peer_groups.append({"id": g["id"], "dimension": g["dimension"], "label": g["label"],
                                "plant_years": g["n"], "events": g["events"], "rate_pct": g["rate_pct"],
                                "wilson_pct": g["wilson_pct"], "exact_pct": g["exact_pct"]})

    qo = rows(OA, "outputs/tables/quality_overall.csv")[0]
    pp = [r for r in rows(OA, "outputs/tables/peer_percentiles_pooled.csv")
          if r["naics3"] == "325" and r["size_band"] == "100-249"][0]
    S_Q = OA + ":outputs/tables/quality_overall.csv"
    S_P = OA + ":outputs/tables/peer_percentiles_pooled.csv"

    def fam(label):
        f = pick(rp["family"], "family", label)
        g = groups["rel-fam-" + label]
        return {"label": label, "plant_years": f["n"], "events": f["events"],
                "rate_pct": g["rate_pct"], "wilson_pct": g["wilson_pct"],
                "src": S_CMP, "key": "groups[rel-fam-%s]" % label}

    def nchem(gid):
        g = groups[gid]
        return {"label": g["label"] if g["label"] != "chemicals" else gid,
                "plant_years": g["n"], "events": g["events"],
                "rate_pct": g["rate_pct"], "wilson_pct": g["wilson_pct"],
                "src": S_CMP, "key": "groups[%s]" % gid}

    def energy(label):
        return {"label": label, "n": pick(ia["energy"], "label", label)["n"],
                "of": ia["events"], "src": S_SUM, "key": "injury_anatomy_all.energy"}

    def bandstat(b):
        g = pick(bands, "label", b)
        return {"label": "Plant-years with a release, inventory " + b,
                "plant_years": g["plant_years"], "events": g["events"],
                "rate_pct": g["rate_pct"], "wilson_pct": g["wilson_pct"],
                "src": S_CMP, "key": "groups[rel-inv-%s]" % b}

    ctrl_stab = {s["band"]: s for s in summ["stability"]}
    data = {
        "interval_alpha": comp["alpha"],
        "disclaimer": ("Illustrative schematic of a generic plant, not a real facility; "
                       "units are annotated with statistics from public data, not "
                       "measurements of this layout"),
        "sources": {
            "chempeers": "https://github.com/priyatham9/ehs-chemical-peers",
            "osha": "https://github.com/priyatham9/ehs-osha-analysis",
            "note": "docs/insights.md is not present at origin/main of either repository, so it is not used.",
        },
        "release_flags": {
            "total": ra["releases"], "src": S_SUM,
            "source": ra["source"], "type": ra["type"], "cause": ra["cause"],
        },
        "sim_rates": {
            "release_per_plant_year": {
                "bands": bands, "peer_groups": peer_groups, "src": S_CMP,
                "key": "groups[rel-inv-*].rate_pct / wilson_pct / exact_pct",
            },
            "filing_implausible": {
                "src": S_Q, "column": "implausible_share",
                "share": float(qo["implausible_share"]),
                "n_filings": int(qo["n_filings"]),
                "n_implausible": int(qo["n_implausible"]),
            },
        },
        "units": {
            "reactor": {
                "title": "Reactor", "stats": [
                    flag(ra, "source", "Process vessel or reactor"),
                    flag(ra, "type", "Runaway reaction"),
                    cause("Pressure built up too high"),
                    bandstat("5M+ lb"),
                ],
                "note": "Source flags count RMP accident records for NAICS 325 plants; the record says where a release came from, not how the plant is laid out.",
            },
            "column": {
                "title": "Distillation column", "stats": [
                    fam("Flammable gases & liquids"),
                    nchem("rel-nchem-5+"),
                    flag(ra, "source", "Process vessel or reactor"),
                ],
                "note": "The data has no distillation-specific field. The first two rows are plant-level shares for plants holding the chemical family or five or more regulated chemicals; the third is the generic process-vessel flag, which is shared with reactors.",
            },
            "tank": {
                "title": "Storage tank", "stats": [
                    flag(ra, "source", "Storage tank"),
                    bandstat("Under 100k lb"), bandstat("100k-1M lb"),
                    bandstat("1M-5M lb"), bandstat("5M+ lb"),
                ],
                "note": "Release shares by inventory are plant-level and say nothing about a single tank.",
            },
            "exchanger": {
                "title": "Heat exchanger", "stats": [
                    energy("Heat, steam & hot material"),
                    energy("Chemical exposure"),
                ],
                "note": "Neither source has a heat-exchanger field. These are OSHA Severe Injury Reports grouped by energy type across all NAICS 325 plants; they are not linked to exchangers.",
            },
            "pump": {
                "title": "Pump", "stats": [
                    flag(ra, "source", "Pump"),
                    flag(ra, "source", "Transfer hose"),
                ],
                "note": "Flags are not exclusive: one release can name several sources.",
            },
            "piperack": {
                "title": "Pipe rack and piping", "stats": [
                    flag(ra, "source", "Piping"), flag(ra, "source", "Valve"),
                    flag(ra, "source", "Joint or flange"),
                    flag(ra, "source", "Transfer hose"),
                ],
                "note": "Piping is the most frequently flagged release source in the records. Flags are not exclusive.",
            },
            "flare": {
                "title": "Flare and safety systems", "stats": [
                    flag(ra, "type", "Fire"), flag(ra, "type", "Explosion"),
                    cause("Safety system bypassed"), cause("Design flaw"),
                ],
                "note": "No record names a flare. Fire and explosion are release-type flags; bypass and design flaw are contributing-cause flags. The data does not show whether any safety system would have prevented a release.",
            },
            "control": {
                "title": "Control building", "stats": [
                    {"label": "OSHA 300A filings flagged implausible", "n": int(qo["n_implausible"]),
                     "of": int(qo["n_filings"]), "src": S_Q, "key": "column n_implausible / n_filings"},
                    {"label": "Share of reported hours carried by implausible filings",
                     "value_pct": round(float(qo["hours_share_implausible"]) * 100, 2),
                     "src": S_Q, "key": "column hours_share_implausible"},
                    {"label": "Aggregate TRIR, unscreened vs screened",
                     "values": [round(float(qo["aggregate_trir_unscreened"]), 3),
                                round(float(qo["aggregate_trir_screened"]), 3)],
                     "value_labels": ["unscreened", "screened"],
                     "src": S_Q, "key": "columns aggregate_trir_unscreened, aggregate_trir_screened"},
                    {"label": "NAICS 325, 100-249 employees: median and 90th percentile TRIR",
                     "values": [round(float(pp["p50"]), 3), round(float(pp["p90"]), 3)],
                     "value_labels": ["median", "90th percentile"],
                     "n": int(pp["n"]), "src": S_P, "key": "naics3=325, size_band=100-249, columns p50, p90"},
                    cause("Human error"), cause("Management system gap"),
                    {"label": "Year-to-year rank correlation of plant injury rate, under 50 vs 1,000+ employees",
                     "values": [ctrl_stab["Under 50"]["rho"], ctrl_stab["1,000+"]["rho"]],
                     "value_labels": ["under 50 employees", "1,000+ employees"],
                     "src": S_SUM, "key": "stability[].rho"},
                    {"label": "Median share of nearest peers retained when similarity weights are perturbed",
                     "value": stab["summary"]["overall"]["median"],
                     "n": stab["summary"]["overall"]["n"],
                     "src": CP + ":outputs/peer_stability.json", "key": "summary.overall.median"},
                ],
                "note": "Filing-quality and peer-spread figures describe the public record, not any control room.",
            },
        },
    }
    for u in data["units"].values():
        u["stats"] = [s for s in u["stats"] if s]
    return data


def block(data):
    body = json.dumps(data, indent=1, sort_keys=True, ensure_ascii=True)
    return '%s\n<script type="application/json" id="plant-data">\n%s\n</script>\n%s' % (BEGIN, body, END)


def main():
    new = block(build())
    if "--print" in sys.argv:
        print(new)
        return 0
    with open(PAGE, encoding="utf-8") as fh:
        html = fh.read()
    pat = re.compile(re.escape(BEGIN) + ".*?" + re.escape(END), re.S)
    if not pat.search(html):
        sys.exit("markers missing in " + PAGE)
    out = pat.sub(lambda m: new, html)
    if "--check" in sys.argv:
        if out != html:
            print("plant-blueprint data block is stale")
            return 1
        print("ok")
        return 0
    with open(PAGE, "w", encoding="utf-8") as fh:
        fh.write(out)
    print("wrote", PAGE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
