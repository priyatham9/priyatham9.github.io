"""Checks for work/peers-ontology-explorer/.

(1) Every number written into the page's static HTML (data-n spans) equals the
value derived from data.json. (2) data.json records source repo, paths and a
40-character commit SHA, and is canonical (what the build script would write).
(3) Counts are internally consistent: embedded tables have as many rows as the
census says, and the link integrity numbers match the embedded objects. (4)
When a clone of ehs-chemical-peers is available (RMP_PEERS_CLONE, default
/home/user/ehs-chemical-peers) at the recorded commit, data.json equals a fresh
build; otherwise that test skips. (5) Page labels the actions as an in-browser
demo, states the size cap, has no external script or stylesheet and no em dash.

Run: python3 -m unittest discover -s tests -v
"""
import importlib.util
import json
import os
import re
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("bpod", os.path.join(ROOT, "scripts", "build_peers_ontology_data.py"))
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

PAGE_PATH = os.path.join(ROOT, "work", "peers-ontology-explorer", "index.html")
PAGE = open(PAGE_PATH, encoding="utf-8").read()
RAW = open(b.DATA, encoding="utf-8").read()
DATA = json.loads(RAW)


def expected():
    c = DATA["census"]
    return {"object_types": len(DATA["object_types"]), "link_types": len(DATA["link_types"]),
            "facilities": c["RmpRegistration"], "accidents": c["Accident"], "chemicals": c["Chemical"],
            "matches": c["PlantMatch"], "plants": c["Plant"], "actions": len(DATA["actions"]),
            "commit7": DATA["source"]["commit"][:7]}


class PeersExplorer(unittest.TestCase):
    def test_static_numbers_match_json(self):
        found = {}
        for k, v in re.findall(r'data-n="([a-z_0-9]+)">([^<]*)<', PAGE):
            found.setdefault(k, set()).add(v)
        exp = expected()
        self.assertEqual(set(found), set(exp))
        for k, v in exp.items():
            want = v if isinstance(v, str) else "{:,}".format(v)
            self.assertEqual(found[k], {want}, k)

    def test_source_recorded(self):
        s = DATA["source"]
        self.assertEqual(s["repo"], "priyatham9/ehs-chemical-peers")
        self.assertRegex(s["commit"], r"^[0-9a-f]{40}$")
        self.assertIn("src/chempeers/ontology/spec.json", s["paths"])

    def test_json_is_canonical(self):
        self.assertEqual(RAW, b.dumps(DATA))

    def test_embedded_counts_consistent(self):
        c = DATA["census"]
        self.assertEqual(len(DATA["facilities"]), c["RmpRegistration"])
        self.assertEqual(len(DATA["holdings"]), c["ChemicalHolding"])
        self.assertEqual(len(DATA["accidents"]), c["Accident"])
        self.assertEqual(len(DATA["matches"]), c["PlantMatch"])
        self.assertEqual(len(DATA["chemicals"]), c["Chemical"])
        self.assertEqual(len(DATA["peer_groups"]), c["PeerGroup"])
        self.assertEqual(len(DATA["size_bands"]), c["SizeBand"])
        for t in DATA["object_types"]:
            self.assertEqual(t["count"], c[t["api_name"]])
            self.assertEqual(t["embedded"], t["api_name"] not in DATA["not_embedded"])
        links = {l["api_name"]: l["integrity"] for l in DATA["link_types"]}
        self.assertEqual(links["rmp_osha_match"]["resolved"], c["PlantMatch"])
        self.assertEqual(links["holding_registration"]["resolved"], c["ChemicalHolding"])
        self.assertEqual(links["accident_registration"]["resolved"], c["Accident"])
        self.assertEqual(sum(len(a[3]) for a in DATA["accidents"]), links["accident_chemicals"]["resolved"])
        for l in DATA["link_types"]:
            self.assertEqual(l["integrity"]["dangling"], 0)

    def test_cross_references_in_range(self):
        nf, nc = len(DATA["facilities"]), len(DATA["chemicals"])
        for h in DATA["holdings"]:
            self.assertTrue(0 <= h[0] < nf and 0 <= h[1] < nc)
        for a in DATA["accidents"]:
            self.assertTrue(0 <= a[1] < nf and all(0 <= i < nc for i in a[3]))
        for m in DATA["matches"]:
            self.assertTrue(0 <= m[1] < nf)

    def test_page_labels_and_hygiene(self):
        self.assertIn("in-browser demo", PAGE)
        self.assertIn("Nothing is saved or sent anywhere", PAGE)
        self.assertIn("Size cap", PAGE)
        self.assertNotRegex(PAGE, r'<script[^>]+src=')
        self.assertNotRegex(PAGE, r'<link[^>]+rel="stylesheet"')
        self.assertNotIn("—", PAGE)
        self.assertNotIn("—", RAW)
        self.assertIn("not affiliated", PAGE.lower())

    def test_matches_fresh_build_when_clone_available(self):
        clone = os.environ.get("RMP_PEERS_CLONE", "/home/user/ehs-chemical-peers")
        if not os.path.isdir(os.path.join(clone, ".git")):
            self.skipTest("no ehs-chemical-peers clone at %s" % clone)
        sha = DATA["source"]["commit"]
        head = subprocess.check_output(["git", "-C", clone, "rev-parse", "HEAD"], text=True).strip()
        if head != sha:
            self.skipTest("clone is at %s, data.json built from %s" % (head[:7], sha[:7]))
        self.assertEqual(b.dumps(b.build(clone)), RAW)


if __name__ == "__main__":
    unittest.main()
