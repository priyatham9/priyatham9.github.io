"""Checks for the Foundry-style hub page (foundry-style/index.html).

(1) Every repository file linked on the page exists on the repository's main
branch. (2) Every number or phrase the page quotes from a source document is
still in that document. (3) The disclaimer, sitemap, link-check list and home
page links are in place.

Files are read from raw.githubusercontent.com. Set FOUNDRY_SOURCES to a folder
holding sibling clones (FOUNDRY_SOURCES/<repo>/<path>) to check offline.

Run: python3 -m unittest discover -s tests -v
"""

import os
import re
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.environ.get("FOUNDRY_SOURCES")
RAW = "https://raw.githubusercontent.com/priyatham9/{repo}/main/{path}"
BLOB = re.compile(r"https://github\.com/priyatham9/([\w.-]+)/blob/main/([^\"#?]+)")
SITE = "https://priyatham9.github.io/"


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


PAGE = read("foundry-style/index.html")
_cache = {}


def fetch(repo, path):
    """Return file text, or None when it does not exist on main."""
    key = (repo, path)
    if key in _cache:
        return _cache[key]
    if LOCAL:
        full = os.path.join(LOCAL, repo, path)
        text = open(full, encoding="utf-8").read() if os.path.isfile(full) else None
    else:
        try:
            with urllib.request.urlopen(RAW.format(repo=repo, path=path), timeout=30) as r:
                text = r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            text = None
    _cache[key] = text
    return text


# (page text, repo, path, text that must be in that file)
FACTS = [
    ("Seven object types", "ehs-osha-analysis", "docs/ontology.md",
     "| Establishment | `establishment_id` |"),
    ("2,801,064 filings", "ehs-osha-analysis", "docs/ontology.md", "(2,801,064 filings)"),
    ("whatever string the caller passes", "ehs-osha-analysis", "docs/ontology.md",
     "`actor` is whatever string the caller passes"),
    ("exits 1 when the committed file no longer matches", "ehs-osha-analysis",
     "docs/ontology.md", "exits 1 when it no longer matches the spec"),
    ("Functions are not generated", "ehs-osha-analysis", "docs/ontology.md",
     "Functions are not generated"),
    ("nothing is uploaded", "ehs-osha-analysis", "README.md", "nothing is uploaded"),
    ("Wilson 95% intervals and Fisher", "ehs-chemical-peers", "README.md",
     "Fisher's exact test"),
    ("200,000 hours", "ehs-chemical-peers", "README.md", "per 200,000 hours"),
    ("about 1 in 20 unrelated pairs", "ehs-chemical-peers", "src/chempeers/compare.py",
     "about 1 in 20 unrelated pairs"),
    ("PlantMatch", "ehs-chemical-peers", "docs/ontology.md", "PlantMatch"),
    ("pins that value", "grounded", "claims/check_claims.py", "still pins the expected value"),
    ("Thirteen U.S. Chemical Safety Board", "ehs-human-factors-ontology",
     "incidents/README.md", "13 U.S. Chemical Safety Board investigations"),
    ("Ten of the 13 investigations are coded, with 25 codings",
     "ehs-human-factors-ontology", "incidents/csb_coding.md",
     "10 of 13 listed investigations are coded; 25 codings"),
    ("One coder and no second-rater agreement", "ehs-human-factors-ontology",
     "incidents/README.md", "One coder, no second-rater agreement"),
]


class LinkedPaths(unittest.TestCase):
    def test_page_links_repo_files(self):
        self.assertGreaterEqual(len(BLOB.findall(PAGE)), 20)

    def test_every_linked_repo_file_exists(self):
        for repo, path in sorted(set(BLOB.findall(PAGE))):
            if repo == "priyatham9.github.io":  # this repository: check the working tree
                self.assertTrue(os.path.isfile(os.path.join(ROOT, path)), path)
                continue
            with self.subTest(repo=repo, path=path):
                self.assertIsNotNone(fetch(repo, path), f"{repo}/{path} missing on main")

    def test_own_test_link_exists(self):
        self.assertTrue(os.path.isfile(os.path.join(ROOT, "tests", "test_foundry_style.py")))


class QuotedFacts(unittest.TestCase):
    def test_facts_are_on_the_page_and_in_the_source(self):
        flat = re.sub(r"<[^>]+>", "", PAGE)
        for shown, repo, path, needle in FACTS:
            with self.subTest(fact=shown):
                self.assertIn(shown, flat)
                text = fetch(repo, path)
                self.assertIsNotNone(text, f"{repo}/{path} missing")
                self.assertIn(needle, text)

    def test_spec_counts(self):
        import json
        spec = json.loads(fetch("ehs-osha-analysis", "src/ehs_osha/ontology/spec.json"))
        self.assertEqual(len(spec["object_types"]), 7)
        self.assertEqual(len(spec["action_types"]), 4)
        self.assertEqual(len(spec["functions"]), 5)

    def test_chemical_peers_compare_page_is_merged(self):
        for p in ("docs/compare.html", "docs/data/compare.json", "tests/test_compare.py"):
            self.assertIsNotNone(fetch("ehs-chemical-peers", p), p)


class PageAndSite(unittest.TestCase):
    def test_disclaimer(self):
        flat = re.sub(r"<[^>]+>", "", PAGE)
        for phrase in ("not made by, affiliated with or endorsed by Palantir",
                       "without a Foundry account", "no employer data"):
            self.assertIn(phrase, flat)

    def test_each_entry_has_paths_limits_and_mirrors(self):
        entries = re.findall(r'<section class="entry".*?</section>', PAGE, re.S)
        self.assertEqual(len(entries), 6)
        for e in entries:
            for label in ("Mirrors", "Repo paths", "Live page", "Limits"):
                self.assertIn(f"<dt>{label}</dt>", e)

    def test_live_links_are_listed_for_checks(self):
        pages = read("tools/pages.txt")
        live = set(re.findall(r'href="(https://priyatham9\.github\.io/[^"]+)"', PAGE))
        live.discard(SITE)
        self.assertTrue(live)
        for url in live:
            with self.subTest(url=url):
                self.assertRegex(pages, rf"(?m)^{re.escape(url)}$")

    def test_listed_in_sitemap_pages_and_home(self):
        url = SITE + "foundry-style/"
        self.assertIn(f"<loc>{url}</loc>", read("sitemap.xml"))
        self.assertRegex(read("tools/pages.txt"), rf"(?m)^{re.escape(url)}$")
        self.assertGreaterEqual(read("index.html").count('href="foundry-style/"'), 2)


if __name__ == "__main__":
    unittest.main()
