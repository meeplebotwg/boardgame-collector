# 11. Device-local general notes with automatic recovery copies

Date: 2026-09-11

## Status

Accepted for implementation: Griz requested a general scratchpad in the coordinator
app. ADR 0010 was assigned to private Meeple handoff while this work was in flight;
this decision uses the next free number instead of renumbering that merged ADR.

## Decision

Home's **Take a note** opens a separate Notes screen. Notes are freeform multiline
text, not contacts, signups, events, or Meeple transfer records. Trim outer
whitespace and refuse empty saves/edits. Render text literally, never as HTML.
Saved notes appear newest first; editing preserves the ID, updates the timestamp,
and resurfaces the note. Delete requires an inline **Delete note / Keep note**
confirmation. Fresh screen entry clears unsaved add/edit drafts, matching the
other forms. Failed local writes retain the draft or confirmation and never claim
success. Refreshing the list after another save/delete/import preserves open edit
drafts. Malformed or unreadable local data is never overwritten by a mutation;
Home remains usable, but writes require a readable store.

`src/notes.js` stores `{id, text, ts}` records under `bgn.notes.v1` in localStorage.
`src/notes-screen.js` owns transient editors, import status, and the session-only
Home restore offer. No framework, account, sync, service, or native permission is
added. General notes are never included in Send to Meeple.

Reuse ADR 0009's existing generic `BgnBackup` MediaStore bridge and shared document
picker. Nonempty notes get a dated JSON snapshot on every mutation and launch,
after the interactive path. Names are `bgn-notes-<epoch-ms>-0.json`, monotonically
increasing even after clock rollback, separate from contact/signup filenames.
The envelope is `{type:"bgn-notes", version:1, notes:[...]}`. Confirm write success
and exact readback before pruning: keep the latest five, plus every older snapshot
with an ID/text/timestamp fact absent from the current notes. Edits/deletes cannot
rotate away the only old copy. Storage failures and absent bridges are best effort
and do not fail a successful local save.

**Never write empty notes**, and skip empty/unreadable snapshots when searching
for recovery. Otherwise a launch after an app-data clear would mask the previous
nonempty backup. Empty notes on Home offer the newest readable nonempty snapshot,
counted after ID dedupe; **Not now** dismisses only for this running session.
Restore and explicit **Import from a backup file** only add missing IDs; the
current in-app version always wins. Stale backups can re-add deleted notes but
cannot silently revert an existing edit. The single native picker callback is
exclusive across contacts, signups, and notes; leaving Notes before its result
arrives discards that result rather than importing unexpectedly.

## Limits and verification

- Nothing leaves the device. Backups are plaintext in `Downloads/BGN Coordinator/`,
  visible to the phone owner. Deleting a note does not erase historical backups.
- Uninstall/app-data clear removes localStorage. Automatic MediaStore lookup may
  lose ownership after reinstall; the explicit picker is the recovery fallback.
- API 29+ is required for automatic native backups. A bare browser has local
  persistence but no Downloads backup bridge. Failures are intentionally silent;
  this is not a guarantee against full disks or removal of the Downloads copies.
- Snapshot parser and native picker have the existing 1 MiB ceiling; a notes book
  beyond that size remains local but does not get a new usable backup. No cloud
  backup, attachments, markdown renderer, search, or shared notes in this slice.
- `test/notes.test.js` covers store/backup boundaries and cross-type picker
  serialization; `test/notes-screen.test.js` exercises actual DOM behavior.
  `tools/notes-smoke.py` checks Chromium at 320/390/1280px using synthetic records
  and a **stubbed** BgnBackup. Native MediaStore/picker/reinstall behavior still
  needs Android verification before release. This PR does not merge or release.
