#!/usr/bin/env python3
"""Retrieve a NEW local-only discovery snapshot outside the public repository."""

import argparse, datetime, gzip, hashlib, json, pathlib, urllib.request
from build import ROOT, SOURCES

p = argparse.ArgumentParser()
p.add_argument("--destination", required=True, type=pathlib.Path)
args = p.parse_args()
destination = args.destination.resolve()
if destination.is_relative_to(ROOT):
    raise SystemExit(
        "Full report snapshots must remain outside the public repository. Choose a local release-artifacts directory."
    )
destination.mkdir(parents=True, exist_ok=False)
catalog = json.loads((SOURCES / "manifest.json").read_text())
manifest = []
for source in catalog:
    request = urllib.request.Request(
        source["url"],
        headers={
            "User-Agent": "IndependentFinancialStatementAudit/1.0 (public-data research)",
            "Accept": "application/json,text/html",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
        content_type = response.headers.get("Content-Type")
    filename = source["id"] + (
        ".html.gz" if source["storageKind"] == "curated-report-extract" else ".json.gz"
    )
    stored = gzip.compress(raw, mtime=0)
    destination.joinpath(filename).write_bytes(stored)
    manifest.append(
        {
            "id": source["id"],
            "url": source["url"],
            "retrievedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "contentType": content_type,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
            "storedFile": filename,
            "storedSha256": hashlib.sha256(stored).hexdigest(),
            "localOnly": True,
        }
    )
    print(source["id"], len(raw), manifest[-1]["sha256"])
destination.joinpath("local-discovery-manifest.json").write_text(
    json.dumps(manifest, indent=2) + "\n"
)
