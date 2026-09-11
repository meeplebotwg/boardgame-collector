# 9. Automatic contact-book backup to user-visible storage, and an update-check readout

Date: 2026-09-04

## Status

Extended by [ADR 0010](0010-private-meeple-handoff.md): saving/capture and
on-device backups remain local, but explicit Send to Meeple shares selected
records with a private receiver and may expose them to Meeple/model providers.
The device-local/no-network claims below describe the original decision.


Accepted (captain decision, 2026-09-04 — after a lost contact).

## Context

The contact book (ADR 0003) lives in `localStorage`, which the WebView keeps
in the app's private data. An uninstall or an "app data clear" wipes it, and
Android's own cloud backup is deliberately OFF (`allowBackup="false"` plus
`data_extraction_rules.xml`, a review hardening that stays). The captain hit
exactly that: reinstalling after the signing keys changed took the book with
it, and a contact was gone.

He asked the obvious question — "why can't the app write to a local file
automatically?" — and it is the right one. The privacy promise in ADR 0003 and
in the shipped banner is that nothing here leaves the device. It never said
the book has to be invisible to its own owner.

Separately, the self-updater (ADR 0007) is deliberately silent on failure, and
that silence turned out to be undiagnosable: the home IP's anonymous GitHub
rate limit was exhausted, so the check failed every time and looked exactly
like "no new release".

## Decision

**Automatic backup.** On every contact change and on app launch, the app
writes the whole book as JSON to `Downloads/BGN Coordinator/`, named
`bgn-contacts-YYYY-MM-DD-HHmm.json`. The newest 5 are kept; older ones are
pruned after each write — **except a backup holding more contacts than the
book being written, which is never pruned** (captain decision). The keep
window alone was not enough: a data clear, a declined restore, and a handful
of saves would rotate the whole pre-wipe book off the device, one small write
at a time — the exact incident this feature exists to prevent. An oversized
stale file costs a few kilobytes and errs in the safe direction. An empty book
is never written at all: the n=0 case of the same rule.

The write goes through a `BgnBackup` `JavascriptInterface` in
`MainActivity.kt`, alongside ADR 0007's `BgnInstaller`. `tauri-plugin-fs`
reaches only app-scoped directories on Android — exactly the ones an uninstall
clears — so the plugin cannot do this job. MediaStore's Downloads collection
can, needs **no permission** on API 29+, and its files survive an uninstall.
Below API 29 a write would need `WRITE_EXTERNAL_STORAGE`; the app does not ask
for it and simply does not back up there.

**This is compatible with the device-local promise.** The file is on the
device's own storage, written by the app, readable by its owner in the Files
app. Nothing is uploaded, no account is involved, no network call is made, and
Android's cloud backup and device-transfer exclusions stay exactly as they are
— those keep Google out of the book, and this keeps the coordinator in it.

**Fire-and-forget.** Every backup call is wrapped and runs off the
interactive path: no bridge (bare-browser dev, older Android) or a storage
failure means no backup this time, never a failed or delayed contact save.
Same posture as the update check. The bridge reports a failed write by
RETURNING a token rather than throwing, so nothing is pruned until a write
is confirmed — a full disk must not delete a real backup with nothing
written to replace it. The same rule holds inside the bridge: a second write
in the same minute overwrites that row in place rather than deleting and
re-inserting it, so a failed write can never leave the minute with no file
at all. (The row is reused, not recreated, because a fresh insert under a
name MediaStore already holds produces "name (1).json" — a name the dated
pruning would never recognise again.)

**Restore.** A launch with an empty book plus a readable backup on disk raises
one card on Home offering the newest **readable** file — a kill between
MediaStore's insert and the stream write can leave a zero-byte file that is
newest by name, so the read walks back through the older copies rather than
dropping the offer at the moment it is most wanted. The card counts what a
restore would actually add rather than the file's own length (captain
decision): the merge drops entries identical on everything the coordinator
typed, so a file carrying the same contact twice must not promise two. "Not now" stays quiet for the rest
of the session. There is also an explicit **Import from a backup file** on the
contacts screen, which opens Android's own document picker — after a reinstall
MediaStore no longer credits this app with the old files, so the automatic
offer may not see them while the picker still reaches them. That picker takes
any file type by necessity, so the result is read on a background thread and
capped at 1 MiB; a mis-tapped video reads as "No backup file read." rather
than an ANR.

An import can only **add**: an entry identical to one already in the book is
dropped, and nothing already in the book is overwritten by the file. A stale
backup can never quietly undo an edit made in the app.

**Update-check readout.** `backgroundUpdateCheck` now records one plain string
and a timestamp in `localStorage` on every path — "update available", "up to
date", "release found, no matching APK", "blocked: rate limit" (GitHub's
403/429), "blocked: HTTP \<n\>", "no network", "timed out". Tapping the version
footer on Home reveals it. One string, no logging machinery, and the check
stays as silent as before.

The seventh string is a captain decision: `decideUpdate` refuses a strictly
newer release whose `bgn-coordinator_\<X.Y.Z\>_arm64.apk` asset is missing or
misnamed — reachable between the release workflow publishing the tag and
uploading the asset — and reporting that as "up to date" while a newer version
is live is the same undiagnosable silence the readout exists to break. Only
the reporting changed; what gets offered and installed is untouched.

## Consequences

- The contact book survives uninstall and app-data clears, with no permission,
  no network, and no change to the privacy banner's promise.
- The backup file is plain, readable JSON in the coordinator's Downloads. That
  is the point — it is theirs — but it is also visible to anyone holding the
  unlocked phone, which is the same exposure as the app itself.
- MediaStore ownership does not follow a reinstall, so the automatic restore
  offer may be silent exactly when it is most wanted. The picker import is the
  answer, and it is one tap on the contacts screen.
- Devices below API 29 get no automatic backup. Adding one would mean asking
  for `WRITE_EXTERNAL_STORAGE`, which is not worth it for a coordinator crew on
  modern phones.
- Swap points: the `BgnBackup` bridge, and `FILE_RE`/`KEEP` in `src/backup.js`
  (naming and keep window). The updater readout's strings live in
  `checkOutcome()` in `src/updater.js`.
