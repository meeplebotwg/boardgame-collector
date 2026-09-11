# 5. Coordinator-initiated adds: capture at the door, drain in Google's owner UI

Date: 2026-08-18

## Status

Extended by [ADR 0010](0010-private-meeple-handoff.md): saving/capture and
on-device backups remain local, but explicit Send to Meeple shares selected
records with a private receiver and may expose them to Meeple/model providers.
The device-local/no-network claims below describe the original decision.


Accepted (captain decision, 2026-08-18). Supersedes-in-part ADR 0002: the
self-serve join link is demoted from the primary add mechanism to a secondary
fallback, and the queue's store-and-forward share-intent handoff is replaced
by the coordinator draining the queue in Google Groups' own owner UI.

## Context

ADR 0002's evidence still holds — consumer `googlegroups.com` groups have no
membership API, so the only add paths are joiner self-serve and an owner
acting in the Google Groups web UI. v1 made the self-serve join link primary:
the app composed a join-link message and forwarded it to the member at the
door via the coordinator's share sheet / mail app.

The captain's decision of 2026-08-18 reworks Flow 1 around
**coordinator-initiated adds**: the member does nothing at the door. The
coordinator captures the address, and later — at home, signed into Google —
completes the add in Google's own owner UI. Facts verified live on the real
group the same day:

- The Add members dialog has the direct-add toggle.
- Its optional message field caps at 1000 characters.
- The dialog shows no visible address-count limit, but the community-reported
  owner throttle is ~100 adds/day with 24h+ recovery.
- An owner CANNOT direct-add an address without a Google account on
  `@googlegroups.com` groups — those must go through the invite box — and an
  address's Google-account status is not reliably detectable from here.

## Decision

Flow 1 becomes capture-then-drain, and the app never sends or writes anything:

- **Capture at the door.** The One-person and Paste-a-batch screens keep
  their structure; submitting queues the address(es) in the existing
  device-local queue (`bgn.adds.v1` in localStorage). Optimistic confirm,
  zero member action, fully offline.
- **Assisted drain.** A coordinator-facing drain screen (reachable from Home
  whenever the queue is non-empty) presents the queued addresses FIFO as a
  copy-ready paste block for Google Groups' owner Add members direct-add box,
  with a deep link to `https://groups.google.com/g/bgn-wg/members`. The
  coordinator pastes and submits in Google's signed-in UI, then marks the
  batch drained in-app, which clears those queue entries — behind an
  on-screen confirm, because the queue is the only copy of those addresses
  and clearing them cannot be undone.
- **Honest dual-path.** One primary direct-add block; the coordinator taps an
  address's chip to flag it, which moves it into a second copy block for the
  invite box. The app never guesses which path an address needs, because it
  cannot know.
- **Defensive 100/day batching.** Each presented batch is capped at 100
  addresses and tracked against what was marked drained today; the rest stays
  queued for the next batch rather than risking the owner throttle mid-paste.
- **Join link demoted, not removed.** It remains a secondary action on the
  single-add screen — the member-can-self-serve fallback — with the same
  share-sheet / mailto handoff as before.
- **No roster machinery.** Roster CSV sync is deliberately not built;
  Google's own duplicate rejection covers dedupe.
- **Scan stays unbuilt.** README open question 1 is settled the same day:
  the Scan sign-up-sheet screen is deliberately skipped, so the join link is
  the single-add screen's sole secondary action and the spec's Scan screen
  stays unreachable (README §3, §8).

## Rejected for v1

- **Guessing Google-account status** to route addresses between direct-add
  and invite automatically — not reliably detectable, and a wrong guess
  reads as the app malfunctioning. The coordinator's flag is the truth.
- **Presenting the whole queue as one mega-batch** — it could trip the
  ~100/day owner throttle mid-paste with no clean recovery.
- **Join-link-first** (the ADR 0002 primary) — requires member action at the
  door and a share handoff per add; capture-then-drain is faster at the door
  and finishes adds the coordinator can verify in Google's own UI.

## Consequences

- `src/queue.js` changed semantics: it stores captured addresses (no
  `forward()`); `pendingAddresses()`, `nextBatch()` and `markDrained()` feed
  the drain screen. The drain block + `MEMBERS_URL` in `src/backend.js` are
  the swap points for a future mechanism.
- CTAs and copy changed honestly (README §2, §8): primary CTA is
  add-to-queue semantics, the Done screen says "queued; finish the add from
  home", and the explainer names the real mechanism.
- Everything in the flow stays network-free: clipboard copy and a browser
  intent are the app's only outward moves.
