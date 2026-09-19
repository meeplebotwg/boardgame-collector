# 10. Explicit private Send to Meeple (spec and decision)

Status: implementation proposed for review; production activation gated.

Extended by [ADR 0012](0012-private-signup-ledger.md): nullable receipt/addition/
verification timestamps and private reconciliation export in the same SQLite
store. This does not implement the live-UI-gated hybrid Groups worker.

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
human evidence. Fixed-scope `run JOB` uses a filesystem processor lock; without
explicit `--owner-session-ready` it records blocked with login-gate evidence and
never invokes Hermes. With that operator assertion, `hermes --profile meeple
chat --query-file - --max-turns 40 --run-budget 600` receives fixed instructions
via stdin referring only to validated job ID and a private fixed-basename JSON
job file, never shell-interpolated record text. The view contains only signup
IDs, normalized email, fixed group/action and statuses; no contact notes or
free-form source/name. It dedupes email and skips verified/ invitation-required
items. Invocation first durably sets needs_verification so an interruption
cannot quietly become an automatic retry.
Hold lock for the subprocess; no background daemon/cron in this slice. Restart
after an ambiguous Google action requires inspecting membership before retrying.
CLI evidence is operator-attested, not independent Google verification.

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
4. Owner signs in to Groups with computer-use reachable. Read synthetic job,
   exercise default auth-blocked run. Only then explicitly invoke one real job
   with `--owner-session-ready`, verify membership before action and record
   evidence for added/already_member/invitation_required/blocked. Never enroll
   contacts or act on notes. No unattended worker until separate approval.

Retention: phone outbox/history and host DB are not pruned automatically. Owner
must protect/backup host directory; removal is a deliberate private filesystem
operation, not an HTTP route. This slice does not sync host receipts into Android
Downloads backups; after reinstall re-preview and server dedupe are the recovery.
