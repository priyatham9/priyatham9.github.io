"""Check the public campaign audit against its real, pinned local artifact.

Requires playwright==1.62.0 and its Chromium browser. An ephemeral stdlib HTTP
server is always cleaned up. These interface regressions complement the
independent model replay; they do not refit models or claim a usability study.
"""

import functools
import hashlib
import http.server
import json
import threading
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / "labs/crm/campaign.data.json"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def select_row(page, row):
    page.locator("#record").fill(str(row))
    page.locator("#record").dispatch_event("change")


def record_export(page):
    with page.expect_download() as event:
        page.locator("#export-record").click()
    return json.loads(Path(event.value.path()).read_text())


def paired_evidence(page, origin, data, digest):
    page.goto(origin + "/labs/crm/campaign.html")
    expect(page.locator("#audit")).to_be_visible()
    expect(page.locator("#source-credit")).to_contain_text("CC-BY-4.0")
    for index, metric in enumerate(("averagePrecision", "brier", "logLoss")):
        row = page.locator(".metric-row").nth(index)
        for model in ("withoutDuration", "withDuration"):
            expect(row).to_contain_text(
                f"{data['models'][model]['metrics'][metric]:.3f}"
            )
    for model in ("withoutDuration", "withDuration"):
        budget = data["models"][model]["metrics"]["topBudget"]
        expect(page.locator("#budget-comparison")).to_contain_text(
            f"{budget['positives']:,} observed subscriptions / {budget['count']:,}"
        )
    for partition in ("train", "holdout"):
        expect(page.locator("#base-rate-shift")).to_contain_text(
            f"{100 * data['split'][partition]['prevalence']:.2f}%"
        )

    # Independently identify the default without consulting any held-out label.
    default = min(
        data["records"],
        key=lambda r: (-abs(r["withDuration"] - r["withoutDuration"]), r["row"]),
    )
    expect(page.locator("#record")).to_have_value(str(default["row"]))
    expect(page.locator("#outcome-disclosure")).not_to_have_attribute("open", "")
    for model in ("withoutDuration", "withDuration"):
        expect(page.locator("#record-inspector")).to_contain_text(
            f"{default[model]:.6f}"
        )
    page.locator("#outcome-disclosure summary").click()
    assert page.locator("#outcome-disclosure").evaluate("node => node.open")
    page.locator("#next-record").click()
    assert not page.locator("#outcome-disclosure").evaluate("node => node.open")

    first = data["split"]["holdout"]["firstRow"]
    select_row(page, first)
    page.locator("#record-order").select_option("chronological")
    expect(page.locator("#previous-record")).to_be_disabled()
    page.locator("#next-record").click()
    selected = next(r for r in data["records"] if r["row"] == first + 1)
    review = record_export(page)
    assert review["record"] == selected
    assert review["models"] == data["models"]
    assert review["calibration"] == data["calibration"]
    assert review["protocol"] == data["protocol"]
    assert review["artifact"]["sha256"] == digest
    assert review["view"]["row"] == selected["row"]
    assert review["view"]["order"] == "chronological"
    assert not review["view"]["outcomeRevealed"]
    assert "defaultSelectionRule" in review["view"]
    assert "selectionRule" not in review["view"]

    deep_link = page.url
    page.goto(deep_link)
    expect(page.locator("#audit")).to_be_visible()
    expect(page.locator("#record")).to_have_value(str(selected["row"]))
    expect(page.locator("#record-order")).to_have_value("chronological")
    assert not page.locator("#outcome-disclosure").evaluate("node => node.open")
    select_row(page, 1)
    expect(page.locator("#record-inspector")).to_be_hidden()
    expect(page.locator("#export-record")).to_be_disabled()
    expect(page.locator("#record")).to_have_attribute("aria-invalid", "true")
    select_row(page, data["split"]["holdout"]["lastRow"])
    expect(page.locator("#record-inspector")).to_be_visible()
    expect(page.locator("#next-record")).to_be_disabled()

    with page.expect_download() as event:
        page.get_by_role(
            "link", name="Download the full evaluation", exact=False
        ).click()
    assert Path(event.value.path()).read_bytes() == ARTIFACT.read_bytes()
    print(
        "PASS paired metrics, label-free default, outcome boundary, review export and deep link"
    )


def layouts_and_bins(page, data):
    page.locator("details").evaluate_all(
        "nodes => nodes.forEach(node => node.open = true)"
    )
    tables = page.locator(".calibration-model tbody")
    for index, model in enumerate(("withoutDuration", "withDuration")):
        expect(tables.nth(index).locator("tr")).to_have_count(10)
        for bin_index, bin_data in enumerate(data["calibration"][model]):
            cells = tables.nth(index).locator("tr").nth(bin_index).locator("td")
            expect(cells.nth(0)).to_have_text(f"{bin_data['n']:,}")
            expect(cells.nth(1)).to_have_text(f"{bin_data['positives']:,}")
            if bin_data["n"] == 0:
                expect(cells.nth(2)).to_have_text("Not defined")
                expect(cells.nth(3)).to_have_text("Not defined")
    for width in (1440, 390, 320):
        page.set_viewport_size({"width": width, "height": 900})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (
            width
        )
        expect(page.locator("h1")).to_have_count(1)
        expect(page.locator("#record")).to_be_visible()
    print("PASS exact calibration bin counts and all-disclosures-open mobile layouts")


def failed_artifacts(context, origin, data):
    for response in (
        {"status": 503, "body": "Unavailable"},
        {"json": {**data, "records": []}},
    ):
        page = context.new_page()
        page.route("**/campaign.data.json", lambda route: route.fulfill(**response))
        page.goto(origin + "/labs/crm/campaign.html")
        expect(page.locator("#load-fallback")).to_be_visible()
        expect(page.locator("#audit")).to_be_hidden()
        expect(page.locator("#load-status")).to_contain_text(
            "No result values are shown"
        )
        page.close()
    print("PASS failed and malformed artifact responses hide all results")


def main():
    body = ARTIFACT.read_bytes()
    data = json.loads(body)
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            errors, requests = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(request.url))
            paired_evidence(page, origin, data, hashlib.sha256(body).hexdigest())
            layouts_and_bins(page, data)
            assert not errors, errors
            assert all(url.startswith(origin + "/") for url in requests), requests
            failed_artifacts(context, origin, data)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    print("PASS campaign browser regressions; ephemeral server stopped")


if __name__ == "__main__":
    main()
