#!/usr/bin/env python3
"""HTML validation for Priyatham's research sites."""

import urllib.request
import urllib.error
import html.parser
import sys
import os
from collections import defaultdict

class HTMLValidator(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.tag_stack = []
        self.h1_count = 0
        self.title_found = False
        self.lang_found = False
        self.errors = []
        self.img_missing_alt = []
        self.text_content = []
        self.in_script = False
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)

        # Check for language attribute on html tag
        if tag == 'html':
            if 'lang' not in attrs_dict:
                self.errors.append("Missing lang attribute on <html>")
            else:
                self.lang_found = True

        # Track title
        if tag == 'title':
            self.title_found = True

        # Track h1 count
        if tag == 'h1':
            self.h1_count += 1

        # Check images for alt attribute
        if tag == 'img':
            if 'alt' not in attrs_dict:
                src = attrs_dict.get('src', 'unknown')
                self.img_missing_alt.append(src)

        # Track tag stack for sections we care about
        if tag in ('section', 'div', 'main', 'table'):
            self.tag_stack.append(tag)

        # Track script and style tags
        if tag == 'script':
            self.in_script = True
        elif tag == 'style':
            self.in_style = True

    def handle_endtag(self, tag):
        if tag == 'script':
            self.in_script = False
        elif tag == 'style':
            self.in_style = False

        # Check for mismatched tags
        if tag in ('section', 'div', 'main', 'table'):
            if not self.tag_stack:
                self.errors.append(f"Closing </{tag}> without opening tag")
            elif self.tag_stack[-1] != tag:
                self.errors.append(f"Mismatched tags: expected </{self.tag_stack[-1]}> but got </{tag}>")
            else:
                self.tag_stack.pop()

    def handle_data(self, data):
        # Only check text content outside of script and style
        if not self.in_script and not self.in_style:
            self.text_content.append(data)

    def finalize_checks(self):
        # Check for unclosed tags
        for tag in self.tag_stack:
            self.errors.append(f"Unclosed <{tag}> tag")

        # Check for missing title
        if not self.title_found:
            self.errors.append("Missing <title> tag")

        # Check for multiple h1 tags
        if self.h1_count > 1:
            self.errors.append(f"More than one <h1> tag found ({self.h1_count})")
        elif self.h1_count == 0:
            self.errors.append("No <h1> tag found")

        # Check for em dashes in visible text
        full_text = ''.join(self.text_content)
        if '—' in full_text:  # em dash
            self.errors.append("Em dash character (U+2014) found in visible text")

        # Report img missing alt
        if self.img_missing_alt:
            for src in self.img_missing_alt:
                self.errors.append(f"<img> missing alt attribute: {src}")

def fetch_page(url):
    """Fetch a page and return the HTML content."""
    req = urllib.request.Request(
        url,
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status not in range(200, 300):
                return None
            return response.read().decode('utf-8', errors='ignore')
    except Exception as e:
        return None

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

    all_errors = defaultdict(list)
    pages_checked = 0
    total_errors = 0

    for page_url in pages:
        print(f"Validating {page_url}...", file=sys.stderr)
        html_content = fetch_page(page_url)

        if html_content is None:
            all_errors[page_url].append("Failed to fetch page or non-2xx status")
            total_errors += 1
            continue

        validator = HTMLValidator()
        try:
            validator.feed(html_content)
        except Exception as e:
            all_errors[page_url].append(f"Parse error: {str(e)}")
            total_errors += 1
            continue

        validator.finalize_checks()
        pages_checked += 1

        if validator.errors:
            for error in validator.errors:
                all_errors[page_url].append(error)
                total_errors += 1

    # Print results
    print(f"\nPages validated: {pages_checked}\n", file=sys.stdout)

    if all_errors:
        print("HTML validation errors:")
        print("-" * 80)
        for page_url in pages:
            if page_url in all_errors:
                print(f"\n{page_url}")
                for error in all_errors[page_url]:
                    print(f"  {error}")
    else:
        print("All HTML validation passed!")

    # Exit with failure code if there are errors
    sys.exit(1 if total_errors > 0 else 0)

if __name__ == "__main__":
    main()
