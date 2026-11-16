#!/usr/bin/env python3
"""Verify official licensed source bytes without replacing pinned evidence."""

import hashlib
from html.parser import HTMLParser
import io
import json
import pathlib
import urllib.request
import zipfile

HERE = pathlib.Path(__file__).resolve().parent


def download(url):
    req = urllib.request.Request(
        url, headers={"User-Agent": "IndependentCampaignDataAudit/1.0"}
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read()


def verify(body, meta):
    if len(body) != meta["bytes"] or hashlib.sha256(body).hexdigest() != meta["sha256"]:
        raise ValueError("Original source hash/length mismatch")


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def main():
    source = json.loads((HERE / "sources/manifest.json").read_text())
    raw = download(source["archive"]["url"])
    verify(raw, source["archive"])
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        inner = z.read(source["innerArchive"]["member"])
    verify(inner, source["innerArchive"])
    with zipfile.ZipFile(io.BytesIO(inner)) as z:
        data = z.read(source["data"]["member"])
        docs = z.read(source["documentation"]["member"])
    verify(data, source["data"])
    verify(docs, source["documentation"])
    normalized = " ".join(docs.decode("utf-8-sig").split())
    if any(
        quote not in normalized
        for quote in source["documentation"]["excerpts"].values()
    ):
        raise ValueError("Documentation excerpt membership mismatch")
    page = download(source["license"]["evidenceUrl"])
    parser = PlainText()
    parser.feed(page.decode())
    if source["license"]["statement"] not in " ".join(" ".join(parser.parts).split()):
        raise ValueError(
            "Official page no longer displays the pinned license statement; review licensing before redistribution"
        )
    print(
        "Official archive, nested archive, CSV and documentation hashes verified; all excerpts match; current official CC BY 4.0 statement confirmed."
    )
    print("License page original response SHA-256:", source["license"]["pageSha256"])
    print("License page current response SHA-256:", hashlib.sha256(page).hexdigest())


if __name__ == "__main__":
    main()
