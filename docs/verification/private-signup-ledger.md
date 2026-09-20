# Private signup ledger: local verification

Baseline: upstream `11a2f80b9d920eda6b94a0dda440c0062261e696`.
Contract: [ADR 0012](../adr/0012-private-signup-ledger.md). This is a PR-only
change, not a deployed service or APK release.

## Evidence and behavior

- Extended the existing receiver SQLite store: nullable transactional migration,
  immutable first job/record/membership receipt times, separate explicit actual
  addition time and operator verification-recording time. No second live PII store.
- `receiver/test_ledger.py`: seven new tests, real temporary SQLite and HTTP;
  legacy migration/reopen/replay never fills unknown dates; duplicate name/email
  variants retain original captures and submission references; owner dedupe is
  isolated; success dates stay absent for blocked/invitation/uncertain states;
  delayed addition uses explicit RFC3339 time, never current processing time.
  Re-verification retains known addition dates and rejects conflicting dates.
- Private JSON export includes original capture/source records, all submission
  receipts and full outcome audit. SQLite backup is consistent and includes
  contacts. CLI writes exclusive 0600 files, rejects existing files/symlinks, and
  does not print export/backup contents. No HTTP listing/export route.
- `test/handoff-integration.test.js`: real JS → loopback HTTP → restarted SQLite
  after lost ACK → default blocked CLI → explicitly synthetic local outcomes →
  persisted app status/timestamps. Same receipt/date after restart; unknown
  already-member addition date, explicit delayed addition date, no contact
  enrollment. Temporary receiver/database cleaned up by test.
- `test/handoff.test.js` and `test/handoff-screen.test.js`: strict timestamp
  response validation, legacy compatibility, persistence, separate receipt/add/
  verification display, manual Refresh outcomes, stale dates retained on failed
  refresh, no inferred success dates and no automatic polling/push notifications.
- `tools/verify-meeple-browser.cjs`: isolated headless Chromium, 390px viewport,
  non-loopback requests blocked. Real page/import/render/manual-refresh path with
  an explicitly injected synthetic status transport. Checks already-member
  Unknown addition, separate dates, failed-refresh retention, no overflow and
  zero page errors. Screenshot `/tmp/meeple-ledger-dates-mobile.png` visually
  inspected: labels/dates wrap within the receipt card; no overlap/overflow.
  Synthetic screenshots are not committed.

## Observed RED → GREEN and gates

- Initial receiver RED: 7 tests, 1 failure + 6 errors for absent `received_at`,
  `added_at` argument and CLI flag. Final receiver: **16 passed** (7 new + 9
  existing), `python3 -m unittest discover -s receiver -v`.
- Initial focused frontend RED: **19 tests, 3 failed**, missing receipt dates,
  timestamp validation and rendered dates. Focused GREEN: **19 passed**.
- `npm test`: **186 passed, zero failures**. Existing mocked-network diagnostics
  and Node MockTimers experimental warning remain expected, not live failures.
- `npm run lint`, `npm run format:check`, `npm run build`, `git diff --check`: pass.
  One initial lint pass found unqualified `document` in the new test; fixed with
  the test's explicit `globalThis` binding and rerun successfully.
- Optional browser harness passed with existing external Playwright installation
  and cached Chromium; no runtime/project dependency or grants were added. Its
  Vite process and isolated browser were stopped after verification.
- Release-preparation follow-up: upstream main and latest release both checked
  at v0.3.5; bumped package/lockfile and Tauri config to **0.3.6** (ADR 0006).
  Frontend **186**, receiver **16**, release-gate **8** tests passed again, as did
  lint, format, build and the 390px Chromium smoke (zero page errors/overflow).
- Native host gates passed on Rust/Cargo **1.96.0**, with desktop dependencies
  present: `cargo fmt --check`, `CARGO_BUILD_JOBS=2 cargo clippy --all-targets
  -- -D warnings`, `CARGO_BUILD_JOBS=2 cargo test --lib` (**4 passed**), and
  `CARGO_BUILD_JOBS=2 cargo check`. No native source/permission change. This is
  Linux host compilation, not an Android APK or physical phone test.
- Separate private deployment artifacts were staged outside the repo: pinned
  receiver source, 0600 config, restart/UMask-0077 user unit and review/runbook.
  The staged source passed isolated temporary SQLite/HTTP replay, receipt dates,
  restart, auth-negative/owner-isolation, contact exclusion, blocked-no-action
  default CLI, 0600 export/history/backup and pre-migration backup checks. Unit
  syntax passed; no unit installed/started, no production DB opened, and Serve
  remained unchanged. Direct loopback tests are not new live Serve auth proof.

## Remaining live gate / operational cautions

All CLI success states in these tests are **synthetic operator-attested local
outcomes, not live Google verification**. No test fixture was sent to Google.
The parent's readiness check reaches Google Sign in rather than the owner
Members page, and reports no native browser window. There is no implemented
hybrid browser worker. Processing remains the existing explicitly human-gated
Hermes path until an authorized owner UI can be observed and separately tested.
No invites, Google changes, cron, new secrets, runtime grants, Serve mappings,
production activation, APK, merge, deploy or release occurred. Version **0.3.6**
is prepared for owner review, not released; no live Google add is proven.
The deployment staging source/config is private and separate from this repo.

This ledger is not a full/current membership roster or a safe broadcast source;
dedupe is historical work dedupe, never permission to re-add an unsubscribe.
Migration intentionally cannot recover old receipt/add dates. Stop old writers
and back up before a separately approved upgrade; do not use the old writer on
the new schema. Protect exports/backups as PII outside repositories/public paths.
