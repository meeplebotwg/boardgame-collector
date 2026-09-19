# 12. Private signup reconciliation ledger and timestamp feedback

Status: proposed implementation; no production activation or release.

## Decision and scope

Extend ADR 0010's existing private receiver SQLite database, not a second PII
store. Supersede only ADR 0005's rejection of local roster tracking: retain a
**signup reconciliation ledger**, not a complete/current Google membership roster
or a broadcast send-list. Captured names, email spellings and source variants
remain immutable records. Membership work is deduped by authenticated owner,
fixed group and trimmed/lowercase email, without merging away capture evidence.
This is historical work dedupe, not proof of current subscription; never use it
to automatically re-add someone who may have unsubscribed.

Contacts remain private contacts, never enrolled. No automatic invitations,
Google adapter, selectors, credentials, grants, cron, deployment or APK bump.
Actual processing remains the existing human-gated Hermes path. The desired
hybrid scripted browser worker + Meeple exceptions is a remaining live-UI gate:
the automation browser currently reaches Google Sign in, not an authenticated
owner Members page, and no native browser window is available. Observe the real
authorized UI before implementing or verifying any Groups automation.

## Timestamp contract (UTC Unix seconds; null means unknown)

- Job `received_at`: first committed receiver acceptance of this submission key.
  Replaying the same key/body returns the same job and timestamp.
- Item `received_at`: first committed acceptance of that owner's immutable record
  ID. A new job referencing the same record does not reset it. Job time is exposed
  separately so receipt of a later submission is not confused with first capture.
- Membership `received_at` in the local ledger: first receiver acceptance of this
  owner/group/normalized-email target. Records with different names/sources retain
  their own receipt times and original bodies.
- `added_at`: nullable, explicitly attested actual addition time. CLI `set
  ... --added-at <RFC3339 timestamp with timezone>` records a known time, including
  delayed reconciliation. Never substitute receipt, processing or verification
  time. Without it even an `added` outcome has unknown addition date;
  `already_member` alone NEVER supplies an original addition date.
- `verified_at`: most recent local recording time for an operator-attested
  `added`/`already_member` observation. It is not independent Google proof or proof
  of current membership. `updated` remains the last outcome-recording time for
  all states. Pending (`received`), blocked, invitation_required and
  needs_verification do not create successful verification/addition times.
- Known addition time is preserved across replay/re-verification; conflicting
  known times are rejected rather than silently overwriting history. Historical
  verification/addition times survive later blocked/uncertain statuses.
- Migration adds nullable columns only; no backfill from legacy `updated`, audit,
  device capture times, current time or file metadata. Even replay of legacy data
  keeps unknown receipt/addition/verification dates unknown. Existing audit stays.

## Local reconciliation and app feedback

Authenticated owner-bound GET status and POST receipt carry timestamp fields.
The app persists them in its existing handoff history and shows job receipt,
record first receipt, actual addition and last membership verification separately.
Old servers and phone histories missing fields remain readable and show Unknown;
failed refresh shows last known values, never new confirmation. Updates use the
existing **manual Refresh outcomes** button, not push/background notifications.

Local `export --output FILE` writes exclusive mode-0600 JSON (no stdout PII),
with grouped signup targets, original captures, submission references and complete
outcome audit. No contact export or HTTP listing is added. Local `backup --output
FILE` uses SQLite's backup API for a consistent mode-0600 copy of the existing
whole database (including contacts); protect it as PII, outside source/public
folders. Neither command overwrites an existing file/symlink. Owner protects the
parent directory. No automated retention or second live store.

## Acceptance / evidence

TDD with synthetic example.org records only: real temporary SQLite migration,
replay/restart, duplicate names/source preservation, owner isolation, delayed
addition, unknown already-member dates, audit and secure export/backup; real
loopback HTTP and local CLI through app persistence, plus DOM rendering and
headless browser feedback checks. Run full frontend gates and receiver tests.
These are local/hermetic outcomes, NOT live Google verification. No fixture is
submitted to Google. Parent independently reviews the PR; do not merge/release.
