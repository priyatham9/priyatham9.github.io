#!/usr/bin/env python3
"""Opt-in full-report verification. Downloads into memory; never republishes HTML."""

import argparse, gzip, json, pathlib, urllib.request
from build import SOURCES, read_source, verify_original


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--online", action="store_true")
    mode.add_argument("--local-originals", type=pathlib.Path)
    args = parser.parse_args()
    for meta in json.loads((SOURCES / "manifest.json").read_text()):
        if meta["storageKind"] != "curated-report-extract":
            continue
        extract = read_source(meta)
        if args.online:
            req = urllib.request.Request(
                meta["url"],
                headers={
                    "User-Agent": "IndependentFinancialStatementAudit/1.0 (public-data research)"
                },
            )
            with urllib.request.urlopen(req, timeout=60) as response:
                raw = response.read()
        else:
            raw = gzip.decompress(
                (args.local_originals / (meta["id"] + ".html.gz")).read_bytes()
            )
        verify_original(meta, raw, extract)
        print(
            meta["id"]
            + ": original response SHA-256/length and all excerpt memberships verified"
        )


if __name__ == "__main__":
    main()
