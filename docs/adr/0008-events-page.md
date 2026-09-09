# 8. Events page — separate from Home, with expandable event details

Date: 2026-08-31

## Status

Accepted (captain decision, 2026-08-31).

## Context

Home's next-event card shows only the soonest not-ended event on the group's
calendar. Coordinators also need the whole upcoming list. Two shapes were on
the table: expand the Home card in place (expand/contract the list inside the
card), or navigate to a dedicated page.

## Decision

Home's next-event card is tappable and opens a separate **Events** screen
listing all upcoming events — scrollable, one card per event, with every
detail the public calendar surface carries (name, date/time range, venue,
RSVP count when public, days-out pill).

The captain explicitly considered and **rejected** expanding the upcoming list
inside the Home card. Home stays the two-second orientation surface — one event, then
the actions. Do not re-litigate this choice without new information.

The page consumes the same credential-free source as the card —
`fetchCalendarEvents()` and the `bgn.calendar.v1` device cache in
`src/backend.js` (`docs/adr/0004-credential-free-luma-handoff.md`), one fresh
read per page entry. Nothing new is fetched: the list is
`upcomingEvents()` over the existing entry shape. Offline-first parity with
the card: the cached list renders instantly, stale data is always marked
(`Last known — pulled …` in flight, `Couldn't reach the calendar — pulled …`
after a failed read), and the empty / couldn't-reach states are as honest as
the card's.

## Amendment — 2026-09-09

The captain requested expandable **individual cards on the Events page**. This
is distinct from the rejected Home-list expansion. Native details/summary keeps
keyboard and touch toggling built in. Expanded content includes public text
description when present, a separately normalized full postal address with
truthful copy feedback/manual fallback, and the actual Luma event link (or the
original external HTTP(S) link / Luma calendar fallback). Missing, obfuscated,
or registration-hidden addresses are never inferred from venue/city or exposed.
Older cached entries remain readable without the new optional fields. Preserve
open cards across the existing calendar revalidation when identity survives.
No new fetches, credentials, maps integration, or dependencies. See README §1b
for the acceptance contract; release/version changes remain a separate gate.

## Consequences

- New `events` value in the navigation stack: Home → Events, with the
  header Cancel (and Android back) returning to Home.
- The Home card carries the event name and a chevron to advertise the tap;
  it stays compact — full detail lives on the page, not the card.
- A richer event source later (funded Luma key) swaps `src/backend.js`
  and nothing else, exactly as for the card.
