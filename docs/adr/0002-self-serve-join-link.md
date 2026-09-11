# 2. v1 adds members via the self-serve join link, not a Google API

Date: 2026-08-15

## Status

Extended by [ADR 0010](0010-private-meeple-handoff.md): saving/capture and
on-device backups remain local, but explicit Send to Meeple shares selected
records with a private receiver and may expose them to Meeple/model providers.
The device-local/no-network claims below describe the original decision.


Accepted (captain decision, 2026-08-15). Superseded-in-part by ADR 0005
(2026-08-18): the self-serve join link is demoted from the primary add
mechanism to a secondary fallback, and the queue's store-and-forward
share-intent handoff is replaced by coordinator-initiated drain in Google
Groups' own owner UI. The context findings below (no membership API for
consumer groups) still stand and ADR 0005 builds on them.

## Context

The handoff spec (`README.md`) assumed the app could add/invite members to
`bgn-wg@googlegroups.com` through Google APIs — a service account with
Directory API access and domain delegation, or a coordinator OAuth flow
("State Management → Real data needed").

The integration scout proved that assumption impossible: **consumer
`googlegroups.com` groups have no membership API of any kind.** The Admin SDK
Directory API and Cloud Identity Groups API manage only Workspace/organization
groups (Google's own Cloud Identity docs: "If you want to create and manage
non-business Google Groups, you can use the Google Groups web interface"), and
the spec's credentials are unobtainable for a consumer account — no domain, no
admin console to delegate from. The only member-add paths that exist are
joiner self-service (the web join link, or the
`bgn-wg+subscribe@googlegroups.com` email command) and an owner manually
adding/inviting in the Google Groups web UI — throttled in practice and
without any programmatic surface.

Full evidence: the firstmate scout report for task
`boardgame-group-integration-scout` (2026-08-15).

## Decision

v1 uses the self-serve join link:

- Submitting an add composes a message containing the join link
  `https://groups.google.com/g/bgn-wg/about` plus a one-line fallback
  `mailto:bgn-wg+subscribe@googlegroups.com`, and hands it to the coordinator's
  own apps: the device share sheet for a single add, one BCC'd email for a
  batch (recipients in BCC via a `mailto:` URI).
- **The app never sends anything itself.** The coordinator's messaging app
  does the sending, so the app needs no Google credentials, no backend, and no
  network: composition works offline, and the mailing-list queue becomes a
  store-and-forward of pending share intents that survives app restarts.
- Batch mode has no per-address automation — one message to the pasted
  addresses via the coordinator's own mail app. The "already on the list"
  check runs against a local roster (an empty stub in this build; CSV-import
  roster sync from the group's Members → Export list is future work).
- Spec copy changed minimally in README.md sections 2 and 8 only: CTA
  `Send join link`, batch CTA `Send join link to <n> people`, the join-link
  explainer, and Done copy "will get your message with the join link".

## Rejected for v1

- **Gmail send-as the group address + Gmail API under coordinator OAuth** —
  the only mechanism that would literally send mail *from*
  `bgn-wg@googlegroups.com`, at the price of OAuth backend work, one-time
  owner setup, and Gmail sending limits. A plausible later upgrade if the
  coordinators ever want it; the joiner still self-confirms either way.
- **Migrating the group** (Google Workspace, groups.io, Mailman) — would
  unlock real membership APIs but costs a forever subscription, changes the
  group address for all members, and buys capability the venue-door use case
  does not need. Revisit only if programmatic management is ever needed at
  volumes beyond what self-serve covers.

## Consequences

- The queue/backend boundary stays the single swap point:
  `src/queue.js` → `handOff()` in `src/backend.js`, whose share-intent
  composer is the one v1 implementation. A future mechanism replaces that
  file only.
- The joiner always confirms on their own phone (taps Join, or confirms the
  subscribe email) — Google's anti-spam contract on every legitimate path.
- One-time owner precondition, verified by a human: the group's join settings
  must allow self-serve join.
