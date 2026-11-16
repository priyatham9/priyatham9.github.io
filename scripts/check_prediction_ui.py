"""Exercise the local prediction CSV workbench in an ephemeral static server.

Requires playwright==1.62.0 and Chromium. Test CSVs are deliberately constructed
fixtures; the optional public-example check uses the committed real score file.
No model is trained, no remote service is accessed, and input bytes stay local.
"""

import csv
import functools
import hashlib
import http.server
import io
import json
import threading
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PAGE = "/labs/ai/prediction-audit.html"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def fixture_bytes():
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow(("outcome", "score_a", "score_b", "record_id", "group"))
    for i in range(20):
        record_id = (
            "=SUM(1,2)"
            if i == 0
            else ('<img src=x onerror="window.injected=1">' if i == 1 else f"id-{i}")
        )
        writer.writerow((i % 2, 0.5, i % 2, record_id, "alpha" if i < 10 else "beta"))
    return b"\xef\xbb\xbf" + stream.getvalue().encode()


def upload(page, body, name="review-fixture.csv"):
    page.locator("#csv-file").set_input_files(
        {"name": name, "mimeType": "text/csv", "buffer": body}
    )


def review_export(page):
    with page.expect_download() as event:
        page.locator("#export-review").click()
    return json.loads(Path(event.value.path()).read_text())


def csv_export(page, scope):
    page.locator("#csv-scope").select_option(scope)
    with page.expect_download() as event:
        page.locator("#export-csv").click()
    return list(csv.DictReader(io.StringIO(Path(event.value.path()).read_text())))


def local_workflow(page, origin):
    requests = []
    page.on(
        "request",
        lambda request: requests.append(
            (request.url, request.method, request.post_data)
        ),
    )
    page.goto(origin + PAGE, wait_until="networkidle")
    expect(page.locator("#results")).to_be_hidden()
    expect(page.locator("#empty-state")).to_be_visible()
    expect(page.locator("#source-panel")).to_be_hidden()
    assert "connect-src 'self'" in page.locator(
        'meta[http-equiv="Content-Security-Policy"]'
    ).get_attribute("content")
    requests.clear()
    body = fixture_bytes()
    upload(page, body)
    expect(page.locator("#results")).to_be_visible()
    expect(page.locator("#source-hash")).to_have_text(hashlib.sha256(body).hexdigest())
    assert page.locator("#record-rows tr").count() == 20
    page.locator("#note-a").fill(
        "Available before the decision; unverified declaration"
    )
    page.locator("#note-b").fill("Includes a later measurement; analyst note only")
    first = review_export(page)
    assert first["source"]["byteLength"] == len(body)
    assert first["source"]["sha256"] == hashlib.sha256(body).hexdigest()
    assert first["analysis"]["n"] == 20
    assert first["analysis"]["positives"] == 10
    assert first["analysis"]["models"]["a"]["averagePrecision"] == 0.5
    assert first["analysis"]["models"]["a"]["brier"] == 0.25
    assert first["analysis"]["models"]["b"]["averagePrecision"] == 1
    assert first["analysis"]["models"]["b"]["brier"] == 0
    assert first["selectedRecord"]["recordId"] == "=SUM(1,2)"
    assert not first["settings"]["availabilityDeclarations"]["verified"]
    expect(page.locator("#budget-results")).to_contain_text("2 of 20 rows tied")
    assert page.evaluate("window.injected === undefined")
    assert page.locator("#record-rows img").count() == 0

    page.locator('#record-rows button[data-row="2"]').click()
    assert page.evaluate("document.activeElement.dataset.row") == "2"
    expect(page.locator("#record-detail")).to_contain_text(
        '<img src=x onerror="window.injected=1">'
    )
    page.locator("#group-filter").select_option(label="alpha · 10")
    page.locator("#bin-model").select_option("b")
    page.locator("#bin-filter").select_option("0")
    filtered = review_export(page)
    assert filtered["analysis"] == first["analysis"]
    assert filtered["settings"]["view"]["matchingRows"] == 5
    expect(page.locator("#view-summary")).to_contain_text("Viewing 5 of 20")
    selected_rank = (
        filtered["selectedRecord"]["rankA"],
        filtered["selectedRecord"]["rankB"],
    )
    page.locator("#budget").select_option("0.2")
    budget = review_export(page)
    for key in ("a", "b"):
        for metric in ("averagePrecision", "brier", "calibration"):
            assert (
                budget["analysis"]["models"][key][metric]
                == first["analysis"]["models"][key][metric]
            )
        assert budget["analysis"]["models"][key]["topBudget"]["count"] == 4
    assert (
        budget["selectedRecord"]["rankA"],
        budget["selectedRecord"]["rankB"],
    ) == selected_rank
    all_rows, visible_rows = csv_export(page, "all"), csv_export(page, "visible")
    assert len(all_rows) == 20 and len(visible_rows) == 5
    assert all_rows[0]["record_id"] == "'=SUM(1,2)"
    assert all(
        row["group"] == "alpha" and row["score_b"] == "0" for row in visible_rows
    )
    page.locator("#bin-filter").select_option("5")
    expect(page.locator("#no-records")).to_be_visible()
    expect(page.locator("#export-csv")).to_be_disabled()
    assert review_export(page)["analysis"] == budget["analysis"]
    assert review_export(page)["selectedRecord"] is None

    # A malformed replacement cannot leave a prior successful result active.
    upload(page, b"outcome,score_a,score_b\r\n1,,0.4\r\n", "missing-score.csv")
    expect(page.locator("#load-error")).to_be_visible()
    expect(page.locator("#results")).to_be_hidden()
    expect(page.locator("#source-panel")).to_be_hidden()
    expect(page.locator("#source-hash")).to_have_text("")
    expect(page.locator("#note-a")).to_have_value("")
    page.locator("#clear").click()
    expect(page.locator("#empty-state")).to_be_visible()
    expect(page.locator("#record-detail")).to_have_text("")
    assert page.evaluate("localStorage.length === 0 && sessionStorage.length === 0")
    upload(page, b"x" * (10 * 1024 * 1024 + 1), "too-large.csv")
    expect(page.locator("#load-error")).to_contain_text(
        "original file exceeds the 10 MiB byte limit"
    )
    expect(page.locator("#results")).to_be_hidden()
    upload(page, b"outcome,score_a,score_b\n1,0.2,\xff\n", "invalid-utf8.csv")
    expect(page.locator("#load-error")).to_contain_text("not valid UTF-8")
    expect(page.locator("#results")).to_be_hidden()
    page.locator("#clear").click()
    allowed_code = {
        origin + "/labs/ai/prediction-worker.mjs",
        origin + "/labs/ai/prediction-model.mjs",
    }
    assert all(
        url in allowed_code and method == "GET" and body is None
        for url, method, body in requests
    ), requests
    print(
        "PASS exact BOM/CRLF hash, local-only processing, filters, budgets, safe exports, focus and replacement/clear"
    )


def class_and_scale(page):
    for label in (0, 1):
        upload(
            page,
            f"outcome,score_a,score_b\n{label},0.1,0.2\n{label},0.7,0.8\n".encode(),
            f"single-class-{label}.csv",
        )
        expect(page.locator("#results")).to_be_visible()
        expect(page.locator("#class-warning")).to_be_visible()
        result = review_export(page)
        assert result["analysis"]["models"]["a"]["averagePrecision"] == (
            None if label == 0 else 1
        )
        if label == 0:
            assert result["analysis"]["models"]["a"]["topBudget"]["recall"] is None
            expect(page.locator("#metric-comparison")).to_contain_text("Undefined")
    body = b"outcome,score_a,score_b,record_id,group\n" + b"".join(
        f"{i % 2},{i % 2},0.5,row-{i},g-{i % 10}\n".encode() for i in range(100000)
    )
    start = time.monotonic()
    upload(page, body, "100000-rows.csv")
    expect(page.locator("#cohort-summary")).to_contain_text(
        "100,000 accepted rows", timeout=30000
    )
    assert page.locator("#record-rows tr").count() == 25
    expect(page.locator("#page-label")).to_contain_text("Page 1 / 4000")
    page.locator("#next-page").click()
    expect(page.locator("#page-label")).to_contain_text("Page 2 / 4000")
    expect(page.locator("#record-detail h3")).to_have_text("Data row 26")
    result = review_export(page)
    assert result["analysis"]["models"]["a"]["averagePrecision"] == 1
    assert result["analysis"]["models"]["b"]["averagePrecision"] == 0.5
    assert result["source"]["sha256"] == hashlib.sha256(body).hexdigest()
    print(
        f"PASS zero/one-class semantics and 100,000-row paginated workflow ({time.monotonic() - start:.2f}s)"
    )


def public_example(page):
    page.locator("#load-example").click()
    expect(page.locator("#cohort-summary")).to_contain_text(
        "13,216 accepted rows", timeout=15000
    )
    result = review_export(page)
    manifest = json.loads(
        (ROOT / "labs/ai/prediction-sample.manifest.json").read_text()
    )
    campaign = json.loads((ROOT / "labs/crm/campaign.data.json").read_text())
    assert result["source"]["sha256"] == manifest["sha256"]
    assert result["source"]["exampleManifest"] == manifest
    for new_key, original_key in (("a", "withoutDuration"), ("b", "withDuration")):
        for metric in ("averagePrecision", "brier"):
            assert (
                abs(
                    result["analysis"]["models"][new_key][metric]
                    - campaign["models"][original_key]["metrics"][metric]
                )
                < 1e-12
            )
    assert "after the call" in result["settings"]["availabilityDeclarations"]["b"]
    page.locator("details").evaluate_all(
        "nodes => nodes.forEach(node => node.open = true)"
    )
    for width in (1440, 390, 320):
        page.set_viewport_size({"width": width, "height": 900})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (
            width
        )
    print(
        "PASS real public-example provenance/metrics and all-disclosures-open mobile layouts"
    )


def canceled_file_read(context, origin):
    page = context.new_page()
    page.add_init_script("""const originalRead = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function() { return new Promise(resolve => {
        document.documentElement.dataset.testReadPending = "true";
        window.releaseTestRead = () => resolve(originalRead.call(this));
      }); };""")
    page.goto(origin + PAGE)
    upload(page, fixture_bytes())
    expect(page.locator("html")).to_have_attribute("data-test-read-pending", "true")
    page.locator("#clear").click()
    page.evaluate("window.releaseTestRead()")
    page.wait_for_timeout(150)
    expect(page.locator("#results")).to_be_hidden()
    expect(page.locator("#source-hash")).to_have_text("")
    expect(page.locator("#note-b")).to_have_value("")
    expect(page.locator("#load-status")).to_contain_text("cleared")
    page.close()
    print("PASS clear during pending file read cannot restore discarded data")


def background_cancellation(context, origin):
    page = context.new_page()
    cdp = context.new_cdp_session(page)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    page.goto(origin + PAGE, wait_until="networkidle")
    page.evaluate("""() => {
      window.workerReplies = 0;
      window.busyTicks = 0;
      window.tickTimer = setInterval(() => {
        if (document.querySelector('#main').getAttribute('aria-busy') === 'true') window.busyTicks++;
        if (window.busyTicks >= 3) document.documentElement.dataset.busyHeartbeat = 'true';
      }, 20);
    }""")
    body = b"outcome,score_a,score_b,record_id,group\n" + b"".join(
        f"{i % 7 == 0 and 1 or 0},{(i % 997) / 996},{(i % 991) / 990},row-{i},g-{i % 200}\n".encode()
        for i in range(100000)
    )
    upload(page, body, "cancel-large.csv")
    expect(page.locator("#load-status")).to_contain_text("background worker")
    expect(page.locator("html")).to_have_attribute("data-busy-heartbeat", "true")
    # Click must be handled while analysis is pending, not after a blocked task
    # completes and renders a result. The old synchronous implementation fails.
    expect(page.locator("#results")).to_be_hidden()
    page.locator("#clear").click()
    expect(page.locator("#load-status")).to_contain_text("cleared")
    expect(page.locator("#results")).to_be_hidden()
    upload(page, fixture_bytes(), "replacement.csv")
    expect(page.locator("#cohort-summary")).to_contain_text("20 accepted rows")
    page.wait_for_timeout(1200)
    expect(page.locator("#cohort-summary")).to_contain_text("20 accepted rows")
    expect(page.locator("#source-hash")).to_have_text(
        hashlib.sha256(fixture_bytes()).hexdigest()
    )
    assert page.locator("#record-rows tr").count() == 20
    page.close()
    print(
        "PASS 4× CPU: timer responds during 100,000-row worker analysis; Clear cancels and replacement stays current"
    )


def main():
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT))
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            local_workflow(page, origin)
            class_and_scale(page)
            public_example(page)
            canceled_file_read(context, origin)
            background_cancellation(context, origin)
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    print("PASS prediction workbench browser regressions; ephemeral server stopped")


if __name__ == "__main__":
    main()
