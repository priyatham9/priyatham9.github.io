"""Checks for the RMP accident insights page (reports/rmp-accident-insights/index.html).

(1) The headline numbers on the page equal the values in data.json (formatted
to two decimals). (2) The generated block of the page is exactly what
scripts/build_rmp_insights_data.py renders from data.json, so no number can be
edited by hand. (3) data.json records its source repo, paths and commit SHA.
(4) When a clone of ehs-chemical-peers is available (RMP_PEERS_CLONE, default
/home/user/ehs-chemical-peers), data.json equals what the script builds from
the CSVs at the recorded commit; otherwise that test skips. (5) The limits box,
nav, sitemap and link-check entries exist; no em dashes.

Run: python3 -m unittest discover -s tests -v
"""
import importlib.util
import json
import os
import re
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("brid", os.path.join(ROOT, "scripts", "build_rmp_insights_data.py"))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

PAGE = open(b.PAGE, encoding="utf-8").read()
DATA = json.load(open(b.DATA, encoding="utf-8"))


def headline():
    return dict(re.findall(r'data-h="([a-z_0-9]+)">([^<]*)<', PAGE))


class RmpInsights(unittest.TestCase):
    def test_headline_numbers_match_json(self):
        h, tt = headline(), DATA["trend_tests"]
        sev = {r["measure"]: r for r in DATA["severity"]}
        top = [r for r in DATA["industry"] if int(r["facilities"]) >= b.SMALL_GROUP][0]
        self.assertEqual(h["rate_2010_2014"], "%.2f" % float(tt["rate_2010_2014"]))
        self.assertEqual(h["rate_2020_2024"], "%.2f" % float(tt["rate_2020_2024"]))
        self.assertEqual(h["any_injury_pct"], "%.2f%%" % float(sev["any_injury"]["pct"]))
        self.assertEqual(h["top_rate"], "%.2f" % float(top["rate_per_100fy"]))
        self.assertEqual(len(h), 4)

    def test_generated_block_matches_json(self):
        page, _ = b.write_all(DATA)
        self.assertEqual(page, PAGE, "page block differs from what data.json renders; run the build script")

    def test_json_is_canonical(self):
        _, js = b.write_all(DATA)
        with open(b.DATA, encoding="utf-8") as fh:
            self.assertEqual(fh.read(), js)

    def test_source_recorded(self):
        s = DATA["source"]
        self.assertEqual(s["repo"], "priyatham9/ehs-chemical-peers")
        self.assertRegex(s["commit"], r"^[0-9a-f]{40}$")
        self.assertIn(s["commit"], PAGE)
        for p in list(s["csv_paths"].values()) + list(s["doc_paths"].values()):
            self.assertTrue(p.startswith(("outputs/", "docs/")))
            self.assertIn(p, PAGE)

    def test_data_matches_source_csvs(self):
        if not os.path.isdir(os.path.join(b.CLONE, ".git")):
            self.skipTest("no clone of ehs-chemical-peers")
        sha = DATA["source"]["commit"]
        try:
            b.REF = sha
            fresh = b.build()
        except subprocess.CalledProcessError:
            self.skipTest("recorded commit not in clone")
        self.assertEqual(fresh, DATA)

    def test_counts_and_limits(self):
        self.assertEqual(len(DATA["trend"]), 15)
        self.assertEqual(len(DATA["severity"]), 7)
        self.assertEqual(len(DATA["industry"]), 17)
        self.assertEqual(PAGE.count('class="chart"'), 3)
        low = PAGE.lower()
        for w in ("under-observed", "rmp-covered facilities only", "initiating-event"):
            self.assertIn(w, low)
        self.assertIn('id="limits"', PAGE)

    def test_no_em_dash_and_nav(self):
        for t in (PAGE, open(b.__file__, encoding="utf-8").read()):
            self.assertNotIn("—", t)
            self.assertNotIn("&mdash;", t)
        url = "https://priyatham9.github.io/reports/rmp-accident-insights/"
        f = lambda p: open(os.path.join(ROOT, p), encoding="utf-8").read()
        self.assertIn('href="reports/rmp-accident-insights/"', f("index.html"))
        self.assertIn("/reports/rmp-accident-insights/", f("404.html"))
        self.assertIn(url, f("sitemap.xml"))
        self.assertIn(url, f("tools/pages.txt"))
        self.assertIn('<link rel="canonical" href="%s"' % url, PAGE)


if __name__ == "__main__":
    unittest.main()
