# BGN Coordinator

Private, phone-first coordinator tool for Board Game Night WG. Tauri 2 Android
shell with bundled, framework-free JavaScript; not a PWA or a member-facing app.

The original detailed UI specification is archived in
[Historical design reference](docs/design-reference.md); it is not the current
implementation or activation contract.

## Working flows

- **Add to mailing list:** capture one signup or paste a batch offline. Capture is
  queued, not confirmation of Google membership. The manual drain offers bounded
  copy-ready blocks for the owner's Google Groups UI; explicit mark-drained is
  separate from every network acknowledgement.
- **Message the list:** review an editable draft and open it in your mail app.
  Nothing sends until you send it there. No scheduled-agent shortcut.
- **Luma:** read public event/calendar pages, then finish the add in Luma's UI.
  Cached event reads remain usable offline, clearly marked as last-known.
- **Private contacts:** name-only and phone/handle contacts are valid. Saving does
  not enroll anyone, send email or upload anything. Contacts and signup recovery
  use additive, on-device Downloads backups (Android API 29+); Android cloud
  backup remains disabled. Uninstall/app-data clear still removes localStorage.
- **General notes:** Home → **Take a note** opens a private multiline scratchpad.
  Save, edit, or delete with inline confirmation; edited notes move to the top.
  Fresh entry clears unsaved drafts. General notes are never sent to Meeple.
  Nonempty notes are backed up on changes and launch; an empty list offers restore
  on Home (Not now lasts this session), and Notes has an add-only file import.
  See [ADR 0011](docs/adr/0011-general-notes.md) for recovery and storage limits.
- **Send to Meeple:** Home opens a full preview of existing records **not yet
  sent**. Select up to 100 signups/private contacts and explicitly send to your
  approved private receiver. Requires the installed native app and Tailscale on
  the phone; ordinary browser development can preview but cannot send.

Ineligible records (for example, display-name signup emails or contact notes over
2,000 characters) remain visible with a reason and a disabled checkbox. Nothing is
truncated or rewritten; other eligible records remain selectable. Validation
failure creates no transfer ledger or manual-drain hold. Existing retry and
receipt controls remain available even when new capture cannot be previewed.

### Received is not Added

The app writes an immutable local batch before any network request. The receiver
commits SQLite before returning an opaque receipt. Unknown delivery, timeout,
leaving the screen, or local persistence failure never clears records: **retry
same batch** with its frozen hostname, port and key. Newly captured and unselected
records remain available for the next preview.

The receiver reports each signup as received/awaiting processing, added, already
member, invitation required, blocked, or needs verification. Private contacts are
stored as private contacts, never enrolled. Receiving a duplicate pending signup
does not mean it is already a Google member. Outcomes require a local operator's
observational evidence; no Google membership API is implemented or simulated as
live. The default local processing command honestly marks the login gate blocked.
Actual processing needs an owner Google session and explicit dedicated native-UI configuration.
No cron/unattended worker or global Hermes webhook is enabled.

Receipt history shows **submission received**, **first record received**, **date
actually added**, and **last membership verification recorded**, in UTC. Use
**Refresh outcomes** manually; these are not push notifications. Unknown dates
stay Unknown (including legacy records and an already-member's original add date).
Failed refresh keeps last-known values, not a new confirmation. Verification is
the local recording time of an operator-attested observation, not an independent
Google check. The ledger is historical reconciliation evidence, **not a complete
or current membership roster, a broadcast send-list, or authority to re-add an
unsubscribed address**. See [ADR 0012](docs/adr/0012-private-signup-ledger.md).

The [hybrid enrollment worker](docs/enrollment-worker.md) processes one signup per
explicit local run, using bounded native UI tools and validated per-record results.
Non-Google accounts require invitations; unknown account eligibility never permits
direct-add. Gmail/custom-domain spelling is not account evidence. The app distinguishes
**Invitation pending — membership not verified**, **Invitation required — not sent**,
and legacy **sending not confirmed**. No invitation is an Added outcome.
Implementation is locally tested, not deployed or real-Google verified.

All originals stay on the phone. Delegated signup addresses are excluded from
manual drain (including after receipt/outcome) to prevent manual/agent races.
Reconcile on the host rather than running parallel Google adds. If processing was
interrupted after a click, inspect membership **and pending invitations** before
any retry. A transport receipt is not exactly-once proof of a Google UI action.

### Privacy and recovery

Saving and on-device backups remain local. **Send to Meeple is an explicit
exception:** selected names, emails, phone/handles, sources and contact-note fields
leave the phone for club logistics. General notes never leave the device. Meeple
and its configured model provider may see shared records. Contact notes are data,
never authority to email, enroll, run commands or do
outreach. The mailing processor's job view excludes private contacts, notes and
free-form sources. No real contacts belong in repository fixtures or logs.

Transfer history is kept in localStorage (`bgn.handoff.v1`), not in the existing
Downloads contact/signup backup formats. No automatic history/host-data pruning.
After reinstall, restoring an old backup re-offers records; stable content
identities and server email/group dedupe reconcile them when explicitly resent.
Do not manually drain restored signups until the host has been checked. Imported
backup claims never establish membership. Protect the private host directory and
its backups; deletion is an explicit owner filesystem operation, not an API.

## Development and tests

```sh
npm ci
npm run lint
npm run format:check
npm run build
npm test
python3 -m unittest discover -s receiver -v
# Linux desktop prerequisites: WebKitGTK 4.1, GTK3, xdo, OpenSSL, appindicator.
cd src-tauri
cargo fmt --check
CARGO_BUILD_JOBS=2 cargo clippy --all-targets -- -D warnings
CARGO_BUILD_JOBS=2 cargo test --lib
CARGO_BUILD_JOBS=2 cargo check
```

`npm run dev -- --host 127.0.0.1` starts Vite. All automated fixtures are synthetic.
`node --test test/handoff-integration.test.js` exercises real JS storage, ephemeral
loopback HTTP, SQLite restart/lost-ACK retry, local CLI gating/outcomes, and polling.
It is **not** native Android/Tailscale/Google proof. It stops its receiver and
removes its synthetic database. `test/handoff-screen.test.js` exercises selection,
privacy/full-field preview, retry, outcomes and manual-drain exclusion in linkedom.

### General-notes browser smoke

Start a dedicated server with `npm run dev -- --host 127.0.0.1 --port 4186 --strictPort`,
then run `python tools/notes-smoke.py` in a Python environment with Playwright and
Chromium installed. Optional `BGN_SMOKE_URL` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
override the server and browser executable. The script uses only synthetic data,
stubs external reads and **BgnBackup**, and writes screenshots to
`/tmp/bgn-notes-evidence`. It verifies 320/390/1280px navigation, CRUD, restore,
picker parsing, persistence/relaunch backup, failure messages, and no overflow.
It does not verify Android MediaStore, native document-picker ownership after
reinstall, or the soft keyboard. Stop the temporary server when finished.

## Private receiver (explicit activation only)

See [ADR/spec 0010](docs/adr/0010-private-meeple-handoff.md) for the full contract,
threat boundary, acceptance and activation gates. Nothing is deployed by this PR.

Create a mode-0700 directory outside the repo and a mode-0600 config with fields
`owners` (array of approved Tailscale logins), `origin` (exact HTTPS origin), and
`port` (new loopback backend port). Real identity/config must remain private.

```sh
python3 receiver/meeple_receiver.py --data "$PRIVATE_DIR" serve --config "$PRIVATE_CONFIG"
python3 receiver/meeple_receiver.py --data "$PRIVATE_DIR" list
python3 receiver/meeple_receiver.py --data "$PRIVATE_DIR" read "$JOB"
# Safe default: no Hermes call or Google action, blocked login-gate evidence.
python3 receiver/meeple_receiver.py --data "$PRIVATE_DIR" run "$JOB"
# Locally record a verified outcome; evidence file is private, not PII in argv.
python3 receiver/meeple_receiver.py --data "$PRIVATE_DIR" set "$JOB" "$ITEM" blocked --evidence-file "$EVIDENCE"
# If an actual addition time is known, supply it explicitly (timezone required).
# Omit --added-at if unknown; never substitute the later confirmation time.
python3 receiver/meeple_receiver.py --data "$PRIVATE_DIR" set "$JOB" "$ITEM" added --evidence-file "$EVIDENCE" --added-at "$KNOWN_RFC3339_TIME"
# Exclusive 0600 files; protect the parent directory and never put these in Git.
python3 receiver/meeple_receiver.py --data "$PRIVATE_DIR" export --output "$NEW_PRIVATE_JSON"
python3 receiver/meeple_receiver.py --data "$PRIVATE_DIR" backup --output "$NEW_PRIVATE_SQLITE"
```

The JSON export groups signup work by owner/group/normalized email and retains all
original captures, names, sources, submission receipts and outcome/attempt audit.
It excludes private contacts. The SQLite backup uses the backup API and includes
the **whole** existing store (contacts too); both files are PII, not public reports.
Neither output can overwrite a file or symlink. No HTTP roster/export route exists.
Receipt replay never resets dates. Re-verification preserves a known addition
date; a conflicting date is rejected, leaving prior evidence intact.

On a separately approved upgrade, stop the old receiver/processor before using
the new CLI or server. Back up the existing database first using SQLite's backup
API (not a live raw file copy). Schema migration is transactional and adds only
nullable columns; existing dates are not reconstructed from `updated`. Do not run
the old writer against the migrated schema. Restore requires stopping writers and
deliberate owner reconciliation; restoring an old backup is not Google state.

Only after review, a new dedicated Tailscale Serve HTTPS port may point to this
**127.0.0.1-only** receiver. Never use Funnel or change existing 443/8443 services.
[Serve identity docs](https://tailscale.com/kb/1312/serve): missing, duplicate or
unknown `Tailscale-User-Login` is rejected; tagged clients have no user identity.
Serve must strip spoofed incoming identity headers. Local host processes are a
trusted boundary and can impersonate the proxy, so do not expose the backend on
LAN/tailnet. POST requires JSON + `X-BGN-Handoff: 1`; unknown Origin is denied,
there is no arbitrary CORS or public result-mutation/agent-prompt endpoint.

The native command independently pins the explicitly approved exact origin in app
config, allows only bounded intake/status requests, verifies TLS and follows no
redirects. Existing general HTTP plugin capabilities are not widened to `.ts.net`.
Since v0.3.2, the installed app accepts runtime-approved HTTPS `*.ts.net` origins;
receiver activation does not require v0.3.6. The new date display does.
No secrets or production hostnames are bundled. A user may reapprove an old exact
endpoint to read its historical receipts; it cannot reroute a pending batch.

After owner login, review [the enrollment runbook](docs/enrollment-worker.md).
A ready run requires `--owner-session-ready --mode reconcile|invite|direct_add
--ui-config "$PRIVATE_UI_CONFIG"`; use `--item "$ITEM"` to pin the signup.
Readiness is an operator assertion, **not** an automated login check. Each run
holds Store and native UI locks and persists uncertainty before external action.
Ambiguous previous attempts reconcile read-only; they never automatically resend.
No real-data run is authorized by this implementation. No model/provider/profile
grants are changed here.

## Packaging and design

Latest published release checked for this PR: **v0.3.5**. Version **0.3.6**
is prepared, not released; see [release notes](docs/releases/v0.3.6.md). Merging
this version bump triggers the existing signed-release workflow, so merge/release
remains an owner gate.
Release pipeline, package identity and
signer continuity remain in [ADR 0006](docs/adr/0006-release-pipeline.md) and
[ADR 0007](docs/adr/0007-in-app-self-updater.md). Never install a debug-signed APK
over a kept user installation. See `AGENTS.md` for native build details; physical
phone/Tailscale and same-signer update verification remain separate release gates.

`Coordinator App.dc.html`, `ios-frame.jsx`, and `support.js` are historical design
reference only. Their generic Discord-agent tasks and fabricated statuses are not
production features. Current structure/copy lives in `src/screens.js`,
`src/handoff-screen.js`, `src/notes-screen.js` and the ADRs; colors/typography in
`src/styles.css`. IBM Plex
fonts are bundled, tap targets are phone-sized, and every text field renders as
text rather than HTML.
