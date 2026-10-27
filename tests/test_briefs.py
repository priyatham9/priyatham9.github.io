"""Checks for the plain-language briefs.

Every number on a brief must (1) be declared in briefs/numbers.json with the
repository file it comes from, (2) match that file when re-read, (3) be shown
identically in the English and Spanish pages, and (4) be linked to its source.
Source repositories are read from BRIEF_SOURCES (default: sibling folders).

Run: python3 -m unittest discover -s tests -v
"""

import html.parser
import os
import re
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import briefs_numbers as bn  # noqa: E402

SLUGS = ["small-workplace-rates", "implausible-hours", "low-rate-chemical-risk"]
MANIFEST = bn.load_manifest()
NUMBERS = MANIFEST["numbers"]


class Page(html.parser.HTMLParser):
    """Collects numbered spans, prose text outside them, links and lang."""

    def __init__(self):
        super().__init__()
        self.nums = []  # (id, text)
        self.prose = []
        self.links = set()
        self.lang = None
        self._span = None
        self._skip = 0
        self._in_body = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html":
            self.lang = a.get("lang")
        if tag == "body":
            self._in_body = True
        if tag in ("script", "style", "time", "code"):
            self._skip += 1
        if tag == "a" and a.get("href"):
            self.links.add(a["href"])
        if tag == "span" and "data-num" in a:
            self._span = [a["data-num"], ""]

    def handle_endtag(self, tag):
        if tag in ("script", "style", "time", "code"):
            self._skip -= 1
        if tag == "span" and self._span is not None:
            self.nums.append(tuple(self._span))
            self._span = None

    def handle_data(self, data):
        if self._span is not None:
            self._span[1] += data
        elif self._in_body and not self._skip:
            self.prose.append(data)


def parse(path):
    p = Page()
    with open(os.path.join(ROOT, path), encoding="utf-8") as fh:
        p.feed(fh.read())
    return p


def brief_paths(slug):
    return {"en": f"briefs/{slug}/index.html", "es": f"briefs/{slug}/es/index.html"}


class ManifestMatchesSources(unittest.TestCase):
    def test_source_repos_present(self):
        for entry in NUMBERS.values():
            self.assertTrue(os.path.isfile(bn.source_path(entry)), bn.source_path(entry))

    def test_every_display_matches_source_file(self):
        for key, entry in NUMBERS.items():
            with self.subTest(number=key):
                self.assertEqual(bn.display(entry), entry["display"])

    def test_json_numbers_appear_literally_in_source_text(self):
        for key, entry in NUMBERS.items():
            if "json" not in entry or entry["fmt"] == "text":
                continue
            with self.subTest(number=key):
                with open(bn.source_path(entry), encoding="utf-8") as fh:
                    text = fh.read()
                value = bn.raw_value(entry)
                self.assertIn(f" {value}", text.replace(":", ": ").replace("  ", " "))

    def test_source_links_point_to_default_branch_files(self):
        for key, entry in NUMBERS.items():
            with self.subTest(number=key):
                url = bn.source_url(MANIFEST, entry)
                self.assertRegex(url, r"^https://github\.com/priyatham9/[\w.-]+/blob/main/\S+$")


class BriefPages(unittest.TestCase):
    def test_numbers_match_manifest_and_are_linked(self):
        for slug in SLUGS:
            for lang, path in brief_paths(slug).items():
                with self.subTest(page=path):
                    page = parse(path)
                    self.assertTrue(page.nums, "page shows no numbers")
                    for key, text in page.nums:
                        self.assertIn(key, NUMBERS)
                        self.assertEqual(text, NUMBERS[key]["display"])
                        self.assertIn(bn.source_url(MANIFEST, NUMBERS[key]), page.links)

    def test_no_unsourced_digits_in_prose(self):
        for slug in SLUGS:
            for path in brief_paths(slug).values():
                with self.subTest(page=path):
                    text = " ".join(parse(path).prose)
                    self.assertNotRegex(text, r"\d", "digit outside a sourced number")

    def test_english_and_spanish_use_the_same_numbers(self):
        for slug in SLUGS:
            paths = brief_paths(slug)
            en = {k for k, _ in parse(paths["en"]).nums}
            es = {k for k, _ in parse(paths["es"]).nums}
            with self.subTest(brief=slug):
                self.assertEqual(en, es)

    def test_every_manifest_number_is_used(self):
        used = set()
        for slug in SLUGS:
            for path in brief_paths(slug).values():
                used |= {k for k, _ in parse(path).nums}
        self.assertEqual(used, set(NUMBERS))

    def test_spanish_pages_declare_and_flag_translation(self):
        for slug in SLUGS:
            paths = brief_paths(slug)
            en, es = parse(paths["en"]), parse(paths["es"])
            with self.subTest(brief=slug):
                self.assertEqual(en.lang, "en")
                self.assertEqual(es.lang, "es")
                self.assertIn("traducción al español", " ".join(es.prose))
                self.assertIn("Spanish translation", " ".join(en.prose))
                self.assertIn("es/", en.links)

    def test_pages_are_up_to_date_with_builder(self):
        before = {}
        for slug in SLUGS:
            for path in brief_paths(slug).values():
                with open(os.path.join(ROOT, path), encoding="utf-8") as fh:
                    before[path] = fh.read()
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build_briefs.py")],
                       check=True, capture_output=True)
        for path, old in before.items():
            with self.subTest(page=path):
                with open(os.path.join(ROOT, path), encoding="utf-8") as fh:
                    self.assertEqual(fh.read(), old, "run python3 tools/build_briefs.py")


class SiteListing(unittest.TestCase):
    def test_briefs_listed_for_crawlers_and_checks(self):
        with open(os.path.join(ROOT, "sitemap.xml"), encoding="utf-8") as fh:
            sitemap = fh.read()
        with open(os.path.join(ROOT, "tools", "pages.txt"), encoding="utf-8") as fh:
            pages = fh.read()
        urls = ["https://priyatham9.github.io/briefs/"]
        for slug in SLUGS:
            urls += [f"https://priyatham9.github.io/briefs/{slug}/",
                     f"https://priyatham9.github.io/briefs/{slug}/es/"]
        for url in urls:
            with self.subTest(url=url):
                self.assertIn(f"<loc>{url}</loc>", sitemap)
                self.assertTrue(re.search(rf"^{re.escape(url)}$", pages, re.M))


if __name__ == "__main__":
    unittest.main()
