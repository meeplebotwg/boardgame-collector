"""Synthetic-only browser smoke; no Luma/contact/service writes.
Run with a local Vite server and Playwright installed: python tools/event-details-smoke.py
Optional BGN_SMOKE_URL, BGN_SMOKE_EVIDENCE, PLAYWRIGHT_CHROMIUM_EXECUTABLE.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get("BGN_SMOKE_URL", "http://127.0.0.1:4178")
OUT = Path(os.environ.get("BGN_SMOKE_EVIDENCE", "/tmp/bgn-event-details-evidence"))
OUT.mkdir(parents=True, exist_ok=True)
ADDRESS = "123 Example Street, Suite 456, Testville, MA 00000, USA"
EVENT = {
    "eventId": "evt-SyntheticDetails", "slug": "synthetic-details",
    "name": "SYNTHETIC Board Game Night — browser verification",
    "startAt": "2099-09-09T18:00:00-04:00", "endAt": "2099-09-09T21:00:00-04:00",
    "venue": "SYNTHETIC Hall", "guestCount": 7, "fullAddress": ADDRESS,
    "description": "SYNTHETIC fixture, not a real event.\nBring games. <img src=x onerror=alert(1)>",
}

with sync_playwright() as p:
    executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
    browser = p.chromium.launch(**({"executable_path": executable} if executable else {}))
    try:
        for width, height in [(390, 844), (320, 740), (1280, 900)]:
            context = browser.new_context(viewport={"width": width, "height": height}, permissions=["clipboard-read", "clipboard-write"])
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
            # All external reads are hermetic. Unreadable calendar exercises cache fallback.
            page.route("https://**/*", lambda route: route.fulfill(status=200, content_type="text/html", body="SYNTHETIC unreadable source"))
            page.add_init_script("localStorage.setItem('bgn.calendar.v1', JSON.stringify(" + json.dumps({"ts": 4000000000000, "events": [EVENT, {"name": "SYNTHETIC legacy — address unavailable", "slug": "synthetic-legacy", "venue": "City only"}]}) + "));")
            page.goto(URL)
            expect(page.get_by_role("heading", name="Home", exact=True)).to_be_visible()
            page.locator("button.event-card").click()
            expect(page.get_by_role("heading", name="Upcoming events", exact=True)).to_be_visible()
            card = page.locator("details.event-details").first
            expect(card).to_be_visible()
            summary = card.locator("summary")
            expect(card).not_to_have_attribute("open", "")
            summary.focus()
            page.keyboard.press("Enter")
            expect(card).to_have_attribute("open", "")
            expect(card.locator(".event-address")).to_have_text(ADDRESS)
            page.keyboard.press("Space")
            expect(card).not_to_have_attribute("open", "")
            summary.click()
            expect(card).to_have_attribute("open", "")
            card.get_by_role("button", name="Copy address", exact=True).click()
            expect(card.get_by_role("status")).to_have_text("Address copied.")
            assert page.evaluate("navigator.clipboard.readText()") == ADDRESS
            expect(card).to_have_attribute("open", "")
            assert card.locator("img").count() == 0
            # Avoid leaving the app; assert native opener IPC receives the safe URL.
            page.evaluate("window.__opened = []; window.__TAURI_INTERNALS__ = { invoke: async (cmd, args) => window.__opened.push({cmd,args}) }")
            card.get_by_role("link", name="Open in Luma", exact=True).click()
            expect(card).to_have_attribute("open", "")
            opened = page.evaluate("window.__opened[0]")
            assert opened["cmd"] == "plugin:opener|open_url", opened
            assert opened["args"]["url"] == "https://luma.com/synthetic-details", opened
            page.evaluate("delete window.__TAURI_INTERNALS__; Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async () => {throw new Error('SYNTHETIC denial')}}})")
            card.get_by_role("button", name="Copy address", exact=True).click()
            expect(card.get_by_role("status")).to_contain_text("select the address")
            assert card.locator(".event-address").evaluate("el => getComputedStyle(el).userSelect") == "text"
            legacy = page.locator("details.event-details").nth(1)
            legacy.locator("summary").click()
            expect(legacy).to_contain_text("Full address unavailable.")
            assert legacy.get_by_role("button", name="Copy address").count() == 0
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            for element in [summary, card.get_by_role("button", name="Copy address"), card.get_by_role("link")]:
                assert element.bounding_box()["height"] >= 44
            page.screenshot(path=str(OUT / f"synthetic-events-{width}.png"), full_page=True)
            assert not errors, errors
            print(f"PASS {width}x{height}: Home navigation, native Enter/Space/click toggle, real clipboard, denied fallback, safe opener IPC, legacy data, no overflow/errors")
            context.close()
    finally:
        browser.close()
