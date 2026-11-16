"""Build the explicitly public static site; reject broken local dependencies."""
from html.parser import HTMLParser
from pathlib import Path
import argparse
import re
import shutil
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = ('index.html', '404.html')
OPTIONAL_PUBLIC_FILES = ('og.png', 'og.svg')
PUBLIC_DIRS = ('assets', 'labs', 'work/peers-ontology-explorer')
EXTENSIONS = {'.html', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg',
              '.webp', '.avif', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.txt', '.pdf'}


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if value and key in {'href', 'src', 'poster', 'data'}:
                self.urls.append(value)
            if value and key == 'srcset':
                self.urls.extend(item.strip().split()[0] for item in value.split(',') if item.strip())
            if value and key == 'style':
                self.urls.extend(css_urls(value))


def css_urls(source):
    return re.findall(r'''url\(\s*['"]?([^'"\s)]+)''', source) + re.findall(r'''@import\s+['"]([^'"]+)''', source)


def references(path):
    source = path.read_text(encoding='utf-8')
    if path.suffix == '.html':
        parser = References()
        parser.feed(source)
        return parser.urls + css_urls(source)
    if path.suffix == '.css':
        return css_urls(source)
    if path.suffix in {'.js', '.mjs'}:
        return re.findall(r'''(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\bfetch\s*\(\s*|\bnew\s+URL\s*\(\s*)['"]([^'"]+)['"]''', source)
    return []


def verify(output, dynamic_routes=()):
    errors = []
    for page in sorted(output.rglob('*')):
        if page.suffix not in {'.html', '.css', '.js', '.mjs'}:
            continue
        for url in references(page):
            parsed = urlsplit(url)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            path = unquote(parsed.path)
            if path in dynamic_routes:
                continue
            target = (output / path.lstrip('/') if path.startswith('/') else page.parent / path).resolve()
            if not target.is_relative_to(output.resolve()):
                errors.append(f'{page.relative_to(output)}: dependency escapes public root: {url}')
                continue
            candidates = [target, target / 'index.html']
            if not target.suffix:
                candidates.append(target.with_suffix('.html'))
            if not any(candidate.is_file() for candidate in candidates):
                errors.append(f'{page.relative_to(output)}: missing local dependency: {url}')
    if errors:
        raise ValueError('\n'.join(errors))


def build(root=ROOT, output=None):
    root = Path(root).resolve()
    output = Path(output or root / 'dist').resolve()
    if output == root or root.is_relative_to(output):
        raise ValueError('Output must not contain the source repository')
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    sources = [root / name for name in PUBLIC_FILES]
    sources.extend(root / name for name in OPTIONAL_PUBLIC_FILES if (root / name).exists())
    for directory in PUBLIC_DIRS:
        base = root / directory
        if base.is_symlink():
            raise ValueError(f'Public symlinks are forbidden: {base}')
        if base.exists():
            sources.extend(sorted(base.rglob('*')))
    for source in sources:
        if source.is_symlink():
            raise ValueError(f'Public symlinks are forbidden: {source}')
        if source.is_dir():
            continue
        if not source.is_file():
            raise ValueError(f'Missing required public page: {source}')
        relative = source.relative_to(root)
        if any(part.startswith('.') or part in {'node_modules', '__pycache__'} for part in relative.parts):
            continue
        if '.test.' in source.name or source.name.startswith('test_'):
            continue
        if source.suffix.lower() not in EXTENSIONS:
            continue
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    routes = {'/api/analysis'} if (root / 'api/analysis.mjs').is_file() else set()
    verify(output, routes)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    try:
        destination = build(output=args.output)
    except ValueError as error:
        parser.exit(1, f'Build failed:\n{error}\n')
    print(f'Built and verified {sum(p.is_file() for p in destination.rglob("*"))} public files in {destination}')
