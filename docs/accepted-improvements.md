# Accepted improvements: honest messages and durable pending signups

Base: fda27bc6458796b99a1237d06592d4b294ac8415. Scope authorized by Griz: first three review suggestions.

## Acceptance

1. Message templates contain no sample event facts. Coordinator selects an event from the cached public calendar (clearly last-known), or writes a custom draft. Date/time/venue/link/visible RSVP count derive only from that event. Recaps require an explicit non-negative whole-number actual attendance input, never inferred from RSVPs; unknown details are omitted. No event means no prefilled sendable template. Final draft remains editable.
2. Confirmation, receipt and activity describe opening a draft / mail-app handoff, never delivery. Failed handoff keeps the edited draft retryable; no successful activity is recorded.
3. Pending signups get automatic device-visible snapshots on mutation and launch via the existing BgnBackup bridge. Contact arrays and their existing recovery remain compatible and separate. Signup files have a versioned envelope, strict validation, unique non-overwriting names, additive case-insensitive address dedupe, preserved current intents/metadata/FIFO. Restore is explicit, including a picker reachable with an empty queue. Warn that an older snapshot can contain already-completed signups. No automatic resurrection. Do not prune an older snapshot unless all its pending addresses are covered in the new snapshot; failed writes prune nothing. Empty snapshots must not replace recovery-rich ones.

## Non-goals

No cloud, credentials, agent integration, actual mail/signup actions, roster API, release/version/signing-identity changes, framework rewrite, or automatic restore. Android MediaStore ownership still requires the picker after reinstall; external backups remain plaintext on this device and best-effort on API 29+. No guarantee of delivery from an accepted Android intent. Historical activity is not rewritten.

## Verification

Incremental real RED→GREEN node:test regressions; full test/lint/format/frontend build; native Rust gates and x86_64 debug APK through Tauri CLI; isolated owned emulator with synthetic test data only, screenshots/logcat and actual native backup readback. Fork PR under configured bot if upstream is read-only. No merge or release. Parent independently reviews.
