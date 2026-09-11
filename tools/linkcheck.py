#!/usr/bin/env python3
"""Link checker for Priyatham's research sites."""

import urllib.request
import urllib.error
import html.parser
import sys
import os
from urllib.parse import urljoin, urlparse
from collections import defaultdict

# Internal domains we control
INTERNAL_DOMAINS = {'priyatham9.github.io', 'github.com'}

class LinkExtractor(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.og_images = []
        self.canonicals = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        if tag == 'a' and 'href' in attrs_dict:
            self.links.append(attrs_dict['href'])
        elif tag == 'img' and 'src' in attrs_dict:
            self.links.append(attrs_dict['src'])
        elif tag == 'script' and 'src' in attrs_dict:
            self.links.append(attrs_dict['src'])
        elif tag == 'link' and 'href' in attrs_dict:
            href = attrs_dict['href']
            rel = attrs_dict.get('rel', '')
            # Skip preconnect and prefetch
            if rel not in ('preconnect', 'prefetch', 'dns-prefetch'):
                self.links.append(href)
            # Track canonical links
            if rel == 'canonical':
                self.canonicals.append(href)
        elif tag == 'meta' and 'property' in attrs_dict and attrs_dict['property'] == 'og:image' and 'content' in attrs_dict:
            self.og_images.append(attrs_dict['content'])

def fetch_page(url):
    """Fetch a page and return the HTML content."""
    req = urllib.request.Request(
        url,
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.read().decode('utf-8', errors='ignore')
    except Exception as e:
        return None

def extract_links(html_content, page_url):
    """Extract all links from HTML content."""
    parser = LinkExtractor()
    try:
        parser.feed(html_content)
    except:
        pass

    links = []
    for link in parser.links:
        if link and not link.startswith(('mailto:', 'data:', 'tel:', '#')):
            # Skip fragments in relative links
            if '#' in link:
                link = link.split('#')[0]
            if link:
                absolute_url = urljoin(page_url, link)
                links.append(absolute_url)

    og_images = []
    for img in parser.og_images:
        if img and not img.startswith(('mailto:', 'data:', 'tel:')):
            absolute_url = urljoin(page_url, img)
            og_images.append(absolute_url)

    canonicals = []
    for canonical in parser.canonicals:
        if canonical and not canonical.startswith(('mailto:', 'data:', 'tel:')):
            absolute_url = urljoin(page_url, canonical)
            canonicals.append(absolute_url)

    return links, og_images, canonicals

def is_internal_link(url):
    """Check if a link is internal (priyatham9.github.io or github.com/priyatham9)."""
    parsed = urlparse(url)
    host = parsed.netloc.lower()

    if 'priyatham9.github.io' in host:
        return True
    if 'github.com' in host and 'priyatham9' in url:
        return True
    return False

def check_url_status(url):
    """Check URL status with HEAD request (fallback to GET)."""
    req = urllib.request.Request(
        url,
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'},
        method='HEAD'
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as e:
        if e.code == 405:
            req = urllib.request.Request(
                url,
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'},
                method='GET'
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as response:
                    return response.status
            except urllib.error.HTTPError as e2:
                return e2.code
        return e.code
    except urllib.error.URLError:
        return 999
    except Exception:
        return 999

def read_pages_file(filepath):
    """Read list of pages from pages.txt."""
    if not os.path.exists(filepath):
        return []
    with open(filepath, 'r') as f:
        return [line.strip() for line in f if line.strip()]

def main():
    # Read pages from pages.txt
    pages_file = os.path.join(os.path.dirname(__file__), 'pages.txt')
    pages = read_pages_file(pages_file)

    if not pages:
        print("Error: pages.txt not found or empty", file=sys.stderr)
        sys.exit(1)

    all_links = defaultdict(set)
    all_og_images = {}
    all_canonicals = {}
    broken_links = defaultdict(list)
    broken_internal_links = []
    external_warnings = []
    links_checked = 0
    internal_failures = 0

    # Fetch and extract links from all pages
    for page_url in pages:
        print(f"Fetching {page_url}...", file=sys.stderr)
        html_content = fetch_page(page_url)
        if html_content:
            links, og_images, canonicals = extract_links(html_content, page_url)
            all_links[page_url].update(links)
            if og_images:
                all_og_images[page_url] = og_images
            if canonicals:
                all_canonicals[page_url] = canonicals
        else:
            print(f"  Failed to fetch {page_url}", file=sys.stderr)

    # Check all links and build broken links dict
    print("Checking links...", file=sys.stderr)
    all_urls_to_check = set()
    for links in all_links.values():
        all_urls_to_check.update(links)
    for og_urls in all_og_images.values():
        all_urls_to_check.update(og_urls)
    for canonical_urls in all_canonicals.values():
        all_urls_to_check.update(canonical_urls)

    # Add special checks for each page (only for directories, not HTML files)
    for page in pages:
        # Only check robots.txt and sitemap.xml for directories
        if page.endswith('/') or not page.endswith('.html'):
            page_base = page.rstrip('/')
            all_urls_to_check.add(page_base + '/robots.txt')
            all_urls_to_check.add(page_base + '/sitemap.xml')

    url_status = {}
    for url in sorted(all_urls_to_check):
        status = check_url_status(url)
        url_status[url] = status
        links_checked += 1

        is_internal = is_internal_link(url)

        if status not in range(200, 300):
            # Determine which page this link came from
            found_page = None
            for page_url, links in all_links.items():
                if url in links:
                    found_page = page_url
                    break
            if not found_page:
                for page_url, og_urls in all_og_images.items():
                    if url in og_urls:
                        found_page = page_url
                        break
            if not found_page:
                for page_url, canonical_urls in all_canonicals.items():
                    if url in canonical_urls:
                        found_page = page_url
                        break
            if not found_page:
                # Special check - robots.txt or sitemap.xml (only for directories)
                for page in pages:
                    if page.endswith('/') or not page.endswith('.html'):
                        page_base = page.rstrip('/')
                        if url == page_base + '/robots.txt' or url == page_base + '/sitemap.xml':
                            found_page = page
                            break

            if found_page:
                if is_internal:
                    broken_links[found_page].append((url, status))
                    broken_internal_links.append((found_page, url, status))
                    if status not in range(200, 300):
                        internal_failures += 1
                else:
                    external_warnings.append((found_page, url, status))

    # Print results
    print(f"\nLinks checked: {links_checked}\n", file=sys.stdout)

    if broken_links:
        print("Internal link failures (will cause exit 1):")
        print("-" * 80)
        for page_url in pages:
            if page_url in broken_links:
                print(f"\n{page_url}")
                for url, status in sorted(broken_links[page_url]):
                    print(f"  {status:3d} {url}")

    if external_warnings:
        print("\nExternal link warnings (informational only):")
        print("-" * 80)
        for page_url, url, status in sorted(external_warnings):
            print(f"  {status:3d} {url} (from {page_url})")

    if not broken_links and not external_warnings:
        print("All links OK!")

    # Exit with failure code if there are internal failures
    sys.exit(1 if internal_failures > 0 else 0)

if __name__ == "__main__":
    main()
