# 10. Explicit private Send to Meeple (spec and decision)

Status: implementation proposed for review; production activation gated.

Extended by [ADR 0012](0012-private-signup-ledger.md): nullable receipt/addition/
verification timestamps and private reconciliation export in the same SQLite
store. The human-gated hybrid worker is specified in [Enrollment worker](../enrollment-worker.md); implementation and synthetic evidence are not live activation.

## Outcome and non-goals

Home → Send to Meeple → select NEW signups/private contacts → durable phone
outbox → Tailscale HTTPS → durable host SQLite receipt → authenticated individual
status. Received is NOT Added. Capture remains offline and manual Groups drain
remains available for non-delegated addresses. No generic agent prompt endpoint, Discord forwarding, global
webhooks, cron, automatic outreach, live Google test mutations, or release here.
This explicitly extends ADRs 0003/0005/0009: saving is still local; selected records
leave the device only after confirmation. Meeple/model providers may see selected
records for club logistics. Venue/sponsor contacts are NEVER mailing signups.

## Contract

Runtime phone origin: HTTPS `*.ts.net` origin only (optional port; no userinfo,
path except `/`, query or fragment). No embedded host, owner email, or secrets.
A dedicated Tauri command pins the explicitly approved exact hostname/port in
app config, validates it independently in Rust, and constructs
only POST `/v1/jobs` or GET `/v1/jobs/<32 lowercase hex>`, disallows redirects,
retains TLS verification, bounds request/response and timeout. It is NOT a generic
HTTP proxy. Existing HTTP plugin scopes and browser CSP are not widened.

POST JSON: `{version:1, key:<32 hex>, records:[...]}`; max 100 records / 128 KiB.
Each record has `id` (64 lowercase hex) and `kind` (signup/contact). Signup:
`email,name,source`; fixed group `bgn-wg` is server-owned. Contact:
`name,email,phone,tag,notes`; no group or commands. Strings bounded to 2000 chars,
name/source/tag to 200, email to 254, phone to 100. Unknown fields rejected.
Phone identity = SHA-256 of deterministic normalized semantic fields, independent
of timestamps/order; identical captures intentionally collapse. This works for
legacy records and restored files without destructive migration or a timestamp
cursor. Changed facts become new records; server membership identity remains
normalized email + fixed group + authenticated owner. Deduping a pending signup
must never claim it is already a Google member.

Before any network, persist selected immutable body, origin and key in one
localStorage outbox write. Retry reuses those bytes even after restart/edits/new
capture/unknown ACK. One outstanding uncertain batch at a time; acknowledged job
history and sent identities retained locally. Storage read/write failures block,
never reset. Preview initially calls all existing records not yet sent. There is
no automatic initial upload. No acknowledgement or outcome clears contacts or
signup queue. Restore after app-data loss can re-offer records; server dedupe
prevents duplicate membership work. Manual drain excludes all delegated email identities (uncertain, received and
completed), including a stale mark-drained call; originals are preserved.
Corrupt transfer history blocks manual drain. After a history-losing reinstall,
operator reconciliation with host precedes manual actions.

## Host boundary

Python stdlib HTTP/SQLite, binds **127.0.0.1 only**, private mode-0700 directory,
0600 database/config. Serve injects `Tailscale-User-Login` and strips incoming
spoofs (https://tailscale.com/kb/1312/serve). Reject absent/tagged/unknown or
duplicate identity headers. This is proxy identity, not a secret: other local
processes are trusted and can impersonate it; NEVER bind backend to LAN/tailnet.
Tests of direct loopback cannot prove Serve stripping; live proxy auth is an
activation gate. Runtime allowlist is private and read on every request.
Reject unknown Origin (native has none), require `X-BGN-Handoff: 1` AND
`application/json` on writes; no CORS, no OPTIONS permission, no cookies.
Receiver allows only create and owner-bound read; outcomes can only be mutated
locally. SQLite transaction commits before ACK; same key/body returns same opaque
job ID, changed body conflicts; same record ID/changed facts conflicts. All
validation precedes transaction. Membership outcomes are shared across duplicate
signup references, contacts stay distinct. Full SQLite synchronous commits;
no logs containing request bodies/PII. Host filesystem is a trusted boundary.

## Local processing and gates

CLI list/read/set exposes private records locally; outcome requires nonempty
human evidence. `run JOB` without `--owner-session-ready` records a login-gate
block and never invokes Hermes. A ready run additionally requires explicit
`--mode direct_add|invite|reconcile` and private `--ui-config`. Each invocation
handles one unique signup target; `--item` selects an exact record. The logical
ledger group key remains `bgn-wg` for compatibility, but the only UI destination
is `https://groups.google.com/g/boardgamenightwg/members`.

The child uses the meeple profile, fixed instructions via stdin, 40 turns/600
seconds, terminal/vision tools and no project/memory rule injection. A fresh
private attempt contains only signup ID/email/status, operator mode/eligibility,
and native transport configuration; no notes, names, sources or contacts. The
parent marks needs_verification before invocation, holds Store and shared native
UI locks, then validates the closed response and screenshot journal before
writing the existing ledger. Worker stdout/exit zero alone cannot imply success.
Manual CLI set takes the Store lock too. No background daemon/cron.

Non-Google accounts require invitation. Unknown eligibility never permits direct
add; `--eligibility google` is an owner assertion from known account/UI evidence,
never inferred from gmail.com or a custom domain. Only explicit invite mode may
send invitations; Google direct-add fallback additionally requires the explicit
`--allow-invitation-fallback` flag. Invite-required without a verified pending
invitation means sending is not confirmed, never Added. Both membership and
pending invitations must be inspected before action and reread afterward.

Uncertain attempts are forced into read-only reconciliation even when requested
with a mutating mode. Empty lists after ambiguity do not authorize resending.
Known members/pending invitations are not replayed; explicit reconcile can check
later membership. Native observations are agent-attested, not independent Google
proof. See the worker spec for trust limits, result semantics and operator gates.

Tests use only synthetic example.org records, real temporary SQLite/HTTP, and
injected native transport seams. Browser demo cannot prove Android VPN/TLS.
Physical phone, signer-preserving APK update, live Serve identity/Origin,
owner login and actual Google outcome remain separately gated.

## Activation (parent review required; do not execute during implementation)

1. Review PR and privacy/model-provider exposure. Choose unused HTTPS and loopback
   ports; do not touch existing 443 or 8443 mappings. Save private config outside
   repo with allowed owner login(s), exact HTTPS origin and loopback port.
2. Run receiver explicitly, then add ONLY the new `tailscale serve --bg
   --https=<NEW_PORT> http://127.0.0.1:<BACKEND_PORT>` mapping. Never use Funnel.
   Verify backend is loopback-only, missing/unknown/tagged callers rejected,
   real Serve strips spoofed identity; test synthetic records first.
3. Build signed update with original signer. Verify native command/HTTPS from
   phone with Tailscale on; off gives unknown/retry while offline capture works.
4. Owner signs in to the dedicated native Groups session. Exercise the default
   blocked run against isolated synthetic intake. Follow the enrollment worker
   runbook for separately authorized read-only rehearsal, then an exact-recipient
   run with explicit readiness, native config, mode and account eligibility.
   Verify both member/invitation lists before and after action. Never enroll
   contacts or act on notes. No unattended worker until separate approval.

Retention: phone outbox/history and host DB are not pruned automatically. Owner
must protect/backup host directory; removal is a deliberate private filesystem
operation, not an HTTP route. This slice does not sync host receipts into Android
Downloads backups; after reinstall re-preview and server dedupe are the recovery.
