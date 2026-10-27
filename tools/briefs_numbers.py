"""Resolve the figures shown on the briefs from the committed repository outputs.

Used by tools/build_briefs.py (to write the pages) and tests/test_briefs.py
(to check the pages). Source repositories are looked up under SOURCES_DIR
(default: the parent folder of this repository, or the BRIEF_SOURCES env var).
"""

import csv
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "briefs", "numbers.json")


def sources_dir():
    return os.environ.get("BRIEF_SOURCES") or os.path.dirname(ROOT)


def load_manifest():
    with open(MANIFEST, encoding="utf-8") as fh:
        return json.load(fh)


def source_path(entry):
    return os.path.join(sources_dir(), entry["repo"], entry["file"])


def source_url(manifest, entry):
    return manifest["repos"][entry["repo"]] + entry["file"]


def _csv_value(path, spec):
    with open(path, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    col = spec["col"]
    if "agg" in spec:
        if spec["agg"] == "count":
            return len(rows)
        vals = [float(r[col]) for r in rows]
        return min(vals) if spec["agg"] == "min" else max(vals)
    if "row" in spec:
        return rows[spec["row"]][col]
    hits = [r for r in rows if all(r[k] == v for k, v in spec["where"].items())]
    if len(hits) != 1:
        raise ValueError(f"{path}: expected one row for {spec['where']}, found {len(hits)}")
    return hits[0][col]


def _json_value(path, keys):
    with open(path, encoding="utf-8") as fh:
        node = json.load(fh)
    for key in keys:
        node = node[key]
    return node


def raw_value(entry):
    path = source_path(entry)
    if "contains" in entry:
        with open(path, encoding="utf-8") as fh:
            if entry["contains"] not in fh.read():
                raise ValueError(f"{path}: text not found: {entry['contains']!r}")
        return entry["display"]
    if "csv" in entry:
        return _csv_value(path, entry["csv"])
    return _json_value(path, entry["json"])


def fmt(value, kind):
    if kind in ("text", "literal"):
        return str(value)
    v = float(value)
    if kind == "int":
        return f"{round(v):,}"
    if kind == "pct2":
        return f"{v * 100:.2f}%"
    if kind == "pctraw":
        return f"{v:g}%"
    if kind == "raw":
        return f"{v:g}"
    if kind.startswith("dec"):
        return f"{v:.{int(kind[3:])}f}"
    raise ValueError(kind)


def display(entry):
    return fmt(raw_value(entry), entry["fmt"])
