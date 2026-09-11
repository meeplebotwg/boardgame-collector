# 3. v1 keeps the contact book device-local, not in a hosted table

Date: 2026-08-15

## Status

Extended by [ADR 0010](0010-private-meeple-handoff.md): saving/capture and
on-device backups remain local, but explicit Send to Meeple shares selected
records with a private receiver and may expose them to Meeple/model providers.
The device-local/no-network claims below describe the original decision.


Accepted (captain decision, 2026-08-15). Extended by ADR 0009 (2026-09-04):
the book is also copied automatically to the device's own
`Downloads/BGN Coordinator/`, because an uninstall or app-data clear wipes
the localStorage store below — still on the device, still no server, sync, or
network, and the Android backup exclusions here stay exactly as they are.

## Context

The contact book (`README.md` section 6) holds coordinators' private details
of real people — names, emails, phone numbers, and free-text notes about who
someone is. The screen leads with a privacy banner: "Private to coordinators.
Nothing here touches the mailing list or gets emailed."

The handoff spec sketches the eventual store as "a simple hosted table"
readable by the coordinators but not by members. How many coordinators need
access, and whether the book needs per-person privacy or shared is fine, is
README Open Question 4 — captain-gated future work, unanswered at the time of
this build.

A promise made in a banner is only worth what the architecture enforces. As
long as the store is device-local, "nothing here touches the mailing list or
gets emailed" is true by construction rather than by review discipline.

## Decision

v1's store is device-local only:

- `src/contacts.js` persists to the `bgn.contacts.v1` localStorage key — the
  same on-device persistence approach as the offline add queue, so contacts
  survive kill/relaunch.
- **No server, no sync, no network.** Nothing in the save-a-contact path makes
  a network call.
- Android backup is excluded so the store cannot leave the device even by the
  platform's own copying: `android:allowBackup="false"` plus
  `res/xml/data_extraction_rules.xml` excluding the WebView storage on the
  generated manifest (captain decision in this same run — see `AGENTS.md` for
  the hand-patched-generated-file list).

## Rejected for v1

- **The hosted shared table** the spec sketches — it is the right answer once
  the coordinators say how many of them need access and whether the book is
  shared or per-person. Revisit when README Open Question 4 lands; the price
  of guessing early is holding real people's private details on a server no
  one has scoped yet.

## Consequences

- `src/contacts.js` is the single swap point: a future hosted mechanism
  replaces only that module's load/save, the way the drain block and
  `MEMBERS_URL` in `src/backend.js` are the swap points for the mailing-list
  add mechanism (`docs/adr/0005-coordinator-initiated-adds.md`).
- Saving a contact must never touch the mailing-list queue/roster or any
  mailing-list surface. That separation is what the privacy banner asserts.
- Contacts need no capture queue. The add queue exists because adds are
  captured at the door and finished later in Google's own UI; a contact is
  complete the moment it saves, so there is nothing to finish.
