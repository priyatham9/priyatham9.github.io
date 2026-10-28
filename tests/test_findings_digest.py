"""Checks for the findings digest (reports/findings-digest/index.html).

(1) Every number in a finding, a limitation or a chart label appears in the
source file the row cites. (2) Every limitation is a verbatim sentence of its
source. (3) The data block matches what scripts/build_findings_digest.py
produces from the sources now. (4) Nav, sitemap and link-check entries exist,
and the page has no em dashes and no immigration-criteria wording.

Sources: DIGEST_SOURCES=<dir>/<repo>/<path> if set, else `git show
origin/main:<path>` in the clones under DIGEST_CLONES (default /home/user),
else raw GitHub. A test skips when its sources cannot be read.

Run: python3 -m unittest discover -s tests -v
"""

import csv
import html
import html.parser
import importlib.util
import io
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "build_findings_digest", os.path.join(ROOT, "scripts", "build_findings_digest.py"))
bd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bd)

with open(bd.PAGE, encoding="utf-8") as fh:
    PAGE = fh.read()


class Cells(html.parser.HTMLParser):
    """Collects the text of table cells by (row id, class) and chart .dl spans."""

    def __init__(self):
        super().__init__()
        self.rows = {}
        self.dl = []
        self.links = []
        self._row = None
        self._cell = None
        self._dl = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "tr" and a.get("id"):
            self._row = a["id"]
            self.rows[self._row] = {}
        if tag == "td" and self._row:
            self._cell = [a.get("class", ""), a.get("data-src", ""), ""]
        if tag == "tspan" and a.get("class") == "dl":
            self._dl = True
            self.dl.append("")
        if tag == "a" and a.get("href") and self._row:
            self.links.append(a["href"])

    def handle_data(self, data):
        if self._cell is not None:
            self._cell[2] += data
        if self._dl:
            self.dl[-1] += data

    def handle_endtag(self, tag):
        if tag == "tspan":
            self._dl = False
        if tag == "td" and self._cell is not None:
            cls, src, text = self._cell
            self.rows[self._row][cls or "other"] = (src, bd.norm(text))
            self._cell = None
        if tag == "tr":
            self._row = None


def read(repo, path):
    try:
        return bd.norm(bd.read(repo, path))
    except Exception as e:  # sources unavailable
        raise unittest.SkipTest("source %s/%s unreadable: %s" % (repo, path, e))


P = Cells()
P.feed(PAGE)


class TestDigest(unittest.TestCase):
    def test_rows_present(self):
        self.assertGreaterEqual(len(P.rows), 10)
        self.assertEqual(len(P.rows), len(bd.SPECS))
        for rid, cells in P.rows.items():
            for k in ("f", "l", "w"):
                self.assertIn(k, cells, rid)

    def test_numbers_in_cited_source(self):
        for rid, cells in P.rows.items():
            for k in ("f", "l"):
                src, text = cells[k]
                repo, path = src.split("/", 1)
                source = read(repo, path)
                toks = bd.numbers(text)
                if k == "f":
                    self.assertTrue(toks, rid)
                for t in toks:
                    self.assertTrue(bd.number_in(t, source), "%s %s: %s not in %s" % (rid, k, t, src))

    def test_limitations_are_verbatim(self):
        for rid, cells in P.rows.items():
            src, text = cells["l"]
            repo, path = src.split("/", 1)
            source = read(repo, path)
            quote = text.replace(" " + path, "").strip()
            # markdown emphasis and code ticks are not part of the displayed text
            plain = source.replace("**", "").replace("`", "")
            self.assertIn(quote.replace("`", ""), plain, rid)

    def test_why_has_no_numbers(self):
        for rid, cells in P.rows.items():
            self.assertEqual(bd.numbers(cells["w"][1]), [], rid)

    def test_source_links_target_main(self):
        self.assertTrue(P.links)
        for h in P.links:
            self.assertRegex(h, r"^https://github\.com/priyatham9/ehs-[a-z-]+/blob/main/\S+$")
            m = re.match(r"https://github\.com/priyatham9/([^/]+)/blob/main/(.+)$", h)
            read(m.group(1), m.group(2))  # file exists on main

    def test_chart_numbers_match_csv(self):
        repo, path = bd.CHART_SRC
        rows = list(csv.DictReader(io.StringIO(bd.read(repo, path))))
        by_group = {r["group"]: r for r in rows}
        self.assertTrue(P.dl)
        cells = {v for r in rows for v in r.values()}
        for t in P.dl:
            self.assertIn(t.strip(), cells)
        groups = re.findall(r'<g class="crow" data-group="([^"]+)">', PAGE)
        self.assertGreaterEqual(len(groups), 5)
        for g in groups:
            g = html.unescape(g)
            r = by_group[g]
            self.assertGreaterEqual(int(r["facilities"]), 100)
            block = PAGE[PAGE.index('data-group="%s"' % html.escape(g, quote=True)):]
            block = block[:block.index("</g>")]
            for col in ("rate_lo", "rate_per_100fy", "rate_hi", "facilities"):
                self.assertIn(">%s<" % r[col], block, (g, col))
        # sorted highest first
        rates = [float(by_group[html.unescape(g)]["rate_per_100fy"]) for g in groups]
        self.assertEqual(rates, sorted(rates, reverse=True))

    def test_chart_is_deterministic(self):
        try:
            rows = bd.chart_rows()
        except Exception as e:
            self.skipTest(str(e))
        self.assertEqual(bd.build_chart(rows), bd.build_chart(rows))
        self.assertIn(bd.build_chart(rows), PAGE)

    def test_block_is_fresh(self):
        try:
            block = bd.build_block()
        except Exception as e:
            self.skipTest(str(e))
        self.assertIn(block, PAGE, "run scripts/build_findings_digest.py")

    def test_json_block_matches_table(self):
        m = re.search(r'<script type="application/json" id="digest-data">(.*?)</script>', PAGE, re.S)
        data = json.loads(m.group(1).replace("<\\/", "</"))
        self.assertEqual([r["id"] for r in data["rows"]], list(P.rows))
        for r in data["rows"]:
            self.assertEqual(bd.norm(r["finding"]), P.rows[r["id"]]["f"][1])

    def test_no_em_dashes_or_criteria_wording(self):
        with open(bd.__file__, encoding="utf-8") as fh:
            script = fh.read()
        for f in (PAGE, script):
            self.assertNotIn("—", f)
            self.assertNotIn("&mdash;", f)
            self.assertNotIn("&#8212;", f)
        body = re.sub(r"<(script|style)\b.*?</\1>", "", PAGE, flags=re.S).lower()
        for w in ("visa", "eb-1", "niw", "national interest", "national importance", "o-1", "petition", "uscis"):
            self.assertNotIn(w, body, w)

    def test_nav_and_lists(self):
        def f(p):
            with open(os.path.join(ROOT, p), encoding="utf-8") as fh:
                return fh.read()
        url = "https://priyatham9.github.io/reports/findings-digest/"
        self.assertIn('href="reports/findings-digest/"', f("index.html"))
        self.assertIn("/reports/findings-digest/", f("404.html"))
        self.assertIn(url, f("sitemap.xml"))
        self.assertIn(url, f("tools/pages.txt"))
        self.assertIn('<link rel="canonical" href="%s"' % url, PAGE)


if __name__ == "__main__":
    unittest.main()
