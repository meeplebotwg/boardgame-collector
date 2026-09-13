"""Synthetic-only Chromium smoke. BgnBackup is a JS test double, NOT Android proof.
Run against a dedicated Vite server with Python Playwright installed.
BGN_SMOKE_URL defaults to http://127.0.0.1:4186; evidence goes to /tmp/bgn-notes-evidence.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get("BGN_SMOKE_URL", "http://127.0.0.1:4186")
OUT = Path(os.environ.get("BGN_SMOKE_EVIDENCE", "/tmp/bgn-notes-evidence"))
OUT.mkdir(parents=True, exist_ok=True)
BRIDGE = """
// SYNTHETIC BRIDGE ONLY: fake Downloads survives page reload in a separate key.
const key = '__synthetic_notes_files';
if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
 'bgn-notes-1700000000000-0.json': JSON.stringify({type:'bgn-notes', version:1,
 notes:[{id:'synthetic-recovery', text:'SYNTHETIC recovered setup reminder', ts:1700000000000}]})
}));
window.__backupWrites = [];
window.BgnBackup = {
 list: () => JSON.stringify(Object.keys(JSON.parse(localStorage.getItem(key)))),
 read: name => JSON.parse(localStorage.getItem(key))[name] ?? null,
 write: (name, text) => {
   const files = JSON.parse(localStorage.getItem(key)); files[name] = text;
   localStorage.setItem(key, JSON.stringify(files)); window.__backupWrites.push({name,text});
   return null;
 },
 remove: name => { const files = JSON.parse(localStorage.getItem(key)); delete files[name]; localStorage.setItem(key, JSON.stringify(files)); },
 pick: () => { window.__pickerOpened = true; }
};
"""

def note_writes(page):
    return page.evaluate("window.__backupWrites.filter(f => f.name.startsWith('bgn-notes-')).length")


def notes(page):
    return page.evaluate("JSON.parse(localStorage.getItem('bgn.notes.v1')) || []")


def screenshot(page, name):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert page.locator("main").evaluate("el => el.scrollWidth <= el.clientWidth")
    page.screenshot(path=str(OUT / name), full_page=True)


def picker(page, value):
    page.get_by_role("button", name="Import from a backup file", exact=True).click()
    page.evaluate("value => window.__bgnBackupPicked(value)", value)


with sync_playwright() as p:
    executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
    browser = p.chromium.launch(**({"executable_path": executable} if executable else {}))
    try:
        for width, height in [(320, 740), (390, 844), (1280, 900)]:
            context = browser.new_context(viewport={"width": width, "height": height})
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
            # No real Luma/GitHub/receiver requests, contacts, or signup records.
            page.route("https://**/*", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"tag_name": "v0.3.3", "assets": []})))
            page.add_init_script(BRIDGE)
            page.goto(URL)
            offer = page.locator(".notes-restore")
            expect(offer).to_be_visible()
            assert note_writes(page) == 0, "empty launch must not mask recovery"
            screenshot(page, f"synthetic-notes-restore-{width}.png")
            offer.get_by_role("button", name="Not now", exact=True).click()
            page.get_by_role("button", name="Take a note", exact=False).click()
            expect(page.get_by_role("heading", name="Notes", exact=True)).to_be_visible()
            page.get_by_role("button", name="Cancel", exact=True).click()
            expect(offer).to_have_count(0)
            page.reload()
            expect(offer).to_be_visible()  # decline is not persisted
            assert note_writes(page) == 0
            offer.get_by_role("button", name="Restore 1 note", exact=True).click()
            expect(offer).to_have_count(0)
            page.wait_for_function("window.__backupWrites.some(f => f.name.startsWith('bgn-notes-'))")
            page.get_by_role("button", name="Take a note", exact=False).click()
            field = page.get_by_role("textbox", name="Note", exact=True)
            field.fill(" \n ")
            expect(page.get_by_role("button", name="Write a note first")).to_be_disabled()
            text = "SYNTHETIC table reminder\nBring spare rules. <img src=x onerror=alert(1)>"
            field.fill("  " + text + "  ")
            page.get_by_role("button", name="Save note", exact=True).click()
            expect(field).to_have_value("")
            expect(page.locator(".note-text").first).to_have_text(text)
            assert page.locator(".note-card img").count() == 0
            assert notes(page)[0]["text"] == text
            older = page.locator(".note-card").nth(1)
            older.get_by_role("button", name="Edit", exact=True).click()
            edit = page.get_by_role("textbox", name="Edit note", exact=True)
            expect(edit).to_be_focused()
            edit.fill("  ")
            expect(older.get_by_role("button", name="Write a note first")).to_be_disabled()
            revised = "SYNTHETIC revised setup\n" + "LongUnbrokenWord" * 16
            edit.fill(revised)
            page.get_by_role("button", name="Save changes", exact=True).click()
            expect(page.locator(".note-text").first).to_have_text(revised)
            page.locator(".note-card").first.scroll_into_view_if_needed()
            screenshot(page, f"synthetic-notes-list-{width}.png")
            card = page.locator(".note-card").first
            card.get_by_role("button", name="Delete", exact=True).click()
            expect(page.get_by_text("Delete this note?", exact=True)).to_be_visible()
            assert len(notes(page)) == 2
            screenshot(page, f"synthetic-notes-confirm-{width}.png")
            card.get_by_role("button", name="Keep note", exact=True).click()
            card.get_by_role("button", name="Delete", exact=True).click()
            card.get_by_role("button", name="Delete note", exact=True).click()
            assert len(notes(page)) == 1
            # Leave with an unsaved draft; fresh entry clears it, not saved notes.
            field.fill("SYNTHETIC discard draft")
            page.get_by_role("button", name="Cancel", exact=True).click()
            page.get_by_role("button", name="Take a note", exact=False).click()
            expect(field).to_have_value("")
            existing = notes(page)[0]
            picker(page, json.dumps({"type": "bgn-notes", "version": 1, "notes": [dict(existing, text="stale"), {"id": "synthetic-import", "text": "SYNTHETIC imported note", "ts": 1}]}))
            expect(page.get_by_role("status").last).to_have_text("Added 1 note from the backup.")
            assert next(n for n in notes(page) if n["id"] == existing["id"])["text"] == text
            picker(page, "not JSON")
            expect(page.get_by_role("status").last).to_have_text("No backup file read.")
            # Actual reload proves persistence AND calls the main.js launch hook.
            page.reload()
            page.wait_for_function("window.__backupWrites.some(f => f.name.startsWith('bgn-notes-'))")
            assert len(notes(page)) == 2
            assert note_writes(page) == 1
            page.get_by_role("button", name="Take a note", exact=False).click()
            # Simulate only notes-store quota failure: preserve the real typed draft.
            page.evaluate("window.__setItem = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { if(k === 'bgn.notes.v1') throw new Error('SYNTHETIC quota'); return window.__setItem.call(this,k,v); }; void 0")
            field.fill("SYNTHETIC retained draft")
            page.get_by_role("button", name="Save note", exact=True).click()
            expect(field).to_have_value("SYNTHETIC retained draft")
            expect(page.get_by_role("status").first).to_contain_text("Could not save")
            page.evaluate("Storage.prototype.setItem = window.__setItem; void 0")
            for control in page.locator("button, textarea").all():
                assert control.bounding_box()["height"] >= 44
            assert field.evaluate("el => getComputedStyle(el).fontSize") == "16px"
            page.locator("main").evaluate("el => el.scrollTop = 0")
            screenshot(page, f"synthetic-notes-editor-{width}.png")
            assert not errors, errors
            print(f"PASS {width}x{height}: Home/restore/Not-now-session, multiline create/edit/delete, additive picker, reload persistence + launch backup, failed save draft, 44px targets, 16px input, no overflow/JS errors; BgnBackup STUB ONLY")
            context.close()
    finally:
        browser.close()
