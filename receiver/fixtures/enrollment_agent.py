"""Synthetic stand-in for Hermes executable; drives the REAL native helper CLI."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

prompt = sys.stdin.read()
Path(os.environ['FIXTURE_PROMPT']).write_text(prompt)
# Fixed machine-readable header, not email text in shell arguments.
header = json.loads(prompt.splitlines()[0])
# The stand-in must consume the model-visible contract, never read request.json.
# Helpers run in separate subprocesses and still read the canonical request.
def no_request_read(event, args):
    if event == 'open' and str(args[0]) == header['request']:
        raise AssertionError('Worker must not read request.json')

sys.addaudithook(no_request_read)
assert set(header) == {'request', 'helper', 'item', 'mode', 'eligibility',
                       'allow_fallback', 'group_url', 'deadline'}
work = header
assert work['group_url'] == 'https://groups.google.com/g/boardgamenightwg/members'
assert set(work['item']) == {'id', 'email', 'status'}
assert '--ignore-rules' in sys.argv and '--toolsets' in sys.argv
scenario = os.environ['FIXTURE_SCENARIO']


def ui(*args):
    result = subprocess.run([sys.executable, header['helper'], '--request', header['request'], *args],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def observe(stage, member, invitation):
    mc = ui('capture')
    ic = ui('capture')
    ui('observe', stage, '--membership', member, '--invitation', invitation,
       '--member-capture', mc, '--invite-capture', ic)


if scenario == 'missing': sys.exit(0)
if scenario == 'crash': sys.exit(7)
ui('open-members')
ui('capture')
if scenario in ('captcha', 'login', 'permission', 'throttle', 'ambiguous'):
    ui('finish', '--stop', scenario)
    sys.exit(0)
if scenario == 'existing':
    observe('before', 'present', 'absent')
    ui('finish')
    sys.exit(0)
observe('before', 'absent', 'absent')
if scenario == 'reconcile_absent':
    assert work['mode'] == 'reconcile', 'ambiguous retry must never mutate'
    ui('finish')
    sys.exit(0)
if scenario == 'fallback':
    ui('finish', '--stop', 'invitation_fallback')
    sys.exit(0)
ui('email')
mode = 'invite' if scenario in ('invite', 'invite_member') else 'direct_add'
stale_member = ui('capture')
stale_invite = ui('capture')
ui('submit', '100', '200', '--direct-selected', 'no' if mode == 'invite' else 'yes', '--fallback-warning', 'yes' if scenario == 'fallback_pending' else 'no')
if scenario == 'crash_after_submit': sys.exit(9)
if scenario == 'timeout_after_submit': time.sleep(30)
observe('after', 'absent' if scenario in ('invite', 'toast_only', 'fallback_pending') else 'present',
        'present' if scenario in ('invite', 'fallback_pending') else 'absent')
ui('finish')
path = Path(header['request']).parent / 'response.json'
result = json.loads(path.read_text())
if scenario == 'malformed': path.write_text('{broken'); sys.exit(0)
if scenario == 'foreign': result['item_id'] = 'f' * 64
if scenario == 'partial': result.pop('after')
if scenario == 'no_evidence': result['after']['member_capture'] = 'missing.png'
if scenario == 'false_added': result['status'] = 'added'
if scenario == 'tampered_observation': result['after'].update(membership='absent', invitation='present')
if scenario == 'stale_capture':
    result['after'].update(member_capture=stale_member, invite_capture=stale_invite)
    # Simulate an agent accidentally referencing old captures in its journal too.
    (path.parent / 'after.json').write_text(json.dumps(result['after']))
if scenario == 'duplicate_keys':
    path.write_text('{"version":1,' + json.dumps(result)[1:]); sys.exit(0)
path.write_text(json.dumps(result))
