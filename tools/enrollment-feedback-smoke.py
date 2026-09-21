"""Cold Chromium + self-owned Vite; synthetic records only, no live receiver/Google.
Run with a Python Playwright environment. Optional PLAYWRIGHT_CHROMIUM_EXECUTABLE.
All subprocesses/contexts are closed on exit. Screenshots stay outside the repo.
"""
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import time
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(os.environ.get('BGN_SMOKE_EVIDENCE', '/tmp/bgn-enrollment-ui-smoke'))
OUT.mkdir(mode=0o700, parents=True, exist_ok=True)
server = subprocess.Popen(['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '0'],
                          cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
try:
    selector = selectors.DefaultSelector()
    selector.register(server.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + 20
    url = None
    while time.monotonic() < deadline and server.poll() is None:
        if selector.select(timeout=.5):
            line = server.stdout.readline()
            match = re.search(r'http://127\.0\.0\.1:\d+', line)
            if match:
                url = match.group(); break
    selector.close()
    if not url:
        raise RuntimeError('Dedicated Vite failed readiness')
    with sync_playwright() as p:
        executable = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
        browser = p.chromium.launch(**({'executable_path': executable} if executable else {}))
        try:
            for width in (320, 390, 1280):
                context = browser.new_context(viewport={'width': width, 'height': 844})
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
                page.route('https://**/*', lambda route: route.fulfill(status=200, content_type='application/json', body='{"tag_name":"v0.0.0","assets":[]}'))
                page.goto(url)
                page.evaluate('''async () => {
                    const handoff = await import('/src/handoff.js');
                    const {handoffScreen} = await import('/src/handoff-screen.js');
                    localStorage.setItem('bgn.adds.v1', JSON.stringify([{kind:'one', email:'synthetic@example.org', name:'Synthetic', source:'Fixture'}]));
                    const [row] = await handoff.preview();
                    const job = 'e'.repeat(32);
                    handoff.prepare('https://synthetic.tailnet.ts.net:9443', [row]);
                    await handoff.send(async () => ({job}));
                    window.showOutcome = async meaning => {
                        const request = async () => ({job, items:[{id:row.id,status:'invitation_required',evidence:JSON.stringify({worker:1,meaning}),added_at:null,verified_at:null}]});
                        document.getElementById('app').replaceChildren(handoffScreen({request}));
                    };
                    await window.showOutcome('invitation_pending_verified');
                }''')
                page.get_by_role('button', name='Refresh outcomes', exact=True).click()
                expect(page.get_by_text('Invitation pending — membership not verified', exact=True)).to_be_visible()
                expect(page.get_by_text('Date added: Unknown', exact=True)).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.screenshot(path=str(OUT / f'synthetic-invitation-{width}.png'), full_page=True)
                page.evaluate("window.showOutcome('invitation_not_sent')")
                page.get_by_role('button', name='Refresh outcomes', exact=True).click()
                expect(page.get_by_text('Invitation required — not sent', exact=True)).to_be_visible()
                assert not errors, errors
                context.close()
                print(f'PASS {width}px: manual refresh, pending versus unsent, unknown dates, no overflow or JS errors; SYNTHETIC ONLY')
        finally:
            browser.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=10)
    except subprocess.TimeoutExpired:
        server.kill(); server.wait()
    server.stdout.close()
print('Dedicated Vite and cold Chromium closed; no live Google, receiver or browser session used.')
