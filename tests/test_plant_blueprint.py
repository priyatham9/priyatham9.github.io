"""Checks for work/plant-blueprint.html.

(1) The embedded #plant-data block equals what scripts/build_plant_blueprint_data.py
builds from the source repositories. (2) Key numbers also appear in the sources'
own tables (docs/paper.md, CSV outputs), read independently of the build script.
(3) Banner text, pinned three.js URL, links, no em dashes. (4) The node
determinism check passes.

Sources: PLANT_SOURCES=<dir with ehs-chemical-peers/ and ehs-osha-analysis/>
(default /home/user); tests that need them are skipped when absent.
Run: python3 -m unittest discover -s tests -v
"""
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get("PLANT_SOURCES", "/home/user")
PAGE = os.path.join(ROOT, "work", "plant-blueprint.html")


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as fh:
        return fh.read()


def src(repo, path):
    with open(os.path.join(SRC, repo, path), encoding="utf-8") as fh:
        return fh.read()


def embedded():
    m = re.search(r'<script type="application/json" id="plant-data">(.*?)</script>', read("work", "plant-blueprint.html"), re.S)
    return json.loads(m.group(1))


have_src = all(os.path.isdir(os.path.join(SRC, r)) for r in ("ehs-chemical-peers", "ehs-osha-analysis"))


class PlantBlueprint(unittest.TestCase):
    def test_banners_and_pins(self):
        h = read("work", "plant-blueprint.html")
        self.assertIn("Simulated digital twin of a synthetic site. No real facility or live telemetry; incident rates are drawn from public statistics, behaviour is a model.", h)
        self.assertIn("Illustrative schematic of a generic plant, not a real facility; units are annotated with statistics from public data, not measurements of this layout.", h)
        self.assertIn("https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js", h)
        self.assertNotRegex(h, r"https?://(?!cdnjs\.cloudflare\.com|fonts\.|priyatham9\.github\.io|github\.com|linkedin\.com|schema\.org|www\.w3\.org)[\w.-]+/[^\"' ]*\.js")

    def test_no_em_dashes(self):
        for rel in ("work/plant-blueprint.html", "work/plant-blueprint.js", "work/plant-blueprint-sim.js",
                    "scripts/build_plant_blueprint_data.py", "tests/test_plant_blueprint.py", "tests/plant_sim_check.js"):
            self.assertNotIn(chr(0x2014), read(*rel.split("/")), rel)

    def test_linked_from_site(self):
        self.assertIn("plant-blueprint.html", read("work", "index.html"))
        self.assertIn("work/plant-blueprint.html", read("index.html"))
        self.assertIn("work/plant-blueprint.html", read("sitemap.xml"))
        self.assertIn("work/plant-blueprint.html", read("tools", "pages.txt"))

    @unittest.skipUnless(have_src, "source clones not available")
    def test_embedded_block_is_current(self):
        env = dict(os.environ, PLANT_SOURCES=SRC)
        r = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "build_plant_blueprint_data.py"), "--check"], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    @unittest.skipUnless(have_src, "source clones not available")
    def test_numbers_match_source_tables(self):
        d = embedded()
        paper = src("ehs-chemical-peers", "docs/paper.md")
        # release anatomy table in paper.md (Table 8) vs embedded flag counts
        for kind, field in (("Where from", "source"), ("What happened", "type"), ("Contributing cause", "cause")):
            for x in d["release_flags"][field]:
                row = "| %s | %s | %s |" % (kind, x["label"], format(x["n"], ","))
                self.assertIn(row, paper, row)
        # release predictors table (Table 6) vs the inventory bands used as incident rates
        for b in d["sim_rates"]["release_per_plant_year"]["bands"]:
            row = "| Inventory: %s | %d / %s (" % (b["label"], b["events"], format(b["plant_years"], ","))
            self.assertIn(row, paper, row)
            self.assertIn("%.2f%%)" % b["rate_pct"], paper[paper.index(row):paper.index(row) + 60])
        # OSHA filing quality
        with open(os.path.join(SRC, "ehs-osha-analysis", "outputs/tables/quality_overall.csv"), encoding="utf-8") as fh:
            q = next(csv.DictReader(fh))
        f = d["sim_rates"]["filing_implausible"]
        self.assertEqual(f["n_filings"], int(q["n_filings"]))
        self.assertEqual(f["n_implausible"], int(q["n_implausible"]))
        self.assertAlmostEqual(f["share"], f["n_implausible"] / f["n_filings"], places=9)
        # every cited source file exists in the clones
        for u in d["units"].values():
            for s in u["stats"]:
                repo, path = s["src"].split(":")
                self.assertTrue(os.path.exists(os.path.join(SRC, repo, path)), s["src"])
        # interval coherence
        for b in d["sim_rates"]["release_per_plant_year"]["bands"]:
            self.assertLess(b["wilson_pct"][0], b["rate_pct"])
            self.assertGreater(b["wilson_pct"][1], b["rate_pct"])
            self.assertAlmostEqual(100.0 * b["events"] / b["plant_years"], b["rate_pct"], places=3)

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_simulation_determinism(self):
        r = subprocess.run(["node", os.path.join(ROOT, "tests", "plant_sim_check.js")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
