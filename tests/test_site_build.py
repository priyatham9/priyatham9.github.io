"""Exercise deployment boundaries and broken dependency failures."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('build_site', Path(__file__).resolve().parents[1] / 'scripts/build_site.py')
site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site)


class StaticBuild(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.write('index.html', '<a href="/labs/demo/">Demo</a>')
        self.write('404.html', '<a href="/">Home</a>')
        self.write('labs/demo/index.html', '<script type="module" src="./app.mjs"></script>')
        self.write('labs/demo/app.mjs', 'import {value} from "./model.mjs";')
        self.write('labs/demo/model.mjs', 'export const value = 1;')

    def write(self, path, content):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def test_public_allowlist_and_stale_output_cleanup(self):
        for path in ('scripts/secret.py', 'tests/private.html', 'data/private.json', '.env',
                     'work/private/index.html', 'labs/demo/source.py', 'labs/.secret.json', 'dist/stale.html'):
            self.write(path, 'private')
        output = site.build(self.root)
        self.assertEqual({str(p.relative_to(output)) for p in output.rglob('*') if p.is_file()},
                         {'index.html', '404.html', 'labs/demo/index.html', 'labs/demo/app.mjs', 'labs/demo/model.mjs'})
        before = {p.relative_to(output): p.read_bytes() for p in output.rglob('*') if p.is_file()}
        site.build(self.root)
        self.assertEqual(before, {p.relative_to(output): p.read_bytes() for p in output.rglob('*') if p.is_file()})

    def test_missing_asset_fails(self):
        self.write('labs/demo/index.html', '<img src="./missing.svg">')
        with self.assertRaisesRegex(ValueError, 'missing.svg'):
            site.build(self.root)

    def test_missing_module_dependency_fails(self):
        self.write('labs/demo/app.mjs', 'import "./missing.mjs";')
        with self.assertRaisesRegex(ValueError, 'missing.mjs'):
            site.build(self.root)

    def test_module_data_directory_base(self):
        self.write('labs/demo/app.mjs', 'const base = new URL("./data/", import.meta.url);')
        self.write('labs/demo/data/corpus.json', '[]')
        site.build(self.root)

    def test_missing_module_data_directory_fails(self):
        self.write('labs/demo/app.mjs', 'const base = new URL("./missing/", import.meta.url);')
        with self.assertRaisesRegex(ValueError, 'missing/'):
            site.build(self.root)

    def test_missing_css_dependency_fails(self):
        self.write('labs/demo/index.html', '<link href="./style.css" rel="stylesheet">')
        self.write('labs/demo/style.css', 'body { background: url("missing.png") }')
        with self.assertRaisesRegex(ValueError, 'missing.png'):
            site.build(self.root)

    def test_external_urls_fragments_and_clean_urls(self):
        self.write('index.html', '<a href="https://example.org/old-work">Old work</a><a href="#about">About</a><a href="/labs/demo?mode=1">Demo</a>')
        site.build(self.root)

    def test_public_symlink_rejected(self):
        (self.root / 'labs/demo/leak.json').symlink_to(self.root / 'index.html')
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            site.build(self.root)


if __name__ == '__main__':
    unittest.main()
