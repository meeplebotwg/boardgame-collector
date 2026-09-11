# Historical design reference — not the current implementation contract

This is the original README design specification preserved verbatim from
`1508b888` (main at the merge resolving #20, before PR #20's own changes);
it includes the #21 Events-page expandable-details additions. Some proposed
behavior, including generic Discord tasks, was never shipped or
has been superseded. Do not use this archive as activation instructions.
See the [current README](../README.md) and [ADR 0010](adr/0010-private-meeple-handoff.md)
for the current private Meeple handoff contract. Paths below are historical
repository-root paths.

---

# Handoff: Board Game Night WG — Coordinator App

## Overview

A private, mobile-first tool for the small group of people who run Board Game Night WG. It is **not** a member-facing app: there is no browse, no RSVP, no public event list. Every screen exists to shorten a chore a coordinator currently does on a laptop.

The four jobs, in priority order:

1. **Add someone to the mailing list** (the Google Group). This is the reason the app exists — it should be reachable in one tap from a cold start.
2. **Message the list** — announcements and reminders from templates.
3. **Add a community Luma event** to the group's calendar by pasting a link.
4. **Save a private contact** (venue, sponsor, vendor, volunteer) with notes — deliberately separate from the mailing list.

Cutting across all four: a **Discord agent handoff**. Every flow ends with the option to hand that specific task to an agent running in the group's Discord instead of finishing it by hand.

## About the Design Files

`Coordinator App.dc.html` in this bundle is a **design reference created in HTML** — a clickable prototype that shows intended layout, copy, and flow. It is not production code and should not be copied into the target app.

The task is to **recreate these designs in the target codebase's environment** using its existing patterns, component library, and navigation. If no codebase exists yet, pick the framework that fits (React Native / Expo is the natural choice for an installable phone app; a mobile web PWA is acceptable if distribution matters more than native feel) and implement there.

The prototype renders inside an iPhone bezel (`ios-frame.jsx`). The bezel is scaffolding for viewing the design on desktop — do not reimplement it.

## Fidelity

**High-fidelity.** Colors, type sizes, spacing, radii, and copy are all final-intent and specified exactly below. Recreate the UI closely, but substitute the target codebase's existing primitives (buttons, inputs, list rows, navigation) where they exist rather than hand-rolling to match pixel-for-pixel. Where the codebase has a house style that conflicts, the codebase wins — the important things to preserve are the information hierarchy, the flow, and the copy.

## Platform Notes

- **Phone-first, portrait only.** Design canvas is 390×844 (iPhone 14/15 logical size).
- Assume a coordinator using this one-handed, standing at a venue door, possibly on bad wifi. Optimistic UI and offline queueing for the mailing-list add are worth the effort.
- All tap targets are **minimum 44px** tall.
- Text inputs use **16px** font size to prevent iOS zoom-on-focus.

## Screens / Views

The screens are the rows of the header table below, plus a shared confirmation. Navigation is a single stack: Home is the root, every other screen pushes on top of it and has a **Cancel** action in the header returning to Home.

### Shared: Header

Fixed at top of every screen, does not scroll.

- Container: `background #FFFFFF`, `border-bottom 1px solid #E4E0D8`, `padding 8px 20px 12px`, flex row, `align-items: flex-end`, `justify-content: space-between`, `gap 12px`.
- **Kicker** (contextual label): IBM Plex Mono, 10px, `letter-spacing 0.12em`, uppercase, `#9A9288`.
- **Title**: IBM Plex Sans, 21px, weight 700, `#222222`, `line-height 1.2`.
- **Action** (right): 13px, weight 600, `#3273DC`, `padding 8px 2px`, `white-space: nowrap`. Tapping returns to Home.

Per-screen header values:

| Screen | Kicker | Title | Action |
|---|---|---|---|
| Home | `Wednesday crew` | `Home` | — |
| Events | `Community calendar` | `Upcoming events` | `Cancel` |
| Add to list | `Mailing list` | `Add members` | `Cancel` |
| Drain | `Mailing list` | `Finish the adds` | `Cancel` |
| Update | `App update` | `Update the app` | `Cancel` |
| Scan | `Mailing list` | `Scan sheet` | `Cancel` |
| Message | `<n> members` when the local roster has a count, else `Mailing list` | `Message the list` | `Cancel` |
| Luma | `Community calendar` | `Add Luma event` | `Cancel` |
| Contact | `Private · coordinators only` | `Save a contact` | `Cancel` |
| Agent | `#coordinators` | `Agent 🤖` | `Cancel` |
| Done | — | `Done` | — |

### Shared: Content area

Below the header: `flex: 1`, scrollable, `padding 16px 16px 40px`, flex column, `gap 14px`. Page background `#F6F4F0`.

### Shared: Card

The repeating container across all screens.

- `background #FFFFFF`, `border 1px solid #E4E0D8`, `border-radius 14px`, `padding 16px`, flex column, `gap` 10–14px depending on density.

### Shared: Section label

IBM Plex Mono, 10px, `letter-spacing 0.12em`, uppercase, `#9A9288`, `padding 4px 4px 0`. Each carries a leading emoji.

### Shared: Primary CTA

- Enabled: `background #1E1B17`, `color #FFFFFF`, `border-radius 12px`, `padding 16px`, centered, 15px, weight 600, `cursor: pointer`.
- Disabled: `background #E7E3DB`, `color #A09889`, not tappable. Label changes to an instruction (e.g. `Enter an email`) rather than staying static and greyed.

### Shared: Chip (single-select)

- Base: 12.5px, `padding 9px 13px`, `border-radius 999px`, `min-height 36px`, flex centered.
- Unselected: `border 1px solid #DAD5CB`, `background #FFFFFF`, `color #6B6459`, weight 400.
- Selected: `border 1px solid #FFCFA6`, `background #FFE9D2`, `color #B34700`, weight 600.

### Shared: Agent handoff row

Appears at the bottom of **every** task screen (Add, Batch, Message, Luma, Contact). This is the key cross-cutting pattern.

- `background #FFFFFF`, `border 1px dashed #C9CBF0`, `border-radius 12px`, `padding 13px 15px`, flex row, `gap 11px`, `min-height 44px`. Hover `background #F8F8FE`.
- 🤖 emoji at 16px, then 13px `#3B3E7A` text, then a `›` chevron in `#A9ACD8`.
- Tapping navigates to the Agent screen with the task textarea **pre-filled** with wording specific to that flow:

| From | Pre-filled task text |
|---|---|
| Add (single) | `Add everyone who reacted 🎲 to the last #announcements post to the mailing list.` |
| Add (batch) | `Take the emails I pasted, drop anyone already on the list, and invite the rest.` |
| Message | `Finish this reminder draft and send it to the list Monday at 9am.` |
| Luma | `Watch Luma for Boston tabletop events this week and add anything relevant to our calendar.` |
| Contact | `Email <contact name> about hosting a night in September.` |

Row labels (shown to the user, not the pre-fill):
- Add: `Have the agent pull everyone who reacted 🎲 in Discord onto the list`
- Batch: `Have the agent dedupe this batch and invite the new ones`
- Message: `Have the agent finish this draft and send it Monday 9am`
- Luma: `Have the agent watch Luma and add community events all week`
- Contact: `Have the agent email them about hosting a night in September`

---

### 1. Home

**Purpose:** orient in two seconds, then get to the mailing-list add.

**Layout:** vertical stack, `gap 14px`.

1. **Update card** — only rendered when a newer release is on offer. Same styling as an action card, ⬆️ tile with the Message flow's blue accent: title `Update ready — v<x.y.z>` over sub `Download and install the new version`. Taps to the Update screen. The check itself is anonymous, throttled, and silent on failure (`docs/adr/0007-in-app-self-updater.md`).

2. **Restore card** — only rendered on a launch that finds an empty contact book and a readable backup on the device. Card styling, title `Restore your contacts? 📇` over a body naming how many contacts a restore would actually add and which dated file they came from, then `Restore <n> contact(s)` and `Not now`; declining stays quiet for the rest of the session. The backup is the app's own copy in the phone's `Downloads/BGN Coordinator/` — nothing was sent anywhere (`docs/adr/0009-automatic-contact-backup.md`).

3. **Next event card** — live from the group's public Luma calendar, the same credential-free read flow 3's dedupe uses (`fetchCalendarEvents()` in `src/backend.js`, one GET per Home entry; `docs/adr/0004-credential-free-luma-handoff.md`). It shows the soonest event that has not ended yet; every part degrades on its own when the calendar does not carry it. The whole card is tappable and opens the Events page (§1b) — a chevron in the title row advertises it; expanding the upcoming list inside this Home card was considered and rejected (`docs/adr/0008-events-page.md`).
   - Title row: `🎲 Next event` (15px, weight 700, `#222`) left; pill right — IBM Plex Mono 11px, `color #B34700`, `background #FFE9D2`, `border 1px solid #FFCFA6`, `border-radius 999px`, `padding 3px 9px`, text `Today` / `Tomorrow` / `<n> days out`, counted in the event's own timezone and hidden when the start can't be read — then the `›` chevron (`#C3BCB1`).
   - Lines, 14px `#444`: the event's name, the date and time range (`Wednesday, Aug 5 · 6:00–9:00 pm`; the end time drops when it is missing or the event runs overnight), then the venue (`Cambridge Public Library, Lecture Hall`). Each drops out when the calendar doesn't carry it.
   - Stat row: `border-top 1px solid #EFEBE3`, `padding-top 10px`, flex row `gap 26px`. Each stat = value (20px, weight 700, `#222`) over label (11px, `#8A8378`): **RSVPs**, only when the public calendar carries the count and the event doesn't hide it, then **On the list**, which waits on a member-count source of truth (the roster stub is empty, so it doesn't render yet). There is no **Capacity** stat: the public surface carries no capacity number, so the tile is omitted rather than faked — the prototype's 34/50/412 were placeholders.
   - States, in the lines' place: spinner + `Pulling next event…` on a cold start, `No upcoming events on the calendar.` when the calendar has none, `Couldn't reach the calendar.` when the read fails or its page no longer parses. The last successful read is cached on the device (`bgn.calendar.v1`), so a venue-door cold start on bad wifi shows the last known event instead of nothing — marked `Last known — pulled <n> min ago` while the read is in flight, `Couldn't reach the calendar — pulled <n> min ago` once it fails. Never unmarked stale data; a failed read never overwrites the cache or claims the calendar is empty.

4. **Queued adds card** — only rendered when the local add queue is non-empty. Same styling as an action card, 📥 tile: title `<n> queued add(s) — finish them at home` over sub `Paste them into Google Groups' own Add members`. Taps to the Drain screen (see §2, *Capture mechanism*).

5. **Agent status strip** — only rendered when the agent has work. `background #F3F4FD`, `border 1px solid #DDDFF6`, `border-radius 14px`, `padding 13px 15px`. 🤖 at 16px; title 13.5px weight 600 `#2E3168` reading `2 tasks running, 1 waiting on you`; sub 12.5px `#55578F` reading `Agent is working in #coordinators 🟢`. Chevron `#A9ACD8`. Taps to Agent screen (empty task field).

6. **Section label:** `👇 Do a thing`

7. **Four action cards.** Each: card styling above but `padding 15px 16px`, flex row, `gap 14px`, `min-height 44px`. Left icon tile is `40×40`, `border-radius 11px`, `border 1px solid`, emoji at 19px. Then title (15px, weight 600, `#222`) over subtitle (12.5px, `#7D766B`), then `›` in `#C3BCB1`.

   | Emoji | Tile bg / border | Title | Subtitle | Hover border / bg |
   |---|---|---|---|---|
   | 📬 | `#FFE9D2` / `#FFCFA6` | Add to mailing list | Paste or type — batches too | `#FFCFA6` / `#FFFDF9` |
   | 📣 | `#E8EEF9` / `#CFDCF2` | Message the list | Announce or remind, from a template | `#CFDCF2` / `#FCFDFF` |
   | 🗓️ | `#EDE6F7` / `#DCCFF0` | Add a community Luma event | Paste a link → our calendar | `#DCCFF0` / `#FDFCFF` |
   | 📇 | `#E3F4EA` / `#BFE3CE` | Save a contact | Venue, sponsor, or vendor — not the list | `#BFE3CE` / `#FBFEFC` |

8. **Section label:** `✨ Recent activity`

9. **Recent list** — one card, rows separated by `border-top 1px solid #EFEBE3`, each `padding 12px 16px`, flex row `gap 12px`. Left: IBM Plex Mono 11px `#9A9288`, fixed `width 46px`. Right: 13.5px `#444`, `line-height 1.35`.
   - `Today` — 4 people added after the Somerville meetup
   - `Mon` — Reminder sent — 412 members
   - `Jul 24` — Added "Chess in the Park" to the calendar

10. **Version footer** — centered line closing the screen, reading `BGN Coordinator v<x.y.z>`. Same muted mono as the section labels (IBM Plex Mono 10px uppercase, `letter-spacing 0.12em`, `color #9A9288`). So a coordinator can confirm which build is on the phone, especially around the self-updater. Tapping it toggles the last update-check readout underneath — `Update check <date and time> — <outcome>`, or `Update check — none finished yet` — in the same muted mono, so a check that quietly failed can be told apart from "no new release" (`docs/adr/0009-automatic-contact-backup.md`). The number is the app's real version, inlined at build time from `src-tauri/tauri.conf.json` (the release pipeline's source of truth, `docs/adr/0006-release-pipeline.md`) — the same value the updater compares against the latest release, never a second copy.

### 1b. Events

**Purpose:** the full upcoming list behind Home's next-event card, which taps through here (captain decision — a separate scrollable page, not expand-in-place on the card; `docs/adr/0008-events-page.md`).

**Layout:** vertical stack, `gap 14px`, scrollable. Every event the calendar read returns that hasn't ended yet, soonest first — one card each, same card styling as Home's event card:

- Title row: event name (15px, weight 700, `#222`; `Untitled event` when the calendar doesn't carry one) left; the same days-out pill as Home (`Today` / `Tomorrow` / `<n> days out`), hidden when the start can't be read.
- Lines, 14px `#444`: the date and time range, the venue, then `<n> RSVPs` — only when the public surface carries the count and the event doesn't hide it (same rule as Home; no capacity anywhere it's absent).
- Cards on this page start collapsed. Tap/click the summary (or focus it and press Enter/Space) to expand/collapse public event details. Home's Next event still navigates here; it does not expand.
- Expanded content shows any public description as text and a selectable full address with a `Copy address` button. Copy success is announced only after the clipboard write resolves; unavailable/denied clipboard access leaves the address selectable with a manual-copy instruction. A venue/city is not a full address: missing, obfuscated, or registration-hidden addresses show `Full address unavailable.` and no copy button.
- `Open in Luma` opens the real Luma event URL through the existing external opener. External-calendar entries use `Open original event` with their safe original HTTP(S) URL, or `Open Luma calendar` if no event URL survives. Never fabricate a Luma slug from an external URL. Copy/link controls do not collapse the card.
- No Maps SDK, embed, deep link, geocoding, or service changes: coordinators paste the copied address wherever they choose. No event-page fetches; details come from the same calendar read, with optional fields missing in older caches. Revalidation retains expanded cards where event identity survives.
- An entry whose start can't be read sorts last rather than disappearing — unless its end date says it is already over.

**Source and states:** the same credential-free read and device cache as Home's card (`fetchCalendarEvents()` / `bgn.calendar.v1`), one fresh read per page entry. The cached list renders instantly; states match the card's honesty — `Last known — pulled <n> min ago` above the list while the read is in flight, `Couldn't reach the calendar — pulled <n> min ago` once it fails, `Pulling events…` with a spinner when there is no cache yet, `Couldn't reach the calendar.` when there is no cache and the read fails, and `No upcoming events on the calendar.` when the read succeeds with an empty list. A failed read never overwrites the cache or claims the calendar is empty.

**Verification:** `npm test` covers source normalization and DOM behavior. For
real native disclosure/keyboard, clipboard, and 320/390/1280px layout checks,
run `npm run dev -- --host 127.0.0.1 --port 4178 --strictPort`, then
`python tools/event-details-smoke.py` in a Python environment with Playwright
and Chromium installed (`python -m pip install playwright` and
`python -m playwright install chromium`, preferably in a temporary venv).
The smoke uses only labeled synthetic fixtures, writes screenshots under
`/tmp/bgn-event-details-evidence`, and does not contact Luma or use real contacts.
It verifies opener IPC with a test stub, not an Android external handler.
Android WebView clipboard/paste and ACTION_VIEW still need a native-device smoke
before release. Stop the temporary dev server after verification.

### 2. Add to mailing list

**Purpose:** the core flow. Capture an email at the door with zero member action; the coordinator finishes the add in the Google Group's own owner UI from home.

**Layout:** a two-tab segmented control at top, then mode-specific content.

**Tabs** (`One person` / `Paste a batch`): flex row `gap 10px`, each `flex: 1`, centered, 13.5px weight 600, `padding 11px`, `border-radius 11px`, `min-height 44px`. Active: `background #1E1B17`, `color #FFF`, `border 1px solid #1E1B17`. Inactive: `background #FFF`, `color #6B6459`, `border 1px solid #E4E0D8`.

**Mode: One person**

- Card with three field groups, `gap 14px`. Each group: label (12px, weight 600, `#6B6459`; optional fields append ` optional` in weight 400 `#A09889`) over input.
  - **Input styling:** `border 1px solid #DAD5CB`, `border-radius 10px`, `padding 13px 12px`, `font-size 16px`, `color #222`, `background #FCFBF9`, `outline: none`, `min-height 44px`.
  - `Email` — placeholder `name@example.com`, IBM Plex Sans.
  - `Name` (optional) — placeholder `Alex Rivera`.
  - `Met them at` — chip row, wraps, `gap 8px`: `At an event` (default) · `Discord` · `Friend referral` · `Website form`.
- **Explainer:** `background #FFFDF9`, `border 1px solid #EFE7DA`, `border-radius 14px`, `padding 14px 16px`, flex row `gap 11px`. `◔` glyph in `#B34700`; body 12.5px `#6B6459` `line-height 1.45`: "Queues them on this device; you finish the add in `bgn-wg`'s Google Groups page from home — they do nothing at the door." The group name renders in IBM Plex Mono 12px.
- **CTA:** enabled only when email matches `/.+@.+\..+/`. Label `Add to the list`, disabled label `Enter an email`.
- **Secondary:** centered text link, 13.5px weight 600 `#3273DC`, `Or send them the self-serve join link` — the demoted join-link fallback: hands the join-link message to the coordinator's own apps (device share sheet; mailto to the member where there is no Web Share API). Enabled on the same `/.+@.+\..+/` rule as the CTA, since the mailto fallback needs an address; disabled label `Enter an email to share the join link`.
- **Agent handoff row.**

**Mode: Paste a batch**

- Card: label `Paste emails — commas, spaces, or one per line`, then textarea — same input styling but IBM Plex Mono 15px, `min-height 150px`, `resize: none`.
- Below textarea, flex row `justify-content: space-between`: left 12.5px `#7D766B` showing `<n> valid addresses` or `Nothing pasted yet`; right 12.5px `#B34700` showing `<n> already on the list` when parsed addresses match the local roster (an empty stub — roster CSV sync is deliberately not built; Google's own duplicate rejection covers dedupe, `docs/adr/0005-coordinator-initiated-adds.md`).
- Parsing: split on `/[\s,;]+/`, keep tokens containing `@` past position 0.
- **CTA:** `Queue <n> for the list`, disabled label `Paste some emails`.
- **Agent handoff row.**

**Capture mechanism (coordinator-initiated adds):** submitting queues the address(es) on-device in the durable offline queue — optimistic confirm, zero member action, no network. From Home, a non-empty queue shows a banner card leading to the **drain screen**: a copy-ready paste block of the queued addresses (FIFO) for Google Groups' owner Add members direct-add box, a deep link to `https://groups.google.com/g/bgn-wg/members`, and a per-address flag that moves entries into a second copy block for the invite box (an owner cannot direct-add an address without a Google account on `@googlegroups.com` groups, and the app cannot detect which path an address needs — it never guesses). Each batch is capped at 100 addresses and tracked against what was marked drained today, defending against the community-reported ~100/day owner-add throttle; the rest stays queued for the next batch. Marking the batch drained clears those queue entries, behind an on-screen confirm (the queue is the only copy of those addresses). The app copies text and opens a browser intent — it never sends or writes anything; the coordinator acting in Google's signed-in UI is the only write path (`docs/adr/0005-coordinator-initiated-adds.md`).

### 3. Scan sign-up sheet

**Status: deliberately not built.** Open question 1 is answered no for v1 — batch paste is enough — so this screen stays unreachable (`docs/adr/0005-coordinator-initiated-adds.md`). The spec below is kept for whenever it is revisited.

**Purpose:** clear the paper sheet from the door in one go.

- **Viewfinder:** `background #1E1B17`, `border-radius 16px`, `height 300px`, centered. Inside: a `176×176` box, `border 2px solid rgba(255,255,255,0.85)`, `border-radius 14px`. Caption absolutely positioned `bottom 16px`, centered, 12.5px `rgba(255,255,255,0.7)`: `Point at the sign-up sheet`.
- **Results card:** heading `Read 3 rows` (13px, weight 700). Rows separated by `border-top 1px solid #EFEBE3`, `padding 9px 0`, flex row `gap 10px`. Left: `18×18` check tile, `border-radius 5px`, `background #FFE9D2`, `border 1px solid #FFCFA6`, `color #B34700`, `✓` at 12px. Right: name 13.5px `#222` over email IBM Plex Mono 11.5px `#8A8378` with ellipsis overflow.
  - Priya Raman / priya.raman@gmail.com
  - Dev Okonkwo / dev.okonkwo@fastmail.com
  - Marta Lein / mlein@northeastern.edu
- **CTA:** `Invite all 3`.

**Real implementation note:** the prototype fakes OCR. In production this is either (a) camera + OCR on handwriting, which is unreliable, or (b) a QR code printed on the sheet that members scan themselves. **Recommend (b)** — print a QR at the door linking to a signup form, and use this screen to display/regenerate that QR rather than to read handwriting. Confirm direction with the coordinators before building.

### 4. Message the list

**Purpose:** send an announcement or reminder without composing from scratch.

- **Section label:** `Start from`
- **Three template cards**, each `padding 14px 16px`, flex column `gap 3px`, `min-height 44px`. Title 14.5px weight 600 `#222`; description 12.5px `#7D766B`. Selected card: `border 1px solid #1E1B17`; unselected `#E4E0D8`.
  - `Event reminder` — Two days out — time, place, what to bring
  - `New event announced` — Date, venue, RSVP link
  - `Post-night recap` — Games played, photos, next date
- **Preview card:** label `Preview` (12px weight 600 `#6B6459`), body 13.5px `#333`, `line-height 1.5`, `white-space: pre-wrap`. It is a borderless textarea styled as that body text, so the draft is editable in place; picking a template replaces the draft with that template's copy. Content swaps with selection:
  - *Reminder:* `Subject: Wednesday at the Cambridge Library` / blank / `Hi all — we're on for Wed Aug 5, 6–9pm, Lecture Hall. 34 RSVPs so far. Bring a game if you've got a favorite.`
  - *Announce:* `Subject: Next board game night — Aug 5` / blank / `We've got the Lecture Hall at Cambridge Public Library, 6–9pm. Free, all levels. RSVP so we know how many tables to set.`
  - *Recap:* `Subject: Last night was a good one` / blank / `Thanks to the 38 of you who came out. Heavy Wingspan energy. Photos below — next up Aug 5.`
- **CTA:** `Send to <n> members` when the local roster has a count, else `Send to the list`; disabled label `Write something first` once the draft is empty. It opens a confirm step (`Send this message?` → `Open in my mail app` / `Keep editing`) before the send.
- **Agent handoff row.**

**Send mechanism:** confirming hands the edited draft to the coordinator's own mail app as a mailto to `bgn-wg@googlegroups.com` — mailing a Google Group's address *is* broadcasting to it, so the app sends nothing itself (`docs/adr/0002-self-serve-join-link.md`).

**Member count:** there is no live source — consumer `googlegroups.com` groups have no membership API. The count comes from the same local roster the batch dupe check uses (an empty stub until CSV roster sync exists), and the copy drops the number entirely when the roster has none.

### 5. Add a community Luma event

**Purpose:** keep the community calendar current from a link someone dropped in chat.

- **Input card:** label `Luma link`, input in IBM Plex Mono, placeholder `lu.ma/…`.
- **Preview card** — renders once the pasted text is a Luma link, from a read of that event's own public page. Every field degrades on its own: whatever Luma serves is what shows (title falls back to `The event`, the meta line drops the parts that are missing, pills are the event's own categories).
  - Section label `Pulled from Luma`
  - Title 16px weight 700 `#222`: `Tabletop RPG One-Shots @ Trident`
  - Meta 13.5px `#555`: `Thu Aug 13 · 7:00 pm · Trident Booksellers`
  - Tag pills, IBM Plex Mono 11px, `border-radius 999px`, `padding 4px 10px`: first pill `#5B3BA8` on `#EDE6F7`, border `#DCCFF0`; the rest `#6B6459` on `#F2EFE9`, border `#E4E0D8`.
- **Loading / error card** in the preview's place: spinner + `Pulling preview…` while the read is in flight; on failure one line saying which failure it was — offline, not an event link, or couldn't-pull (private events read as the last).
- **Duplicate check** against the group calendar, run alongside the preview. A hit renders below the preview in success tone (`Already on our calendar`), not as an error. An unreadable calendar shows `Couldn't check our calendar — you can still add it there.` and never blocks the add.
- **CTA:** `Add to our calendar`; disabled labels `Paste a Luma link`, `Pulling preview…`, `No preview to add`, and `Already on our calendar` on a duplicate hit.
- **Agent handoff row.**

**Add mechanism:** the app never writes to Luma. The CTA copies the event URL to the clipboard and opens the group calendar's own *Add Existing Luma Event* panel in the coordinator's browser, where they are already signed in as an admin — they paste and confirm there. Both reads are read-only GETs of public pages, one per pasted link plus one calendar read per check. A funded Luma Plus key would replace `handOffLuma()`/`fetchCalendarEvents()` in `src/backend.js` and nothing else (`docs/adr/0004-credential-free-luma-handoff.md`).

### 6. Save a contact

**Purpose:** remember the venue booker's constraints and the sponsor's last favor — without those people landing on the mailing list.

- **Privacy banner** (first element, before the form): `background #F4FAF6`, `border 1px solid #DCEEE4`, `border-radius 14px`, `padding 13px 15px`, flex row `gap 10px`. 🔒 at 15px; body 12.5px `#4C6155` `line-height 1.45`: "Private to coordinators. Nothing here touches the mailing list or gets emailed."
- **Form card**, `gap 14px`:
  - `Name` — placeholder `Dana Whitfield`
  - `Email` — placeholder `events@cambridgelibrary.org`, IBM Plex Mono
  - `Phone or handle` (optional) — placeholder `617-555-0148 · @dana on Discord`
  - `Who is this?` — chip row: `🏛️ Venue` (default) · `💰 Sponsor` · `🎁 Vendor` · `🙋 Volunteer`
  - `Notes 📝` — textarea, IBM Plex Sans 15px, `min-height 110px`, `line-height 1.45`, placeholder `Books the lecture hall. Needs 3 weeks notice, no food past 8pm.`
- **CTA:** `Save contact 📇`, enabled when name is non-empty; disabled label `Add a name first`.
- **Agent handoff row.**
- **Section label:** `Saved contacts`
- **Saved list** — one card, rows `padding 13px 16px`, `border-top 1px solid #EFEBE3`, flex row `gap 12px`, emoji 17px, name 14px weight 600 `#222`, note 12.5px `#7D766B`:
  - 🏛️ `Dana Whitfield · Cambridge Library` — Books the lecture hall. 3 weeks notice, no food past 8pm.
  - 🎁 `Trident Booksellers` — Lends 6 games per night if we credit them in the recap.
  - 💰 `Marco @ Somerville Brewing` — Covered snacks in June. Ask again in the fall.
- **Import from a backup file** — link-styled button below the saved list, opening Android's own document picker. For the backup this install can no longer see by itself; the merge only ever adds, never overwrites. A status line under it reads `Added <n> contact(s) from the backup.`, `Nothing new — those contacts are already saved.`, or `No backup file read.` (`docs/adr/0009-automatic-contact-backup.md`).

### 7. Discord agent

**Purpose:** offload a task while away from a computer. Reachable from Home's status strip or any flow's handoff row.

- **Connection banner:** `background #F3F4FD`, `border 1px solid #DDDFF6`, `border-radius 14px`, `padding 14px 15px`, flex row `gap 11px`. 🔗 at 16px. Title 13.5px weight 600 `#2E3168`: `Connected to #coordinators`. Sub 12.5px `#55578F` `line-height 1.45`: "Agent posts there when a task finishes, so anyone can pick it up. 🟢 Online".
- **Task card:** label `Ask for something 🗣️`; textarea IBM Plex Sans 15px, `min-height 92px`, `line-height 1.45`, placeholder `Add everyone who reacted 🎲 in #announcements to the mailing list`. Pre-filled when arriving from a handoff row.
- **Suggestion chips** below the textarea, wrapping, `gap 8px`. Style: 12.5px, `padding 9px 12px`, `border-radius 999px`, `min-height 36px`, `border 1px solid #C9CBF0`, `background #F3F4FD`, `color #3B3E7A`. Tapping replaces the textarea with the chip's text minus its leading emoji.
  - `🎲 Pull Discord reactions onto the list`
  - `📣 Draft Monday's reminder`
  - `🗓️ Sweep Luma for community events`
- **Guardrail banner:** `background #FFFDF9`, `border 1px solid #EFE7DA`, `border-radius 14px`, `padding 13px 15px`. ✋ at 14px; body 12.5px `#6B6459`: "Anything that emails members or spends money waits for your approval first."
- **CTA:** `Hand it to the agent 🤖`, enabled when the textarea is non-empty; disabled label `Describe the task`.
- **Section label:** `Agent queue`
- **Queue list** — rows `padding 13px 16px`, `border-top 1px solid #EFEBE3`, flex row `gap 11px`, emoji 15px, description 13.5px `#333` `line-height 1.4`, status IBM Plex Mono 11px `#9A9288`:
  - ⏳ `Adding 7 Discord reactors to the mailing list` — `Running · started 20 min ago`
  - ✋ `Reminder email for Aug 5 — drafted, needs your OK` — `Waiting on you`
  - ✅ `Added "Chess in the Park" to the calendar` — `Done · posted in #coordinators`

**Production note:** the "waiting on you" item should be tappable to approve/reject inline. Not built in the prototype — this is the most important missing interaction on this screen.

### 8. Done (shared confirmation)

Reached from every successful action. Header title `Done`, no action.

- Centered column, `gap 16px`, `padding-top 30px`, `text-align: center`.
- **Check badge:** `62×62`, `border-radius 50%`, `background #FFE9D2`, `border 1px solid #FFCFA6`, `✓` at 27px in `#B34700`.
- **Title** 19px weight 700 `#222`; **body** 14px `#6B6459`, `line-height 1.45`, `max-width 260px`.
- **Two buttons**, full width, `gap 10px`: `Add another` (primary dark) and `Back to home` (white, `border 1px solid #E4E0D8`, `color #333`).

Copy per outcome:

| Outcome | Title | Body |
|---|---|---|
| Single add | `Queued for the list` | `<name or email> is queued on this device — finish the add in Google Groups from home.` |
| Batch add | `Queued <n> for the list` | `They're queued on this device — finish the adds in Google Groups from home.` |
| Scan | — | Deliberately skipped (captain decision, 2026-08-18, open question 1): the Scan screen stays unbuilt and unreachable, so it has no done copy. |
| Message sent | `Message sent` | `Your mail app has the message — send it there to reach <n> members / the list. It'll also show up in the group archive.` |
| Luma added | `Finish adding in Luma` | `Luma opens at our calendar's add-event panel. Paste the link there — <title> shows on our calendar once it's confirmed.` |
| Contact saved | `Contact saved 📇` | `<name> is in the coordinator address book. No emails sent.` |
| Agent task | `Handed off 🤖` | `The agent picked it up and will post in #coordinators when it's done.` |

## Interactions & Behavior

**Navigation.** Single stack, one `screen` value: `home | events | add | drain | update | scan | done | broadcast | luma | contact | agent`. Every non-home screen's header `Cancel` returns to `home`. `Done` offers `Add another` (back to `add`, fields cleared) and `Back to home`. In a real app, back-swipe should mirror `Cancel`.

**Field clearing.** Entering `add` resets email, name, batch, and sets mode to `one`. Entering `broadcast` resets `tpl` to `reminder`, which rebuilds the preview from the template copy and so drops any edited draft. Entering `contact` resets all contact fields (but not the selected tag). Entering `luma` clears the URL. Arriving at `agent` from Home clears the task; arriving from a handoff row sets it to that flow's pre-filled text.

**Validation.**
- Single email: `/.+@.+\..+/`. CTA disabled until it passes.
- Batch: at least one token containing `@`.
- Contact: non-empty trimmed name. Email is *not* required — a venue contact may only have a phone number.
- Agent: non-empty trimmed task.
- Validation is live on every keystroke; there are no inline error messages. The disabled CTA's label is the only prompt.

**Hover states.** Home action cards lift to a tinted background and colored border (values in the Home table). The agent handoff row goes `#F8F8FE`. No transitions specified in the prototype — a `120ms ease` on background/border is appropriate.

**Missing states to build.** The prototype has no loading, error, or empty states. Production needs:
- Pending/spinner on every CTA that hits a network.
- Failure paths for the flows that do hit a network. Neither the mailing-list add nor the broadcast is one of them — they send nothing themselves; the add queues on-device and cannot fail at capture, and a failed broadcast handoff keeps the confirm step up to retry (`docs/adr/0002-self-serve-join-link.md`, `docs/adr/0005-coordinator-initiated-adds.md`). The Luma preview *is* one, and so are Home's next-event card and the Events page behind it: their loading, offline, and empty states ship with them, and both fall back to the last cached read, marked as such (`docs/adr/0004-credential-free-luma-handoff.md`).
- Empty state for the recent-activity and agent-queue lists.

**Responsive.** Phone portrait only. If the target is web, cap content at ~420px and center.

## State Management

Prototype state, all local:

| Key | Type | Default | Notes |
|---|---|---|---|
| `screen` | enum | `home` | see navigation above |
| `mode` | `one \| batch` | `one` | Add screen tabs |
| `email`, `name` | string | `''` | single add |
| `source` | string | `At an event` | acquisition chip |
| `batch` | string | `''` | raw textarea text |
| `luma` | string | `''` | pasted URL |
| `tpl` | `reminder \| announce \| recap` | `reminder` | template selection |
| `cName`, `cEmail`, `cPhone`, `cNotes` | string | `''` | contact form |
| `cTag` | string | `🏛️ Venue` | contact type |
| `task` | string | `''` | agent task text |
| `doneKind` | enum | `one` | drives confirmation copy |

**Real data needed.** Everything numeric or list-shaped in the prototype is hardcoded and must come from a source of truth:

- **Mailing list** — member count (412) and the duplicate check still need a source of truth (roster CSV sync is deliberately not built — Google's own duplicate rejection covers dedupe). Adding members programmatically does not: consumer `googlegroups.com` groups have no membership API, so v1 captures adds at the door and the coordinator drains the queue in Google Groups' own owner UI. See `docs/adr/0005-coordinator-initiated-adds.md`.
- **Event source** — answered: Home's next-event card reads the group's public Luma calendar (`GROUP_CALENDAR` in `src/backend.js`), the same credential-free read as flow 3, for the date/time, venue, and RSVP count. Capacity has no source — that surface carries no capacity number — so the stat is gone rather than faked. See `docs/adr/0004-credential-free-luma-handoff.md`.
- **Luma** — no integration to build for v1: the metadata and the dedupe both come from read-only GETs of public lu.ma pages, and the add is a handoff into Luma's own panel rather than a write. The group's calendar (`GROUP_CALENDAR` in `src/backend.js`) is the one piece of configuration. See `docs/adr/0004-credential-free-luma-handoff.md`.
- **Contacts** — private store, coordinators-only. v1 ships a device-local store (`src/contacts.js`, same on-device persistence as the add queue): no server, no sync, so the privacy banner's promise holds by construction. A shared store — hosted table or otherwise, and never readable by members — waits on open question 4. See `docs/adr/0003-device-local-contact-book.md` and, for the automatic on-device backup that survives an uninstall, `docs/adr/0009-automatic-contact-backup.md`.
- **Discord** — bot in the coordinators server; task queue with status; approval callbacks for anything that emails or spends.
- **Recent activity** — an append-only log of coordinator actions, shown newest-first with relative day labels (`Today`, `Mon`, `Jul 24`).

**Auth.** Coordinators only. Google sign-in restricted to an allowlist is the least-friction option given the mailing list already lives in Google.

## Design Tokens

**Colors**

| Role | Hex |
|---|---|
| Page background | `#F6F4F0` |
| Surface / card | `#FFFFFF` |
| Border | `#E4E0D8` |
| Divider (inside cards) | `#EFEBE3` |
| Input border | `#DAD5CB` |
| Input background | `#FCFBF9` |
| Text primary | `#222222` |
| Text body | `#444444` / `#333333` |
| Text secondary | `#6B6459` |
| Text tertiary | `#7D766B` |
| Text muted / mono labels | `#9A9288` |
| Placeholder / disabled text | `#A09889` |
| Chevron | `#C3BCB1` |
| Ink (primary CTA) | `#1E1B17` |
| Disabled CTA fill | `#E7E3DB` |
| Link | `#3273DC` (hover `#285FB0`) |
| Accent — mail (bg / border / text) | `#FFE9D2` / `#FFCFA6` / `#B34700` |
| Accent — message | `#E8EEF9` / `#CFDCF2` / `#2C5FB3` |
| Accent — calendar | `#EDE6F7` / `#DCCFF0` / `#5B3BA8` |
| Accent — contacts | `#E3F4EA` / `#BFE3CE` / `#4C6155` |
| Accent — agent | `#F3F4FD` / `#DDDFF6` / `#2E3168`, secondary text `#55578F`, chip border `#C9CBF0`, chip text `#3B3E7A`, chevron `#A9ACD8` |
| Warm notice | `#FFFDF9` / `#EFE7DA` |
| Camera viewfinder | `#1E1B17` |

**Typography** — IBM Plex Sans (400/500/600/700) for UI; IBM Plex Mono (400/500) for labels, emails, URLs, and timestamps. Both from Google Fonts.

| Use | Size / weight |
|---|---|
| Screen title | 21px / 700 |
| Stat value | 20px / 700 |
| Confirmation title | 19px / 700 |
| Luma event title | 16px / 700 |
| Input text | 16px / 400 |
| Card title | 15px / 600–700 |
| Body / preview | 13.5–14px / 400 |
| Field label | 12px / 600 |
| Subtitle, helper | 12.5px / 400 |
| Stat label | 11px / 400 |
| Mono section label | 10px / 400, `letter-spacing 0.12em`, uppercase |
| Mono pill / timestamp | 11px / 400 |

**Spacing** — 2, 3, 6, 8, 10, 11, 14, 16, 20, 26px. Content gutter 16px; card padding 16px (15px on row cards); stack gap 14px.

**Radius** — 999px pills · 14px cards · 12px CTAs · 11px icon tiles and tabs · 10px inputs · 5px small check tiles · 16px viewfinder.

**Elevation** — none. The design is flat; separation comes from 1px borders. Do not add shadows.

## Assets

No image assets inside the UI (the launcher/app icon is the group's badge — see AGENTS.md "Build" for how it regenerates). All in-screen iconography is Unicode emoji (📬 📣 🗓️ 📇 🤖 🎲 ✨ 👇 🔒 🔗 ✋ 📝 🗣️ ⏳ ✅ 🏛️ 💰 🎁 🙋 🟢 ⬆️) plus text glyphs (`›` `✓` `◔`). Emoji are a deliberate part of the group's branding — keep them and render with the platform emoji font rather than substituting an icon set.

The prototype loads fonts from Google Fonts:
`https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap`

The app bundles the same faces instead (`@fontsource`, imported in `src/main.js`) — it is offline-first and its CSP allows no remote origins.

## Open Questions for the Coordinators

1. ~~Is QR/OCR scanning at the door real, or is batch paste enough?~~ Answered no for v1 — batch paste is enough, so screen 3 is deliberately skipped and stays unbuilt and unreachable (captain decision, 2026-08-18, `docs/adr/0005-coordinator-initiated-adds.md`).
2. ~~Should Luma import check for duplicates against the existing calendar?~~ Answered yes — v1 ships a best-effort check against the calendar's public page, and a hit reads as already-on-calendar rather than an error (`docs/adr/0004-credential-free-luma-handoff.md`).
3. What exactly may the Discord agent do unsupervised, and what always needs approval? The prototype assumes anything that emails members or spends money is gated.
4. How many coordinators need access, and does the contact book need per-person privacy or is shared fine?

## Files

- `Coordinator App.dc.html` — the full clickable prototype: all eight screens, tab switching, validation, agent handoffs.
- `ios-frame.jsx` — iPhone bezel used only to display the prototype on desktop. Not part of the design.
- `support.js` — prototype runtime. Not part of the design.

To view: open `Coordinator App.dc.html` in a browser and tap through. Start at Home → `Add to mailing list`.
