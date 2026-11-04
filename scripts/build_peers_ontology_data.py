"""Build work/peers-ontology-explorer/data.json from a checkout of priyatham9/ehs-chemical-peers.

Runs that repo's own ontology export (python -m chempeers.ontology, standard
library only) on its committed data, then keeps a compact subset:

  - full spec: object types, link types, action types
  - full census of every object type and the link integrity report
  - embedded objects: every RmpRegistration (with its Plant name fields),
    ChemicalHolding, Accident, PlantMatch, Chemical, PeerGroup, SizeBand
  - NOT embedded (counted only): OSHA-only Plants, OshaEstablishment,
    InjuryLogYear, SeriousInjury, Process. The page says so.

Usage: python3 scripts/build_peers_ontology_data.py [PEERS_CLONE]
(default: env RMP_PEERS_CLONE or /home/user/ehs-chemical-peers). Output is
deterministic: no timestamps, sorted keys, compact separators.
"""
import json
import os
from collections import Counter
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "work", "peers-ontology-explorer", "data.json")
REPO = "priyatham9/ehs-chemical-peers"
SOURCE_PATHS = [
    "src/chempeers/ontology/spec.json",
    "docs/data/plants.json",
    "docs/data/releases.json",
    "docs/data/injuries.json",
    "outputs/summary.json",
]
EMBEDDED = ["RmpRegistration", "ChemicalHolding", "Accident", "PlantMatch", "Chemical", "PeerGroup", "SizeBand"]


def build(clone):
    sha = subprocess.check_output(["git", "-C", clone, "rev-parse", "HEAD"], text=True).strip()
    dirty = subprocess.check_output(["git", "-C", clone, "status", "--porcelain", "--"] + SOURCE_PATHS +
                                    ["src/chempeers"], text=True).strip()
    if dirty:
        raise SystemExit("clone has uncommitted changes in source paths; commit or reset first:\n" + dirty)
    with tempfile.TemporaryDirectory() as tmp:
        env = dict(os.environ, PYTHONPATH=os.path.join(clone, "src"))
        subprocess.check_output([sys.executable, "-m", "chempeers.ontology", "--out", tmp],
                                cwd=clone, env=dict(env), stderr=subprocess.STDOUT)
        ex = json.load(open(os.path.join(tmp, "ontology.json"), encoding="utf-8"))
    spec = json.load(open(os.path.join(clone, "src/chempeers/ontology/spec.json"), encoding="utf-8"))
    obj = ex["objects"]
    plants = {p["plant_id"]: p for p in obj["Plant"]}
    census = {t: len(v) for t, v in obj.items()}

    chem_names = sorted(c["chemical_name"] for c in obj["Chemical"])
    cidx = {n: i for i, n in enumerate(chem_names)}
    chem_fam = {c["chemical_name"]: c["families"] for c in obj["Chemical"]}

    regs = sorted(obj["RmpRegistration"], key=lambda r: r["epa_facility_id"])
    fidx = {r["epa_facility_id"]: i for i, r in enumerate(regs)}
    fac_cols = ["epa_id", "name", "company", "city", "state", "subsector", "employees", "size_band",
                "rmp_first", "rmp_last", "active", "inventory_lb", "inventory_band", "families", "peer_group"]
    fac_rows = []
    for r in regs:
        p = plants[r["plant_id"]]
        fac_rows.append([r["epa_facility_id"], p["name"], p["company"], p["city"], p["state"], p["subsector"],
                         p["employees"], p["size_band"], r["rmp_first"], r["rmp_last"], r["active"],
                         r["inventory_lb"], r["inventory_band"], r["families"], p["peer_group_key"]])

    hold = sorted(obj["ChemicalHolding"], key=lambda h: (h["epa_facility_id"], h["rank"]))
    hold_rows = [[fidx[h["epa_facility_id"]], cidx[h["chemical_name"]], h["quantity_lb"], h["rank"]] for h in hold]

    acc = sorted(obj["Accident"], key=lambda a: (a["epa_facility_id"], a["date"] or "", a["accident_key"]))
    acc_cols = ["key", "facility", "date", "chemicals", "release_type", "release_source", "cause", "fix",
                "worker_injuries", "deaths", "evacuated"]
    acc_rows = [[a["accident_key"], fidx[a["epa_facility_id"]], a["date"], sorted({cidx[c] for c in a["chemicals"]}),
                 a["release_type"], a["release_source"], a["cause"], a["fix"],
                 a["worker_injuries"], a["deaths"], a["evacuated"]] for a in acc]

    est = {e["osha_key"]: e for e in obj["OshaEstablishment"]}
    mt = sorted(obj["PlantMatch"], key=lambda m: m["match_key"])
    mt_cols = ["key", "facility", "match_method", "confidence", "review_status", "osha_log_years",
               "osha_first_year", "osha_last_year"]
    mt_rows = [[m["match_key"], fidx[m["epa_facility_id"]], m["match_method"], m["confidence"], m["review_status"],
                est[m["osha_key"]]["n_log_years"], est[m["osha_key"]]["first_year"], est[m["osha_key"]]["last_year"]]
               for m in mt]

    pg = sorted(obj["PeerGroup"], key=lambda g: g["peer_group_key"])
    sb = obj["SizeBand"]
    otypes = []
    for t in spec["object_types"]:
        otypes.append({"api_name": t["api_name"], "display_name": t["display_name"],
                       "plural": t["plural_display_name"], "description": t["description"],
                       "primary_key": t["primary_key"], "title_property": t["title_property"],
                       "properties": [p["api_name"] for p in t["properties"]],
                       "count": census[t["api_name"]], "embedded": t["api_name"] in EMBEDDED})
    ltypes = []
    for l in spec["link_types"]:
        ltypes.append({"api_name": l["api_name"], "source": l["source"], "target": l["target"],
                       "cardinality": l["cardinality"], "description": l["description"],
                       "integrity": ex["integrity"][l["api_name"]]})
    actions = [{k: a.get(k) for k in ("api_name", "display_name", "description", "parameters",
                                      "submission_criteria", "edits")} for a in spec["action_types"]]
    data = {
        "source": {"repo": REPO, "commit": sha, "paths": SOURCE_PATHS,
                   "ontology": ex["ontology"]["display_name"], "ontology_version": ex["ontology"]["version"],
                   "built_by": "scripts/build_peers_ontology_data.py running chempeers.ontology"},
        "census": census,
        "object_types": otypes,
        "link_types": ltypes,
        "actions": actions,
        "chemicals": [[n, chem_fam[n]] for n in chem_names],
        "facility_cols": fac_cols, "facilities": fac_rows,
        "holding_cols": ["facility", "chemical", "quantity_lb", "rank"], "holdings": hold_rows,
        "accident_cols": acc_cols, "accidents": acc_rows,
        "match_cols": mt_cols, "matches": mt_rows,
        "peer_groups": [[g["peer_group_key"], g["subsector"], g["size_band"], g["n_plants"]] for g in pg],
        "size_bands": [[b["band"], b["plant_years"], b["median_hours"], b["one_case_swing"], b["zero_share_pct"],
                        b["pooled_trir"], b["stability_rho"]] for b in sb],
        "not_embedded": sorted(set(census) - set(EMBEDDED)),
        "initial_review": {
            "PlantMatch": dict(sorted(Counter(m["review_status"] for m in mt).items())),
            "Plant_rmp": dict(sorted(Counter(plants[r["plant_id"]]["review_status"] for r in regs).items())),
        },
    }
    return data


def dumps(data):
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"


def main():
    clone = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("RMP_PEERS_CLONE", "/home/user/ehs-chemical-peers")
    out = dumps(build(clone))
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    with open(DATA, "w", encoding="utf-8") as fh:
        fh.write(out)
    print("wrote", DATA, len(out), "bytes")


if __name__ == "__main__":
    main()
