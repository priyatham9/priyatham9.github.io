"""Exercise consequential project UI states against an isolated static server.

Install playwright==1.62.0 and its Chromium browser, then run this file.
These checks complement numerical model tests; they do not measure usability.
"""

import functools
import hashlib
import http.server
import json
import threading
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def exported(page):
    with page.expect_download() as event:
        page.locator("#export").click()
    return json.loads(Path(event.value.path()).read_text())


def finance_policy(page, origin):
    page.goto(origin + "/labs/finance/decision.html")
    expect(page.locator("#live-value")).to_contain_text("modeled NPV")
    page.locator("#pin-current").click()
    page.locator("#discount").fill("0.1")
    page.locator("summary").filter(has_text="Business context, horizon").click()
    page.locator("#revenue").fill("16000000")
    first = exported(page)
    assert first["pinnedScenario"]["base"]["revenue"] == 12000000
    assert first["base"]["revenue"] == 16000000
    assert first["pinnedScenario"]["policy"]["discount"] == 0.01
    assert first["policy"]["discount"] == 0.001
    assert not first["pinnedComparison"]["sameContext"]
    page.locator("#revenue").fill("")
    expect(page.locator("#export")).to_be_disabled()
    expect(page.locator("#pin-current")).to_be_disabled()
    page.locator("#revenue").fill("16000000")
    assert exported(page)["pinnedScenario"] == first["pinnedScenario"]
    page.locator("#reset").click()
    expect(page.locator("#pinned-comparison")).to_be_hidden()


def crm_cohorts(page, origin):
    page.goto(origin + "/labs/crm/decision.html")
    page.locator("#case").select_option("unresolved")
    expect(page.locator("#live-conclusion")).to_contain_text("Ranking not identified")
    page.locator("#count-0-0").fill("")
    expect(page.locator("#export")).to_be_disabled()
    page.locator("#reset").click()
    page.locator("#case").select_option("mix")
    expect(page.locator("#live-conclusion")).to_contain_text("Source B leads")
    for row in range(4):
        for column, value in enumerate(("1", "1", "0")):
            page.locator(f"#count-{row}-{column}").fill(value)
    expect(page.locator("#live-conclusion")).to_contain_text("Equal conversion")
    assert exported(page)


def contract_review(page, origin):
    page.goto(origin + "/labs/foundry/contract.html")
    expect(page.locator("#export")).to_be_enabled()
    page.locator("#preset").select_option("cohort-mismatch")
    expect(page.locator("#approve")).to_be_disabled()
    invalid = exported(page)
    assert not invalid["comparison"]["approvable"]
    assert invalid["status"] == "draft-review"
    page.locator("#preset").select_option("metadata-only")
    expect(page.locator("#approve")).to_be_enabled()
    page.locator("#approve").click()
    assert exported(page)["status"] == "locally-approved-review"
    page.locator("#open-editors").click()
    proposal = page.locator("#proposal-json")
    proposal.fill(proposal.input_value() + " ")
    expect(page.locator("#approve")).to_be_disabled()
    expect(page.locator("#export")).to_be_disabled()
    page.locator("#evaluate").click()
    expect(page.locator("#export")).to_be_enabled()
    assert exported(page)["status"] == "draft-review"


def financial_filings(page, origin):
    page.goto(origin + "/labs/finance/filings.html")
    expect(page.locator("#audit")).to_be_visible()
    first = exported(page)
    assert (
        first["sourceDataset"]["sha256"]
        == hashlib.sha256(
            (ROOT / "labs/finance/filings.data.json").read_bytes()
        ).hexdigest()
    )
    assert first["selection"]["company"] == "msft"
    page.locator("#case-offset").click()
    second = exported(page)
    assert second["selection"]["company"] == "cost"
    assert second["selection"]["fiscalYear"] == 2026
    assert first["sourceDataset"]["sha256"] == second["sourceDataset"]["sha256"]
    page.route(
        "**/filings.data.json",
        lambda route: route.fulfill(status=503, body="Unavailable"),
    )
    page.reload()
    expect(page.locator("#load-fallback")).to_be_visible()
    expect(page.locator("#audit")).to_be_hidden()
    page.unroute("**/filings.data.json")


def main():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            for check in (
                finance_policy,
                crm_cohorts,
                contract_review,
                financial_filings,
            ):
                check(page, origin)
                print(f"PASS {check.__name__}")
            for width in (390, 320):
                page.set_viewport_size({"width": width, "height": 900})
                for route in (
                    "crm/decision.html",
                    "finance/decision.html",
                    "finance/filings.html",
                    "foundry/contract.html",
                ):
                    page.goto(origin + "/labs/" + route, wait_until="networkidle")
                    assert page.evaluate(
                        "document.documentElement.scrollWidth <= innerWidth"
                    ), (route, width)
                    expect(page.locator("h1")).to_have_count(1)
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    print("PASS responsive layouts and browser execution")


if __name__ == "__main__":
    main()
