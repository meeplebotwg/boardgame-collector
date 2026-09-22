# Human-gated enrollment worker: implementation spec

## Smallest vertical slice

A durable intake job supplies **one unique signup email per explicit local run**
to a bounded Hermes native-UI worker. A closed response contract is validated by
the receiver, committed via the existing Store, and returned by the existing
owner-bound `GET /v1/jobs/<job>`. Contacts, names, sources and notes never enter
the worker. The ledger's logical group key `bgn-wg` remains unchanged; the only
Google destination is `https://groups.google.com/g/boardgamenightwg/members`.

No timers, background queue, Google API, credential access, login automation,
Marionette, cookie copying, production migration or deployment in this change.
The browser is the already owner-authenticated dedicated native Firefox session.

## Acceptance criteria

- Default invocation cannot touch a browser. Explicit owner readiness, a private
  native-UI configuration and mode are required. Modes distinguish direct-add,
  invitation and read-only reconciliation; no silent invitation fallback.
- Check exact member and pending invitation lists before mutation, one address
  at a time. Reopen lists after submission; success toast/count is not proof.
  Existing member -> already_member; pending invite -> invitation_required,
  never added. Actual addition time stays unknown unless separately evidenced.
- Invalid/partial/stale/foreign worker results, timeout, crash, auth challenge,
  CAPTCHA, permission failure and unclear UI cannot become success. An uncertain
  previous attempt gets read-only reconciliation, never an automatic resend.
- Serialize per Store and per native display across Stores; retain locks while
  the child runs. Persist uncertain status before external action. New private
  attempt directories prevent stale result reuse.
- Native helper exposes fixed navigation, bounded screenshot/click/key actions
  and typing only the current allowlisted signup email (no arbitrary text/URL).
  Exact agent instructions explain observation, action and stop conditions.
- Synthetic subprocess/HTTP/disk tests exercise the actual receiver invocation
  and result transport; native command transport is tested without a live
  display or browser. Tests do not claim independent Google verification.

## Account and outcome policy

`--eligibility google|non_google|unknown` defaults to **unknown**. It is an
operator assertion about the selected account, not a domain classifier. Known
Workspace/custom-domain Google accounts can use direct-add; even a gmail-looking
address is not automatically eligible. Unknown/non-Google accounts return
`invitation_required` without launching a direct-add worker. A subsequent,
explicit `--mode invite` may send one invitation, after absence checks. The
processor never produces `added` for those accounts.

| Observation | API status | Evidence meaning / app wording |
| --- | --- | --- |
| Eligibility unknown/non-Google, no submission | invitation_required | invitation_not_sent / Invitation required — not sent |
| Exact pending invitation row, before or after action | invitation_required | invitation_pending_verified / Invitation pending — membership not verified |
| Legacy/manual invitation evidence | invitation_required | Sending not confirmed |
| Exact existing member | already_member | membership_verified |
| Exact member after permitted direct add | added | membership_verified_after_direct_add |
| Login/CAPTCHA/permission/throttle before any action | blocked | stopped_login/captcha/permission/throttle |
| Failed/partial/contradictory/ambiguous result | needs_verification | unverified_result or attempt_started_reconcile_before_retry |

An invite action followed by observed membership is `already_member`, **never
Added by invitation**. There is no `invitation_sent` success inferred from a
button/toast. Actual addition time remains null: the worker records the local
verification time, not a guessed Google addition date. Existing history remains
preserved by Store. The ledger is not a current roster.

## Local invocation (NOT authorization to use real recipients)

All production deployment/backup gates still apply. These commands document a
future, separately approved operation; do not point a new Store at production
just to inspect it. The implementation did not change any running service.

Create an operator-owned UI JSON file inside a private 0700 directory, mode 0600.
Fill paths from the private browser runbook; do not retrieve credentials. No
browser is launched and there is no fallback to the default browser profile.
For the dedicated native session observed by owner orchestration, the display
is `:93`, loopback VNC is `127.0.0.1::15901`, and dimensions are 1000x780. This
configuration template intentionally contains placeholder paths:

```json
{
  "display": ":93",
  "xauthority": "/absolute/dedicated/session/.service-Xauthority",
  "vnc_server": "127.0.0.1::15901",
  "vncdo": "/absolute/ui-venv/bin/vncdo",
  "ffmpeg": "/usr/bin/ffmpeg",
  "width": 1000,
  "height": 780,
  "lock": "/absolute/private/browser-service/enrollment.lock"
}
```

Every Store targeting this browser MUST use the **same UI config and lock path**.
Locks are advisory between cooperative workers, not protection against a human
simultaneously using VNC. Coordinate exclusive browser ownership with the owner;
no simultaneous remote interaction. Keep the immutable release containing all
four receiver files (`meeple_receiver.py`, `enrollment_worker.py`,
`worker_supervisor.py`, `enrollment-instructions.md`) available for the entire run.

```sh
# Defaults never start Hermes or touch UI; history is not downgraded.
python3 receiver/meeple_receiver.py --data "$PRIVATE_DIR" run "$JOB"
# First permitted native rehearsal: explicitly read-only, one exact signup.
python3 receiver/meeple_receiver.py --data "$PRIVATE_DIR" run "$JOB" \
  --item "$ITEM" --owner-session-ready --mode reconcile --ui-config "$PRIVATE_UI_CONFIG"
# Only under a separate exact-recipient invitation authorization:
python3 receiver/meeple_receiver.py --data "$PRIVATE_DIR" run "$JOB" \
  --item "$ITEM" --owner-session-ready --mode invite --eligibility non_google \
  --ui-config "$PRIVATE_UI_CONFIG"
# Only for an independently known eligible Google account, separately authorized:
python3 receiver/meeple_receiver.py --data "$PRIVATE_DIR" run "$JOB" \
  --item "$ITEM" --owner-session-ready --mode direct_add --eligibility google \
  --ui-config "$PRIVATE_UI_CONFIG"
```

Google's warning that ineligible direct adds may be invited causes a stop unless
`--allow-invitation-fallback` is explicitly supplied. That flag authorizes the
possible invitation, not an Added label. Unknown/non-Google accounts remain
ineligible for direct-add even with the flag. Prefer explicit invite mode when
eligibility is unknown. No default permits sending invitations.

Without `--item`, the first selectable signup is processed, not the whole batch;
use read/list to inspect the job and pin the intended record when mutating.
Duplicates share the existing owner/group/email outcome, including across jobs.
Completed/pending-invitation targets skip mutation. Explicit reconcile can check
them later. A prior uncertain attempt **forces reconcile** regardless of requested
mode. Missing former members or vanished invitations require review, never
silently reauthorize an unsubscribe/reinvite. If a human establishes that no
previous submission took effect and that consent is still valid, they may use
existing local `set ... blocked --evidence-file ...` to document the deliberate
resolution before a fresh explicit run. Do not clear ambiguity from empty search
results alone. Never loop mutating commands as a retry strategy.

Return words are processor lifecycle, NOT enrollment success: `processed` means
a validated result was recorded (possibly blocked/needs_verification),
`needs_verification` means no trustworthy final result, `nothing_pending` means
no selected work, `blocked` is a gate, and `invitation_required` can mean **not
sent**. Always read the job/GET outcome. Busy locks fail without changing status.

## Native transport and trust boundary

[Exact per-job instructions](../receiver/enrollment-instructions.md) tell the
agent how to search member and pending-invitation lists, inspect actual pixels,
choose direct-add versus invite, submit once, reread both lists, and stop for
credentials/CAPTCHA/permission/throttle/unknown UI. Coordinates are never guessed.
The helper permits only a fixed group URL, bounded coordinates/keys, typing the
one allowlisted ASCII mailbox, captures, closed observations and finalization.
No shell interpolation of record strings. Unsupported mailbox syntax is review,
not an invitation to put arbitrary text into a UI.

The parent supplies only the selected item id/email/status, mode, eligibility,
fallback authorization, group URL and deadline in the first-line JSON prompt
alongside request/helper paths. The agent does not read the request file or UI
configuration; its first action is the existing helper's `open-members`. The
persisted request remains helper authority. Any security refusal ends the run
without alternate commands/transports or policy changes; missing response stays
needs_verification. Synthetic subprocess tests do not replace a real single-query
CLI rehearsal under unchanged security settings.

Each fresh `jobs/JOB/ATTEMPT/` contains private request, log, screenshots with
phase metadata, before/after observation journals, a pre-click submission marker,
and response. Nothing is exposed by HTTP except the Store's existing bounded
status/evidence. These files can contain PII; protect/retain with the private
Store and never commit or attach real screenshots. Screenshot/log/agent-session
retention is not automatically pruned. The selected address and screenshots may
reach the configured model provider under ADR0010's existing disclosure. Native
screenshots capture the visible dedicated desktop, not just the selected signup:
unrelated roster entries and visible account data may also reach that provider.
Keep unrelated windows closed and minimize visible personal data before a run.

Closed response fields: `version, job, attempt, item_id, group_url, mode, before,
after, action, stop`. Observations contain only `membership, invitation,
member_capture, invite_capture`. Parent checks exact scope/types, absence checks,
authorized action, matching journals, distinct phase-correct private PNGs and
known stop enums. Unknown keys, duplicate JSON keys, missing/truncated/foreign
responses, stale captures and nonzero/timeout exits cannot publish success.
The parent, **not the agent**, calls Store.set_outcome. Helper writes cannot
change SQLite; manual CLI set also takes the processor lock. Linux task-local
subreaper supervision retains both Store and native-display lock descriptors;
the agent and its tools do not need to inherit them. Timeout, root exit (normal
or abnormal), operator interruption, and launcher death invalidate the active
token and kill/reap every task descendant before the supervisor releases locks.
Session-detached terminal children are included. The kernel reparents orphans to
the supervisor; `/proc/self/task/PID/children` enumerates only its direct children,
whose unreaped PIDs cannot be reused. Repeated adoption/kill/reap ends only at
`waitpid` ECHILD, never at an empty process snapshot. No global kill or unrelated
process-tree scan is used. Helpers recheck active tokens before native commands.

Prerequisites are Linux `PR_SET_CHILD_SUBREAPER` and readable procfs child lists;
no cgroup delegation, service changes, or Hermes changes are required. Failure
to establish containment launches no agent. A private `<native-lock>.containment`
quarantine is created before startup and removed only after proven cleanup. If
cleanup cannot be proved, the supervisor retains locks indefinitely rather than
letting another run proceed. If the supervisor itself is killed (SIGKILL/OOM),
its cleanup guarantee is lost, but the persistent quarantine prevents subsequent
workers across Stores from using that display. This is an explicit fail-closed
operator recovery condition, not an automatic retry: keep the display unused,
identify and terminate/reap the old task's processes, and establish exclusive
ownership before an operator removes the quarantine. Do not delete it merely
because advisory locks are available. Killing the supervisor and launcher
together is not a guaranteed cleanup path; neither is malicious agent escape
through an unrelated external process/service. A delegated cgroup/service would
be needed for stronger supervisor-death containment. No such host changes are
made here. Uncertain enrollment remains `needs_verification` and requires review.

This is a trusted local **hybrid agent** implementation, not a pixel-verifying
Google API or an OS sandbox. Terminal access and local filesystem remain trusted:
an agent/local user deliberately bypassing the helper can bypass instruction-level
limits. Generic click cannot semantically distinguish a navigation control from
Submit, so the exact instructions prohibit final submission outside `submit`.
Structural validation detects wrong/missing/stale evidence, not a dishonest pixel
attestation. Do not claim cryptographic/independent membership proof.

## Verification and remaining gate

Tests use temporary data and an actual synthetic `hermes` executable at the PATH
seam. It reads the real stdin request, invokes the real native helper subprocess,
and returns its real file response. Synthetic ffmpeg/VNC executables record argv
and supply explicitly fake PNG fixtures; **no Google network/browser/model is
invoked by these tests**. The matrix covers intake HTTP -> process -> reopened
SQLite -> owner GET, duplicate targets, invitation policy, contradictory/partial/
foreign/stale results, crashes after submit, real timeout/descendant cleanup,
expired attempts, login/CAPTCHA stops, and cross-Store serialization. Chromium
smoke uses a separate cold context, self-owned Vite and synthetic app data.

TDD evidence: initial missing mode/config invocation tests failed; the new app
invitation-label test failed against the old generic label. Targeted red tests
also exposed stale screenshot acceptance, response/journal mismatch, invalid VNC
Escape key, a manual CLI set race, and history downgrade permitting reinvites;
each was corrected and rerun. Exact final command results are recorded below.

Remaining real-browser gate: owner-orchestrated **nonmutating** rehearsal of the
actual helper capture/input/search flow in the authenticated dedicated native
session, including invitation-list search UI and focus behavior. Do not type
synthetic recipients into Add members or send them to Google. Then obtain a
separate exact-recipient, exact-mode test authorization, observe before/after
membership/invitations and confirm phone Refresh outcomes. This change authorizes
none of those real mutations, no service upgrade, timer, release or merge.

### Exact local test evidence

Final implementation verification in the isolated enrollment worktree:

| Command | Observed result |
| --- | --- |
| `python3 -m unittest discover -s receiver -v` | **38 passed**, 177.445 seconds; real temporary HTTP/SQLite/subprocess transport, synthetic UI executables only |
| `npm test` | **187 passed, 0 failed**; 15159.064336 ms in final rerun |
| `npm run lint` | Passed |
| `npm run format:check` | All matched files use Prettier code style |
| `npm run build` | Passed, Vite 7.3.6, 33 modules transformed |
| `git diff --check` | Passed |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=<installed cold Chromium executable> <isolated Playwright venv>/bin/python tools/enrollment-feedback-smoke.py` | **PASS 320px, 390px, 1280px**: manual refresh, pending vs unsent, unknown dates, no horizontal overflow/JS errors; Vite and Chromium closed |

The 390px synthetic screenshot was also visually inspected; invitation pending
and both unknown membership/addition dates are legible. Screenshots remain in
`/tmp/bgn-enrollment-ui-smoke/`, never repository fixtures. The Playwright package
was installed in `/tmp/bgn-enrollment-smoke-venv`, not into any service profile.
Node's existing MockTimers experimental warning and expected synthetic HTTP/mail
failure logs are test fixture output, not failed gates. CI, Android and real
Google outcome proof were not run or claimed. No push/merge/release is part of
this local implementation task.

### Detached-child cleanup review correction

The original inherited-FD/process-group regression did not match Hermes terminal
commands, which create new sessions and close unrelated descriptors. Its
replacement first failed in all six scenarios: timeout, normal root exit,
abnormal root exit, SIGINT, SIGTERM, and SIGKILL of the launcher. The corrected
subprocess test includes a separately session-detached child and grandchild,
neither inheriting the locks, with delayed synthetic UI writes. It verifies
root/helper PIDs are gone (not zombies), active token revocation, immediate
reacquisition of both locks after cleanup, and no delayed action under new
ownership. The test itself reaps RED-phase survivors, never leaving a live helper.

Additional RED tests exposed retained NativeUI objects acting after revocation
and a missing cross-Store quarantine gate; both are now GREEN. An explicit
supervisor-SIGKILL test verifies uncertainty, active-token invalidation and
quarantine refusal, **not** impossible cleanup by a dead supervisor.

Split-module correction verification (all synthetic, except real ffmpeg on a
synthetic lavfi image): **42 test methods passed**: containment 1 (six lifecycle
subtests), native 10, enrollment 15, receiver 9, ledger 7. The enrollment module
passed in 126.588 seconds; splitting avoided the previously encountered full
command timeout. `git diff --check` and `npm run format:check` also passed. No
live browser, Google enrollment, credentials, services or profiles were touched.
