// Screen renders: Home (spec §1), Add to mailing list (§2), Message the list
// (§4), Add a community Luma event (§5), Save a contact (§6), Done (§8).

import { h, header, sectionLabel, cta, chipRow } from "./ui.js";
import {
  state,
  resetAdd,
  resetBroadcast,
  resetContact,
  resetLuma,
} from "./state.js";
import { isValidEmail, parseBatch, splitDraft } from "./parse.js";
import { eventDraft, validAttendance } from "./messages.js";
import {
  enqueue,
  importSignups,
  pendingAddresses,
  nextBatch,
  remainingToday,
  markDrained,
  DRAIN_LIMIT,
} from "./queue.js";
import {
  LIST_MAIL,
  handOffBroadcast,
  handOffJoinLink,
  openMembersPage,
  fetchEventPreview,
  fetchCalendarEvents,
  handOffLuma,
  loadCalendarCache,
  saveCalendarCache,
} from "./backend.js";
import {
  normalizeLumaUrl,
  formatWhen,
  formatWhenRange,
  findDuplicate,
  nextUpcoming,
  upcomingEvents,
  daysOutLabel,
} from "./luma.js";
import {
  saveContact,
  listContacts,
  importContacts,
  rowOf,
} from "./contacts.js";
import { addActivity, listActivity, dayLabel } from "./activity.js";
import { go, back, homeFromDone } from "./router.js";
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  checkOutcome,
  recordCheck,
  lastCheck,
} from "./updater.js";
import {
  readNewestBackup,
  pickBackup,
  mergeContacts,
  readNewestSignupBackup,
  pickSignupBackup,
  mergeSignups,
} from "./backup.js";

const SOURCES = ["At an event", "Discord", "Friend referral", "Website form"];

function shell(kicker, title, cancel, ...body) {
  return h(
    "div",
    { class: "screen" },
    header(kicker, title, cancel ? back : null),
    h("main", { class: "content" }, body),
  );
}

export function render(screen, opts) {
  if (screen === "add") resetAdd(); // spec "Field clearing"
  if (screen === "broadcast") resetBroadcast(); // state table: tpl → reminder
  if (screen === "contact") resetContact();
  if (screen === "luma") resetLuma();
  const build = SCREENS[screen] ?? SCREENS.home;
  document.getElementById("app").replaceChildren(build(opts));
}

/* ------------------------------ 1. Home ------------------------------ */

const ACTIONS = [
  {
    icon: "📬",
    cls: "action-mail",
    title: "Add to mailing list",
    sub: "Paste or type — batches too",
    screen: "add",
  },
  {
    icon: "📣",
    cls: "action-message",
    title: "Message the list",
    sub: "Announce or remind, from a template",
    screen: "broadcast",
  },
  {
    icon: "🗓️",
    cls: "action-luma",
    title: "Add a community Luma event",
    sub: "Paste a link → our calendar",
    screen: "luma",
  },
  {
    icon: "📇",
    cls: "action-contact",
    title: "Save a contact",
    sub: "Venue, sponsor, or vendor — not the list",
    screen: "contact",
  },
];

// Self-updater (docs/adr/0007): one anonymous GET of the project's GitHub
// Releases on Home entry, throttled, fire-and-forget. It must never block
// Home or surface an error — bad venue wifi just means no card this time.
// The offered update survives screen rebuilds until installed; only a
// strictly newer version is ever offered (src/updater.js's downgrade guard).
let updateOffer = null; // { version, url } once decideUpdate offers one
let updateChecking = false;
let lastUpdateCheckAt = 0;
let updateDownloaded = false; // APK is in the app cache dir
let updateSlot = null; // the currently rendered Home's card slot, if any
const UPDATE_CHECK_EVERY_MS = 5 * 60 * 1000;

function backgroundUpdateCheck() {
  if (updateOffer || updateChecking) return;
  if (Date.now() - lastUpdateCheckAt < UPDATE_CHECK_EVERY_MS) return;
  updateChecking = true;
  checkForUpdates(__APP_VERSION__)
    .then(({ offer, latest }) => {
      recordCheck(
        checkOutcome({ offer, latest, currentVersion: __APP_VERSION__ }),
      );
      if (!offer) return;
      updateOffer = offer;
      // Home may have been rebuilt, or left, while the check was in flight;
      // paint whichever slot is on screen now.
      if (updateSlot?.isConnected) {
        updateSlot.hidden = false;
        updateSlot.replaceChildren(updateCard());
      }
    })
    .catch((err) => {
      recordCheck(checkOutcome({ error: err }));
      console.warn(`[update] check failed: ${err?.message ?? err}`);
    })
    .finally(() => {
      updateChecking = false;
      lastUpdateCheckAt = Date.now();
    });
}

function updateCard() {
  return actionCard({
    icon: "⬆️",
    cls: "action-update",
    title: `Update ready — v${updateOffer.version}`,
    sub: "Download and install the new version",
    screen: "update",
  });
}

// Home's next event, live from the group's public Luma calendar — the same
// credential-free read Flow 3's dedupe uses (docs/adr/0004), one GET per
// Home entry. The card is tappable and opens the Events page with the full
// upcoming list (docs/adr/0008). States: cached last-known (marked) while
// the read is in flight or when it fails, loading when nothing is cached,
// offline/error, and empty. RSVP renders only when the public data carries
// it; the surface has no capacity number, so that tile is omitted rather
// than faked (the spec's 34/50 were prototype placeholders).
function nextEventCard() {
  const pill = h("span", { class: "pill" });
  pill.style.display = "none";
  const dyn = h("div", { class: "event-body" });

  function paintEvent(entry, note) {
    const label = daysOutLabel(entry.startAt, entry.timezone);
    pill.textContent = label ?? "";
    pill.style.display = label == null ? "none" : "";
    const lines = [
      entry.name,
      formatWhenRange(entry.startAt, entry.endAt, entry.timezone),
      entry.venue,
    ].filter(Boolean);
    const stats = [];
    if (entry.guestCount != null && !entry.hideRsvp)
      stats.push(stat(String(entry.guestCount), "RSVPs"));
    // No capacity tile: the public surface carries no capacity number.
    const members = memberCount();
    if (members) stats.push(stat(String(members), "On the list"));
    // replaceChildren stringifies null args into "null" text nodes — filter.
    dyn.replaceChildren(
      ...[
        lines.length
          ? h(
              "div",
              { class: "event-lines" },
              lines.map((t) => h("div", { class: "event-line" }, t)),
            )
          : null,
        stats.length ? h("div", { class: "stat-row" }, stats) : null,
        note ? h("div", { class: "event-note" }, note) : null,
      ].filter(Boolean),
    );
  }
  const paintNote = (text) => {
    pill.style.display = "none";
    dyn.replaceChildren(h("div", { class: "event-note" }, text));
  };
  const paintLoading = () => {
    pill.style.display = "none";
    dyn.replaceChildren(
      h(
        "div",
        { class: "event-note" },
        h("span", { class: "spinner" }),
        "Pulling next event…",
      ),
    );
  };

  const cache = loadCalendarCache();
  const cachedNext = nextUpcoming(cache?.events);
  if (cachedNext)
    paintEvent(cachedNext, `Last known — pulled ${agoLabel(cache?.ts)}`);
  else paintLoading();

  // Unreadable is not empty: a null parse (markup we no longer recognize)
  // takes the same path as a network failure, so the last-known event
  // survives instead of being replaced by a false "calendar is empty".
  const paintUnreadable = () => {
    if (cachedNext) {
      paintEvent(
        cachedNext,
        `Couldn't reach the calendar — pulled ${agoLabel(cache?.ts)}`,
      );
    } else {
      paintNote("Couldn't reach the calendar.");
    }
  };

  fetchCalendarEvents()
    .then((events) => {
      if (!events) {
        console.warn("[home] calendar page structure not recognized");
        paintUnreadable();
        return;
      }
      saveCalendarCache(events);
      const next = nextUpcoming(events);
      if (next) paintEvent(next, null);
      else paintNote("No upcoming events on the calendar.");
    })
    .catch((err) => {
      console.warn(`[home] calendar read failed: ${err?.message ?? err}`);
      paintUnreadable();
    });

  return h(
    "button",
    {
      class: "card event-card",
      type: "button",
      onclick: () => go("events"),
    },
    h(
      "div",
      { class: "event-title-row" },
      h("div", { class: "event-title" }, "🎲 Next event"),
      pill,
      h("span", { class: "action-chevron" }, "›"),
    ),
    dyn,
  );
}

// Cache-age marker for the last-known event: short, relative, honest.
function agoLabel(ts) {
  if (!Number.isFinite(ts)) return "earlier";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

function stat(value, label) {
  return h(
    "div",
    { class: "stat" },
    h("div", { class: "stat-value" }, value),
    h("div", { class: "stat-label" }, label),
  );
}

function actionCard(a) {
  return h(
    "button",
    {
      class: `action-card ${a.cls}`,
      type: "button",
      onclick: () => go(a.screen),
    },
    h("span", { class: "tile" }, a.icon),
    h(
      "span",
      { class: "action-text" },
      h("span", { class: "action-title" }, a.title),
      h("span", { class: "action-sub" }, a.sub),
    ),
    h("span", { class: "action-chevron" }, "›"),
  );
}

function recentCard() {
  const rows = listActivity();
  if (!rows.length) {
    return h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "empty" },
        "Nothing yet — adds you queue and messages you send show up here.",
      ),
    );
  }
  return h(
    "div",
    { class: "card rows-card" },
    rows.map((r) =>
      h(
        "div",
        { class: "recent-row" },
        h("div", { class: "recent-when" }, dayLabel(r.ts)),
        h("div", { class: "recent-what" }, r.what),
      ),
    ),
  );
}

// Queued at-door adds surface on Home so the coordinator can't lose them
// (ADR 0005) — one tap to the drain screen. Hidden when the queue is empty.
function queueCard() {
  const n = pendingAddresses().length;
  if (!n) return null;
  return h(
    "button",
    {
      class: "action-card action-mail",
      type: "button",
      onclick: () => go("drain"),
    },
    h("span", { class: "tile" }, "📥"),
    h(
      "span",
      { class: "action-text" },
      h(
        "span",
        { class: "action-title" },
        `${n} queued ${n === 1 ? "add" : "adds"} — finish them at home`,
      ),
      h(
        "span",
        { class: "action-sub" },
        "Paste them into Google Groups' own Add members",
      ),
    ),
    h("span", { class: "action-chevron" }, "›"),
  );
}

// The installed version — same source as the self-updater's current version
// (__APP_VERSION__, inlined from src-tauri/tauri.conf.json by Vite,
// docs/adr/0006), one version truth. Tapping it reveals the last update
// check's outcome (docs/adr/0009) — the fix for a silent check that could
// not be told apart from "no new release".
function versionFooter() {
  const readout = h("div", { class: "app-version-readout" });
  readout.hidden = true;
  const line = h(
    "button",
    {
      class: "app-version",
      type: "button",
      onclick: () => {
        const rec = lastCheck();
        readout.textContent = rec
          ? `Update check ${new Date(rec.at).toLocaleString()} — ${rec.outcome}`
          : "Update check — none finished yet";
        readout.hidden = !readout.hidden;
      },
    },
    `BGN Coordinator v${__APP_VERSION__}`,
  );
  return h("div", null, line, readout);
}

// Restore offer (docs/adr/0009): an empty book plus a backup on disk means
// this device was probably reinstalled or its data cleared. One prompt, and
// "Not now" stays quiet for the rest of the session.
let restoreDeclined = false;
// The lookup is a synchronous hop across the WebView bridge into a
// contentResolver query, and Home re-renders on every back-navigation —
// one look per session is enough, the file on disk does not change under us.
let restoreFound;

function restoreCard() {
  if (restoreDeclined || listContacts().length) return null;
  if (restoreFound === undefined) restoreFound = readNewestBackup();
  const found = restoreFound;
  if (!found) return null;
  // What a restore would actually add: the merge drops entries identical on
  // everything the coordinator typed, so the file's own length can promise
  // more than the book will hold. The book is empty here by the guard above.
  const contacts = mergeContacts([], found.contacts);
  const n = contacts.length;
  return h(
    "div",
    { class: "card" },
    h("div", { class: "card-title" }, "Restore your contacts? 📇"),
    h(
      "div",
      { class: "card-body" },
      `The contact book is empty, but a backup on this device holds ${n} ${
        n === 1 ? "contact" : "contacts"
      } (${found.name}). Nothing was sent anywhere — this is the device's own copy.`,
    ),
    h(
      "button",
      {
        class: "cta",
        type: "button",
        onclick: () => {
          importContacts(contacts);
          restoreDeclined = true;
          render("home");
        },
      },
      `Restore ${n} ${n === 1 ? "contact" : "contacts"}`,
    ),
    h(
      "button",
      {
        class: "btn-secondary",
        type: "button",
        onclick: () => {
          restoreDeclined = true;
          render("home");
        },
      },
      "Not now",
    ),
  );
}

function signupRestoreScreen() {
  const preview = h("div", { class: "stack" });
  function offer(found) {
    if (!found) {
      preview.replaceChildren(
        h(
          "div",
          { class: "empty" },
          "No readable signup backup found. Choose a file from Downloads/BGN Coordinator after a reinstall.",
        ),
      );
      return;
    }
    const current = pendingAddresses().map((email) => ({ kind: "one", email }));
    const merged = mergeSignups(current, found.queue);
    const n =
      merged.flatMap((it) => (it.kind === "batch" ? it.emails : [it.email]))
        .length - current.length;
    preview.replaceChildren(
      h(
        "div",
        { class: "card-body" },
        `${found.name}: ${n} new pending ${n === 1 ? "signup" : "signups"}. An older file may include already-completed signups. Check this file before restoring. Current pending entries are kept; contacts are not changed.`,
      ),
      h(
        "pre",
        { class: "card-body" },
        found.queue
          .flatMap((it) => (it.kind === "batch" ? it.emails : [it.email]))
          .join("\n"),
      ),
      n
        ? h(
            "button",
            {
              class: "cta",
              type: "button",
              onclick: () => {
                try {
                  const added = importSignups(found.queue);
                  preview.replaceChildren(
                    h(
                      "div",
                      { class: "card-body" },
                      `Restored ${added} pending ${added === 1 ? "signup" : "signups"}. Review the queue before adding anyone in Google Groups.`,
                    ),
                  );
                } catch (err) {
                  preview.append(
                    h(
                      "div",
                      { class: "error" },
                      `Could not restore: ${err.message}`,
                    ),
                  );
                }
              },
            },
            `Restore ${n} pending ${n === 1 ? "signup" : "signups"}`,
          )
        : h(
            "div",
            { class: "empty" },
            "No new pending signups in this snapshot.",
          ),
    );
  }
  offer(readNewestSignupBackup());
  return shell(
    "On-device backups",
    "Recover pending signups",
    true,
    h(
      "div",
      { class: "card-body" },
      "Backups stay in Downloads/BGN Coordinator on this device. Nothing is restored automatically. Files can contain addresses already completed since the backup.",
    ),
    preview,
    h(
      "button",
      {
        class: "btn-secondary",
        type: "button",
        onclick: async () => {
          const queue = await pickSignupBackup();
          offer(queue ? { name: "Selected backup file", queue } : null);
        },
      },
      "Choose a signup backup file",
    ),
  );
}

function homeScreen() {
  updateSlot = h("div");
  if (updateOffer) updateSlot.append(updateCard());
  else updateSlot.hidden = true;
  backgroundUpdateCheck();
  return shell(
    "Wednesday crew",
    "Home",
    false,
    updateSlot,
    restoreCard(),
    nextEventCard(),
    queueCard(),
    h(
      "button",
      { class: "link-btn", type: "button", onclick: () => go("signupRestore") },
      "Recover pending signups",
    ),
    sectionLabel("👇 Do a thing"),
    ACTIONS.map(actionCard),
    sectionLabel("✨ Recent activity"),
    recentCard(),
    versionFooter(),
  );
}

/* ----------------------------- 1b. Events page ---------------------------- */
// The full upcoming list behind Home's next-event card (docs/adr/0008 —
// captain decision: a separate scrollable page, not expand-in-place). Same
// credential-free read and device cache as the card: the cached list
// renders instantly, one fresh read runs on entry, and the empty/stale/
// unreadable states are as honest as the card's.

function eventCard(e) {
  const label = daysOutLabel(e.startAt, e.timezone);
  const lines = [
    formatWhenRange(e.startAt, e.endAt, e.timezone),
    e.venue,
    // Same RSVP rule as the Home card: render the count only when the
    // public surface carries it and the event doesn't hide it.
    e.guestCount != null && !e.hideRsvp
      ? `${e.guestCount} ${e.guestCount === 1 ? "RSVP" : "RSVPs"}`
      : null,
  ].filter(Boolean);
  return h(
    "div",
    { class: "card" },
    h(
      "div",
      { class: "event-title-row" },
      h("div", { class: "event-title" }, e.name || "Untitled event"),
      label == null ? null : h("span", { class: "pill" }, label),
    ),
    lines.length
      ? h(
          "div",
          { class: "event-lines" },
          lines.map((t) => h("div", { class: "event-line" }, t)),
        )
      : null,
  );
}

function eventsScreen() {
  const note = h("div", { class: "event-note" });
  note.style.display = "none"; // .event-note sets display — the hidden attr loses
  const list = h("div", { class: "stack" });

  const cache = loadCalendarCache();
  const cached = upcomingEvents(cache?.events);

  const paintList = (events) => list.replaceChildren(...events.map(eventCard));
  const paintMessage = (text) =>
    list.replaceChildren(
      h("div", { class: "card" }, h("div", { class: "empty" }, text)),
    );
  const paintLoading = () =>
    list.replaceChildren(
      h(
        "div",
        { class: "card" },
        h(
          "div",
          { class: "event-note" },
          h("span", { class: "spinner" }),
          "Pulling events…",
        ),
      ),
    );
  const showNote = (text) => {
    note.textContent = text;
    note.style.display = "";
  };
  const hideNote = () => {
    note.style.display = "none";
  };

  if (cached.length) {
    paintList(cached);
    showNote(`Last known — pulled ${agoLabel(cache?.ts)}`);
  } else paintLoading();

  // Same unreadable-is-not-empty rule as the Home card: a null parse takes
  // the network-failure path, so the cached list survives, marked stale.
  const paintUnreadable = () => {
    if (cached.length) {
      paintList(cached);
      showNote(`Couldn't reach the calendar — pulled ${agoLabel(cache?.ts)}`);
    } else {
      hideNote();
      paintMessage("Couldn't reach the calendar.");
    }
  };

  fetchCalendarEvents()
    .then((events) => {
      if (!events) {
        console.warn("[events] calendar page structure not recognized");
        paintUnreadable();
        return;
      }
      saveCalendarCache(events);
      const live = upcomingEvents(events);
      hideNote();
      if (live.length) paintList(live);
      else paintMessage("No upcoming events on the calendar.");
    })
    .catch((err) => {
      console.warn(`[events] calendar read failed: ${err?.message ?? err}`);
      paintUnreadable();
    });

  return shell("Community calendar", "Upcoming events", true, note, list);
}

/* ------------------------- 2. Add to mailing list ------------------------- */

function fieldGroup(
  labelText,
  control,
  { optional = false, chips = false } = {},
) {
  const label = optional
    ? h(
        "div",
        { class: "field-label" },
        `${labelText} `,
        h("span", { class: "opt" }, "optional"),
      )
    : h("div", { class: "field-label" }, labelText);
  if (control.matches?.("input, textarea, select"))
    control.setAttribute("aria-label", labelText);
  return h(
    "div",
    { class: chips ? "field field-chips" : "field" },
    label,
    control,
  );
}

// Capture at the door (ADR 0005): submit just queues the address on this
// device — optimistic confirm, zero member action, no network. The
// coordinator drains the queue in Google Groups' own UI from home.
function submitOne() {
  const email = state.email.trim();
  const name = state.name.trim();
  enqueue({
    kind: "one",
    email,
    name: name || undefined,
    source: state.source,
  });
  addActivity(`Queued ${name || email} for the list`);
  go("done", { done: { kind: "one", who: name || email } });
}

function submitBatch() {
  const emails = parseBatch(state.batch);
  if (!emails.length) return;
  enqueue({ kind: "batch", emails });
  addActivity(`Queued ${emails.length} people for the list`);
  go("done", { done: { kind: "batch", n: emails.length } });
}

// Demoted fallback (ADR 0005): when the member at the door can self-serve,
// share the join link instead of queueing — the coordinator's own apps hand
// it over, same as before the pivot.
async function shareJoinLink() {
  try {
    await handOffJoinLink(state.email.trim());
  } catch (err) {
    // Cancelled share, or no share target and no valid email: the queue
    // path is primary, so a failed fallback only logs.
    console.warn(`[add] join-link handoff failed: ${err?.message ?? err}`);
  }
}

function oneMode() {
  const submit = cta(
    () => (isValidEmail(state.email) ? "Add to the list" : "Enter an email"),
    () => isValidEmail(state.email),
    submitOne,
  );
  // The fallback needs an address too (no Web Share API in the Android
  // WebView), so it carries the same gate and instruction-label idiom.
  const share = cta(
    () =>
      isValidEmail(state.email)
        ? "Or send them the self-serve join link"
        : "Enter an email to share the join link",
    () => isValidEmail(state.email),
    shareJoinLink,
  );
  share.btn.className = "link-btn";
  const emailInput = h("input", {
    class: "input",
    inputmode: "email",
    autocomplete: "off",
    placeholder: "name@example.com",
    value: state.email,
    oninput: (e) => {
      state.email = e.target.value;
      submit.update();
      share.update();
    },
  });
  const nameInput = h("input", {
    class: "input",
    autocomplete: "off",
    placeholder: "Alex Rivera",
    value: state.name,
    oninput: (e) => {
      state.name = e.target.value;
    },
  });
  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "card field-card" },
      fieldGroup("Email", emailInput),
      fieldGroup("Name", nameInput, { optional: true }),
      fieldGroup(
        "Met them at",
        chipRow(
          SOURCES,
          (o) => o === state.source,
          (o) => {
            state.source = o;
          },
        ),
        { chips: true },
      ),
    ),
    h(
      "div",
      { class: "explain" },
      h("div", { class: "explain-glyph" }, "◔"),
      h(
        "div",
        { class: "explain-body" },
        "Queues them on this device; you finish the add in ",
        h("span", { class: "explain-addr" }, "bgn-wg"),
        "'s Google Groups page from home — they do nothing at the door.",
      ),
    ),
    submit.btn,
    share.btn,
  );
}

// Local roster stub for the dupe check (captain decision, 2026-08-15).
// ponytail: empty until the CSV-import roster sync lands ("Sync from Google
// Group" → Members → Export list); then load it in place of this constant.
const ROSTER = [];

const BATCH_LABEL = "Paste emails — commas, spaces, or one per line";

function batchMode() {
  const emails = () => parseBatch(state.batch);
  const submit = cta(
    () =>
      emails().length
        ? `Queue ${emails().length} for the list`
        : "Paste some emails",
    () => emails().length > 0,
    submitBatch,
  );
  const countLeft = h("div", { class: "batch-count" });
  const countRight = h("div", { class: "batch-dupes" });
  function refresh() {
    const list = emails();
    const dupes = list.filter((e) => ROSTER.includes(e)).length;
    countLeft.textContent = list.length
      ? `${list.length} valid addresses`
      : "Nothing pasted yet";
    countRight.textContent = dupes ? `${dupes} already on the list` : "";
    submit.update();
  }
  const area = h("textarea", {
    class: "input batch-area",
    "aria-label": BATCH_LABEL,
    placeholder: "jo@site.com, sam@site.com\nkim@site.com",
    value: state.batch,
    oninput: (e) => {
      state.batch = e.target.value;
      refresh();
    },
  });
  refresh();
  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "card field-card" },
      h("div", { class: "field-label" }, BATCH_LABEL),
      area,
      h("div", { class: "batch-counts" }, countLeft, countRight),
    ),
    submit.btn,
  );
}

function addScreen() {
  const body = h("div", { class: "stack" });
  const tabOne = h(
    "button",
    { class: "tab", type: "button", onclick: () => setMode("one") },
    "One person",
  );
  const tabBatch = h(
    "button",
    { class: "tab", type: "button", onclick: () => setMode("batch") },
    "Paste a batch",
  );
  function setMode(mode) {
    state.mode = mode;
    tabOne.classList.toggle("tab-on", mode === "one");
    tabBatch.classList.toggle("tab-on", mode === "batch");
    body.replaceChildren(mode === "one" ? oneMode() : batchMode());
  }
  setMode(state.mode);
  return shell(
    "Mailing list",
    "Add members",
    true,
    h("div", { class: "tabs" }, tabOne, tabBatch),
    body,
  );
}

/* ------------------- 2b. Drain: finish the adds at Google -------------------
 * Coordinator-facing (ADR 0005): queued addresses become a copy-ready paste
 * block for Google Groups' owner "Add members" direct-add box, capped
 * defensively at ~100/day, plus a second block for addresses the coordinator
 * flags for the invite box. The app copies text and opens a deep link — the
 * coordinator acting in Google's signed-in UI is the only write path. */

function drainScreen() {
  const flagged = new Set(); // indexes into the presented batch → invite box
  const dyn = h("div", { class: "stack" });
  const notice = h("div", { class: "confirm-notice" });

  function copyBlock(text, btn, label) {
    const flash = (msg, ms) => {
      btn.textContent = msg;
      setTimeout(() => {
        btn.textContent = label;
      }, ms);
    };
    if (!navigator.clipboard?.writeText) {
      flash("Copy failed — select the text manually", 2400);
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => flash("Copied ✓", 1600))
      .catch((err) => {
        console.warn(`[drain] clipboard copy failed: ${err?.message ?? err}`);
        flash("Copy failed — select the text manually", 2400);
      });
  }

  function pasteCard(title, hint, addresses) {
    const label = `Copy ${addresses.length} ${addresses.length === 1 ? "address" : "addresses"}`;
    const area = h("textarea", {
      class: "input batch-area drain-paste",
      readonly: "readonly",
      "aria-label": title,
      value: addresses.join("\n"),
    });
    return h(
      "div",
      { class: "card" },
      h("div", { class: "card-title" }, title),
      h("div", { class: "drain-hint" }, hint),
      area,
      h(
        "button",
        {
          class: "btn-secondary",
          type: "button",
          onclick: (e) => copyBlock(area.value, e.currentTarget, label),
        },
        label,
      ),
    );
  }

  async function openGoogle() {
    try {
      await openMembersPage();
    } catch (err) {
      console.warn(
        `[drain] couldn't open Google Groups: ${err?.message ?? err}`,
      );
      notice.textContent = "Couldn't open the browser. Try again.";
    }
  }

  function repaint() {
    notice.textContent = "";
    const pending = pendingAddresses();
    if (!pending.length) {
      dyn.replaceChildren(
        h(
          "div",
          { class: "card" },
          h(
            "div",
            { class: "empty" },
            "Nothing queued. Adds you capture at the door wait here — finish them in Google Groups' Add members when you're home.",
          ),
        ),
      );
      return;
    }
    const left = remainingToday();
    if (!left) {
      dyn.replaceChildren(
        h(
          "div",
          { class: "card" },
          h("div", { class: "card-title" }, "Today's budget is used up"),
          h(
            "div",
            { class: "card-body" },
            `${DRAIN_LIMIT} adds marked drained today — Google throttles owner adds (community-reported ~${DRAIN_LIMIT}/day, 24h+ to recover). ${pending.length} stay queued for tomorrow.`,
          ),
        ),
      );
      return;
    }
    const batch = nextBatch();
    const more = pending.length - batch.length;
    const direct = batch.filter((_, i) => !flagged.has(i));
    const invites = batch.filter((_, i) => flagged.has(i));

    // Tap an address's chip to move it between the direct-add and invite
    // blocks — the app can't tell which path an address needs, so it never
    // guesses on its own (ADR 0005).
    const rows = batch.map((email, i) =>
      h(
        "div",
        { class: "drain-row" },
        h("div", { class: "drain-addr" }, email),
        h(
          "button",
          {
            class: flagged.has(i)
              ? "chip chip-on drain-flag"
              : "chip drain-flag",
            type: "button",
            onclick: () => {
              if (flagged.has(i)) flagged.delete(i);
              else flagged.add(i);
              repaint();
            },
          },
          flagged.has(i) ? "Invite" : "Direct",
        ),
      ),
    );

    const mark = cta(
      () => "Mark batch drained ✓",
      () => true,
      () => setConfirming(true),
    );

    // Clearing pending entries is deliberate; older backups may still hold
    // them, but recovery must not automatically resurrect completed signups.
    const confirmBlock = h(
      "div",
      { class: "stack" },
      h(
        "div",
        { class: "card" },
        h("div", { class: "card-title" }, "Clear this batch from the queue?"),
        h(
          "div",
          { class: "card-body" },
          `This drops ${batch.length} queued ${batch.length === 1 ? "address" : "addresses"} from this device for good. Only do it once you've submitted them in Google Groups' own Add members box.`,
        ),
      ),
      h(
        "button",
        {
          class: "cta",
          type: "button",
          onclick: () => {
            markDrained(batch);
            flagged.clear();
            addActivity(
              `Drained ${batch.length} ${batch.length === 1 ? "add" : "adds"} in Google Groups`,
            );
            repaint();
          },
        },
        "Yes — they're in Google Groups",
      ),
      h(
        "button",
        {
          class: "btn-secondary",
          type: "button",
          onclick: () => setConfirming(false),
        },
        "Keep them queued",
      ),
    );

    const tail = h("div", { class: "stack" }, mark.btn);
    function setConfirming(on) {
      tail.replaceChildren(on ? confirmBlock : mark.btn);
    }

    // replaceChildren would stringify a null child, so drop the invite card
    // slot when nothing is flagged.
    dyn.replaceChildren(
      ...[
        h(
          "div",
          { class: "explain" },
          h("div", { class: "explain-glyph" }, "◔"),
          h(
            "div",
            { class: "explain-body" },
            "Copy the direct-add block into Google Groups' Add members box and submit it there. If Google rejects an address it usually has no Google account — tap its chip to move it to the invite block.",
          ),
        ),
        h(
          "div",
          { class: "card rows-card" },
          h(
            "div",
            { class: "drain-rows-title" },
            `This batch · ${batch.length} ${batch.length === 1 ? "address" : "addresses"}`,
          ),
          rows,
        ),
        direct.length
          ? pasteCard(
              "Direct add — copy this block",
              "Google Groups → Members → Add members → the direct-add box.",
              direct,
            )
          : null,
        invites.length
          ? pasteCard(
              "Invite — copy this block",
              "Paste these into the invite box instead — Google can't direct-add them.",
              invites,
            )
          : null,
        h(
          "button",
          { class: "btn-secondary", type: "button", onclick: openGoogle },
          "Open the members page at Google Groups",
        ),
        h(
          "div",
          { class: "drain-note" },
          `${left} of ~${DRAIN_LIMIT} adds left today${more ? ` · ${more} more queued for the next batch` : ""}`,
        ),
        notice,
        tail,
      ].filter((n) => n != null),
    );
  }

  repaint();
  return shell("Mailing list", "Finish the adds", true, dyn);
}

/* ------------------------------- 2c. Update -------------------------------
 * Self-updater (docs/adr/0007): download the signed arm64 APK from the
 * project's GitHub Releases, then hand it to Android's installer. The
 * installer's own signature check is the integrity story; the first install
 * also triggers Android's install-unknown-apps prompt. */

const mb = (n) => (n / 1048576).toFixed(1);

function updateScreen() {
  // Defensive only — the screen is reachable just while an offer is live
  // (a reload drops the offer, and with it this screen's usefulness).
  if (!updateOffer) {
    return shell(
      "App update",
      "Up to date",
      true,
      h(
        "div",
        { class: "card" },
        h(
          "div",
          { class: "empty" },
          "No update is waiting. Home checks for new versions on its own.",
        ),
      ),
    );
  }
  const offer = updateOffer;
  // The APK from an earlier visit is still in the app cache dir, so re-entry
  // goes straight to Install now rather than re-downloading over venue wifi.
  let phase = updateDownloaded ? "prompted" : "idle"; // idle | downloading | prompted
  let handedOff = false;
  let progress = "";
  const notice = h("div", { class: "confirm-notice" });
  const dyn = h("div", { class: "stack" });
  const progressText = h("span");
  const downloadingLabel = () =>
    progress ? `Downloading… ${progress}` : "Downloading…";

  const submit = cta(
    () => {
      if (phase === "downloading") return downloadingLabel();
      if (phase === "prompted") return "Install now";
      return `Download v${offer.version} and install`;
    },
    () => phase !== "downloading",
    () => (phase === "prompted" ? tryInstall() : downloadAndInstall()),
  );

  function repaint() {
    const kids = [];
    if (phase === "downloading") {
      progressText.textContent = downloadingLabel();
      kids.push(
        h(
          "div",
          { class: "card luma-note" },
          h("span", { class: "spinner" }),
          progressText,
        ),
      );
    } else if (phase === "prompted") {
      kids.push(
        h(
          "div",
          { class: "explain" },
          h("div", { class: "explain-glyph" }, "◔"),
          h(
            "div",
            { class: "explain-body" },
            handedOff
              ? "Android's installer should have opened. The first time, it asks to allow installs from this app — allow it, come back, and tap Install now again if nothing opened."
              : "This update is already downloaded. Tap Install now to hand it to Android's installer — the first time, it asks to allow installs from this app, so allow it and tap again if nothing opened.",
          ),
        ),
      );
    }
    dyn.replaceChildren(...kids);
    submit.update();
  }

  async function downloadAndInstall() {
    phase = "downloading";
    progress = "";
    notice.textContent = "";
    repaint();
    try {
      await downloadUpdate(offer, (received, total) => {
        progress = total
          ? `${mb(received)} of ${mb(total)} MB`
          : `${mb(received)} MB`;
        progressText.textContent = downloadingLabel();
        submit.update();
      });
      updateDownloaded = true;
    } catch (err) {
      console.warn(`[update] download failed: ${err?.message ?? err}`);
      phase = "idle";
      notice.textContent =
        "Couldn't download the update. Check the connection and try again.";
      repaint();
      return;
    }
    // Left the screen mid-download: the APK stays cached for a later tap
    // rather than throwing the installer over whatever is on screen now.
    if (!submit.btn.isConnected) return;
    tryInstall();
  }

  function tryInstall() {
    try {
      installUpdate();
      phase = "prompted";
      handedOff = true;
      notice.textContent = "";
    } catch (err) {
      console.warn(`[update] install handoff failed: ${err?.message ?? err}`);
      notice.textContent = `Couldn't start the installer${err?.message ? ` (${err.message})` : ""}.`;
      // The handoff is the only proof the cached APK is still there (Android
      // evicts the cache dir freely), so a failure retires it: fall back to
      // the download rather than offering an install of a file that is gone.
      updateDownloaded = false;
      phase = "idle";
    }
    repaint();
  }

  repaint();

  return shell(
    "App update",
    "Update the app",
    true,
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "card-title" },
        `v${__APP_VERSION__} → v${offer.version}`,
      ),
      h(
        "div",
        { class: "card-body" },
        "Straight from the project's GitHub releases. Android checks the app's signature before it installs, so only updates signed with the same key can replace it.",
      ),
    ),
    dyn,
    submit.btn,
    notice,
    h(
      "button",
      { class: "btn-secondary", type: "button", onclick: back },
      "Later",
    ),
  );
}

/* --------------------------- 4. Message the list --------------------------- */

const TEMPLATES = [
  {
    id: "reminder",
    title: "Event reminder",
    desc: "Two days out — time, place, what to bring",
  },
  {
    id: "announce",
    title: "New event announced",
    desc: "Date, venue, RSVP link",
  },
  {
    id: "recap",
    title: "Post-night recap",
    desc: "Games played, photos, next date",
  },
];

// There is no live member count: consumer googlegroups.com groups have no
// membership API (docs/adr/0002-self-serve-join-link.md). The batch dupe
// check's local roster is the only count available — an empty stub until the
// CSV roster sync lands (see ROSTER below), so until then the CTA and kicker
// use count-less copy instead of hardcoding a fake-live number.
const memberCount = () => ROSTER.length || null;

function broadcastScreen() {
  const count = memberCount();
  const reach = count ? `${count} members` : "the list";

  const cache = loadCalendarCache();
  const events = Array.isArray(cache?.events) ? cache.events : [];
  const selection = h(
    "select",
    {
      "aria-label": "Event",
      onchange: () => {
        attendance.value = "";
        regenerate();
      },
    },
    h("option", { value: "" }, "No event — write a custom draft"),
    events.map((e, i) =>
      h("option", { value: String(i) }, e.name || e.url || "Untitled event"),
    ),
  );
  const attendance = h("input", {
    type: "number",
    min: "0",
    step: "1",
    "aria-label": "Actual attendance",
    placeholder: "Enter actual attendance",
    oninput: () => {
      if (state.tpl === "recap") regenerate();
    },
  });
  const attendanceRow = h(
    "label",
    { class: "stack" },
    "Actual attendance (not RSVPs)",
    attendance,
  );
  const ready = () =>
    area.value.trim().length > 0 &&
    (state.tpl !== "recap" || validAttendance(attendance.value));
  function regenerate() {
    area.value = eventDraft(
      state.tpl,
      events[selection.value],
      attendance.value,
    );
    setConfirming(false);
    grow();
    refresh();
  }

  const area = h("textarea", {
    class: "preview-area",
    "aria-label": "Preview",
    value: "",
    oninput: () => {
      grow();
      submit.update();
    },
  });
  function grow() {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }

  const submit = cta(
    () =>
      !area.value.trim()
        ? "Write something first"
        : count
          ? `Review draft for ${count} members`
          : "Review mail draft",
    ready,
    () => setConfirming(true),
  );

  // Lightweight confirm before a whole-list send (spec production note).
  const sendBtn = h(
    "button",
    { class: "cta", type: "button", onclick: sendBroadcast },
    "Open in my mail app",
  );
  const confirmBlock = h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "card" },
      h("div", { class: "card-title" }, "Open this draft?"),
      h(
        "div",
        { class: "card-body" },
        `It opens in your mail app, addressed to ${LIST_MAIL}. Nothing sends until you send it there.`,
      ),
      h("div", { class: "confirm-notice" }),
    ),
    sendBtn,
    h(
      "button",
      {
        class: "btn-secondary",
        type: "button",
        onclick: () => setConfirming(false),
      },
      "Keep editing",
    ),
  );

  async function sendBroadcast() {
    if (sendBtn.disabled) return;
    // The preview stays editable behind the confirm block, so re-check the
    // same emptiness guard the CTA enforces.
    if (!ready()) {
      setConfirming(false);
      return;
    }
    sendBtn.disabled = true;
    try {
      await handOffBroadcast(splitDraft(area.value));
    } catch (err) {
      console.warn(`[broadcast] mail handoff failed: ${err?.message ?? err}`);
      confirmBlock.querySelector(".confirm-notice").textContent =
        "Couldn't open your mail app. Try again.";
      sendBtn.disabled = false;
      return;
    }
    addActivity(`Opened mail draft for ${reach}`);
    go("done", { done: { kind: "message", reach } });
  }

  // CTA normally; the confirm block replaces it once tapped.
  const tail = h("div", { class: "stack" }, submit.btn);
  function setConfirming(on) {
    tail.replaceChildren(on ? confirmBlock : submit.btn);
  }

  const tplButtons = TEMPLATES.map((t) =>
    h(
      "button",
      {
        class: "tpl-card",
        type: "button",
        onclick: () => {
          state.tpl = t.id;
          regenerate();
        },
      },
      h("div", { class: "tpl-title" }, t.title),
      h("div", { class: "tpl-desc" }, t.desc),
    ),
  );
  function refresh() {
    attendanceRow.hidden = state.tpl !== "recap";
    // Author-level .stack display overrides the browser's default [hidden].
    attendanceRow.style.display = attendanceRow.hidden ? "none" : "";
    attendance.disabled = attendanceRow.hidden;
    tplButtons.forEach((b, i) =>
      b.classList.toggle("tpl-on", TEMPLATES[i].id === state.tpl),
    );
    submit.update();
  }
  refresh();
  // The screen tree is built detached, so scrollHeight is only meaningful once
  // it is in the document — size the initial template copy on the next frame.
  requestAnimationFrame(grow);

  return shell(
    count ? `${count} members` : "Mailing list",
    "Message the list",
    true,
    sectionLabel("Start from"),
    tplButtons,
    h(
      "label",
      { class: "stack" },
      "Event (last-known calendar — verify details)",
      selection,
    ),
    h(
      "div",
      { class: "card-body" },
      "Open Events from Home to refresh the calendar. Missing facts are omitted; you can write your own draft.",
    ),
    attendanceRow,
    h(
      "div",
      { class: "card preview-card" },
      h("div", { class: "field-label" }, "Preview"),
      area,
    ),
    tail,
  );
}

/* ---------------------- 5. Add a community Luma event ---------------------- */
// Credential-free v1 (docs/adr/0004-credential-free-luma-handoff.md):
// read-only GETs of public pages for preview + best-effort dedupe; the add
// itself is a handoff into Luma's own Add Event panel — the app never writes.

// Every field degrades on its own, so an event page can arrive without a
// usable name — one fallback for every place the title reaches the screen,
// the activity log, or the Done copy.
const lumaTitle = (p) => p?.title || "The event";

const LUMA_ERROR = {
  offline: "You're offline — pulling a preview needs a connection.",
  // A calendar or user page reads fine and even serves an og:title, so say
  // what's actually wrong instead of blaming the connection.
  notEvent: "That link isn't a Luma event page — paste an event link.",
  generic:
    "Couldn't pull a preview — check the link. Private events can't be added to a community calendar.",
};

function lumaPreviewCard(p) {
  const meta = [formatWhen(p.startAt, p.timezone), p.venue]
    .filter(Boolean)
    .join(" · ");
  return h(
    "div",
    { class: "card" },
    sectionLabel("Pulled from Luma"),
    h("div", { class: "luma-title" }, lumaTitle(p)),
    meta ? h("div", { class: "luma-meta" }, meta) : null,
    p.tags.length
      ? h(
          "div",
          { class: "luma-tags" },
          p.tags.map((t, i) =>
            h(
              "span",
              { class: i === 0 ? "tag-pill tag-pill-accent" : "tag-pill" },
              t,
            ),
          ),
        )
      : null,
  );
}

function lumaScreen() {
  let seq = 0; // stale-fetch guard: the last scheduleCheck wins
  let timer = null;
  let phase = "idle"; // idle | loading | error | ready
  let dedupe = "idle"; // idle | checking | miss | hit | unreadable
  let errorKind = null; // offline | notEvent | generic
  let preview = null;
  let fetched = null; // { url, preview, dedupe } — one-URL cache, no refetch

  const dyn = h("div", { class: "stack" });
  const notice = h("div", { class: "confirm-notice" });

  const submit = cta(
    () => {
      if (phase === "loading") return "Pulling preview…";
      if (phase === "error") return "No preview to add";
      if (phase === "ready") {
        if (dedupe === "hit") return "Already on our calendar";
        return "Add to our calendar";
      }
      return "Paste a Luma link";
    },
    () => phase === "ready" && (dedupe === "miss" || dedupe === "unreadable"),
    submitLuma,
  );

  function repaint() {
    const kids = [];
    if (phase === "loading") {
      kids.push(
        h(
          "div",
          { class: "card luma-note" },
          h("span", { class: "spinner" }),
          "Pulling preview…",
        ),
      );
    } else if (phase === "error") {
      kids.push(
        h(
          "div",
          { class: "card luma-note luma-error" },
          LUMA_ERROR[errorKind] ?? LUMA_ERROR.generic,
        ),
      );
    } else if (phase === "ready" && preview) {
      kids.push(lumaPreviewCard(preview));
      if (dedupe === "hit") {
        kids.push(
          h(
            "div",
            { class: "luma-already" },
            h("div", { class: "luma-already-badge" }, "✓"),
            h(
              "div",
              { class: "luma-already-copy" },
              h(
                "div",
                { class: "luma-already-title" },
                "Already on our calendar",
              ),
              h(
                "div",
                { class: "luma-already-sub" },
                `${lumaTitle(preview)} is listed with the upcoming events.`,
              ),
            ),
          ),
        );
      } else if (dedupe === "unreadable") {
        kids.push(
          h(
            "div",
            { class: "luma-check-note" },
            "Couldn't check our calendar — you can still add it there.",
          ),
        );
      }
    }
    dyn.replaceChildren(...kids);
    submit.update();
  }

  async function run(url) {
    const my = seq;
    dedupe = "checking";
    repaint();
    const [pRes, cRes] = await Promise.allSettled([
      fetchEventPreview(url),
      fetchCalendarEvents(),
    ]);
    if (my !== seq) return; // a newer input superseded this fetch
    if (pRes.status === "rejected" || !pRes.value.isEvent) {
      // network failure, or a readable page that simply isn't an event
      errorKind =
        pRes.status === "rejected"
          ? navigator.onLine
            ? "generic"
            : "offline"
          : "notEvent";
      phase = "error";
      repaint();
      return;
    }
    preview = pRes.value;
    if (!preview.url) preview.url = url;
    if (cRes.status === "fulfilled" && cRes.value) {
      dedupe = findDuplicate(preview, cRes.value) ? "hit" : "miss";
    } else {
      dedupe = "unreadable"; // best-effort: say so and never block the add
    }
    phase = "ready";
    fetched = { url, preview, dedupe };
    repaint();
  }

  function scheduleCheck() {
    seq++;
    clearTimeout(timer);
    errorKind = null;
    notice.textContent = "";
    const url = normalizeLumaUrl(state.luma);
    if (!url) {
      phase = "idle";
      preview = null;
      dedupe = "idle";
      repaint();
      return;
    }
    if (fetched?.url === url) {
      // Same link as before (edit-and-retype): reuse the settled result.
      preview = fetched.preview;
      dedupe = fetched.dedupe;
      phase = "ready";
      repaint();
      return;
    }
    phase = "loading";
    preview = null;
    dedupe = "idle";
    repaint();
    timer = setTimeout(() => run(url), 500); // one fetch per pasted link
  }

  async function submitLuma() {
    if (!preview) return;
    submit.btn.disabled = true;
    submit.btn.textContent = "Opening Luma…";
    try {
      await handOffLuma(preview);
    } catch (err) {
      console.warn(`[luma] handoff failed: ${err?.message ?? err}`);
      notice.textContent = "Couldn't open Luma. Try again.";
      submit.update();
      return;
    }
    addActivity(`Added "${lumaTitle(preview)}" to the calendar`);
    go("done", { done: { kind: "luma", title: lumaTitle(preview) } });
  }

  return shell(
    "Community calendar",
    "Add Luma event",
    true,
    h(
      "div",
      { class: "card field-card" },
      fieldGroup(
        "Luma link",
        h("input", {
          class: "input input-mono",
          autocomplete: "off",
          autocapitalize: "off",
          spellcheck: "false",
          placeholder: "lu.ma/…",
          value: state.luma,
          oninput: (e) => {
            state.luma = e.target.value;
            scheduleCheck();
          },
        }),
      ),
    ),
    dyn,
    submit.btn,
    notice,
  );
}

/* ---------------------------- 6. Save a contact ---------------------------- */

const CTAGS = ["🏛️ Venue", "💰 Sponsor", "🎁 Vendor", "🙋 Volunteer"];

function submitContact() {
  const name = state.cName.trim();
  if (!name) return;
  saveContact({
    name,
    email: state.cEmail.trim(),
    phone: state.cPhone.trim(),
    notes: state.cNotes.trim(),
    tag: state.cTag,
  });
  go("done", { done: { kind: "contact", who: name } });
}

function savedCard() {
  const rows = listContacts();
  if (!rows.length) {
    return h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "empty" },
        "Nothing yet — contacts you save show up here.",
      ),
    );
  }
  return h(
    "div",
    { class: "card rows-card" },
    rows.map((c) => {
      const r = rowOf(c);
      return h(
        "div",
        { class: "contact-row" },
        h("div", { class: "contact-row-emoji" }, r.icon),
        h(
          "div",
          { class: "contact-row-text" },
          h("div", { class: "contact-name" }, r.name),
          r.note ? h("div", { class: "contact-note" }, r.note) : null,
        ),
      );
    }),
  );
}

function contactScreen() {
  const saved = h("div", null, savedCard());
  const submit = cta(
    () => (state.cName.trim() ? "Save contact 📇" : "Add a name first"),
    () => state.cName.trim().length > 0,
    submitContact,
  );
  return shell(
    "Private · coordinators only",
    "Save a contact",
    true,
    h(
      "div",
      { class: "privacy-banner" },
      h("div", { class: "privacy-banner-emoji" }, "🔒"),
      h(
        "div",
        { class: "privacy-banner-body" },
        "Private to coordinators. Nothing here touches the mailing list or gets emailed.",
      ),
    ),
    h(
      "div",
      { class: "card field-card" },
      fieldGroup(
        "Name",
        h("input", {
          class: "input",
          autocomplete: "off",
          placeholder: "Dana Whitfield",
          value: state.cName,
          oninput: (e) => {
            state.cName = e.target.value;
            submit.update();
          },
        }),
      ),
      fieldGroup(
        "Email",
        h("input", {
          class: "input input-mono",
          inputmode: "email",
          autocomplete: "off",
          placeholder: "events@cambridgelibrary.org",
          value: state.cEmail,
          oninput: (e) => {
            state.cEmail = e.target.value;
          },
        }),
      ),
      fieldGroup(
        "Phone or handle",
        h("input", {
          class: "input",
          autocomplete: "off",
          placeholder: "617-555-0148 · @dana on Discord",
          value: state.cPhone,
          oninput: (e) => {
            state.cPhone = e.target.value;
          },
        }),
        { optional: true },
      ),
      fieldGroup(
        "Who is this?",
        chipRow(
          CTAGS,
          (o) => o === state.cTag,
          (o) => {
            state.cTag = o;
          },
        ),
        { chips: true },
      ),
      fieldGroup(
        "Notes 📝",
        h("textarea", {
          class: "input notes-area",
          placeholder:
            "Books the lecture hall. Needs 3 weeks notice, no food past 8pm.",
          value: state.cNotes,
          oninput: (e) => {
            state.cNotes = e.target.value;
          },
        }),
      ),
    ),
    submit.btn,
    sectionLabel("Saved contacts"),
    saved,
    importRow(() => saved.replaceChildren(savedCard())),
  );
}

// The manual half of the backup story (docs/adr/0009): Android's own file
// picker, for a backup this install can no longer see — after a reinstall
// the app loses MediaStore ownership of its old files, but the picker still
// reaches them. Merging only ever adds; nothing in the book is overwritten.
function importRow(refresh) {
  const status = h("div", { class: "empty" });
  status.hidden = true;
  const say = (text) => {
    status.textContent = text;
    status.hidden = false;
  };
  return h(
    "div",
    null,
    h(
      "button",
      {
        class: "link-btn",
        type: "button",
        onclick: async () => {
          const contacts = await pickBackup();
          if (!contacts) return say("No backup file read.");
          const added = importContacts(contacts);
          say(
            added
              ? `Added ${added} ${added === 1 ? "contact" : "contacts"} from the backup.`
              : "Nothing new — those contacts are already saved.",
          );
          if (added) refresh();
        },
      },
      "Import from a backup file",
    ),
    status,
  );
}

/* --------------------------- 8. Done (shared) --------------------------- */

const DONE_COPY = {
  // Capture-at-door honesty (ADR 0005): the add is queued on this device, not
  // finished — the Done copy says so, and names where it gets finished.
  one: (d) => [
    "Queued for the list",
    `${d.who} is queued on this device — finish the add in Google Groups from home.`,
  ],
  batch: (d) => [
    `Queued ${d.n} for the list`,
    "They're queued on this device — finish the adds in Google Groups from home.",
  ],
  contact: (d) => [
    "Contact saved 📇",
    `${d.who} is in the coordinator address book. No emails sent.`,
  ],
  // Message copy follows the ADR 0002 honesty pattern: the app hands the
  // composed mail to the coordinator's mail app, so the body says where the
  // message is rather than claiming a delivery the app can't see.
  message: (d) => [
    "Draft opened in mail app",
    `The mail-app handoff was accepted. Review and send there to reach ${d.reach}. This app cannot confirm delivery.`,
  ],
  // The app hands the add to Luma's own UI (ADR 0004), so the copy says
  // where things stand rather than claiming the calendar already shows it.
  luma: (d) => [
    "Finish adding in Luma",
    `Luma opens at our calendar's add-event panel. Paste the link there — ${d.title} shows on our calendar once it's confirmed.`,
  ],
};

function doneScreen(opts) {
  const done = opts?.done ?? { kind: "one", who: "They" };
  const [title, body] = (DONE_COPY[done.kind] ?? DONE_COPY.one)(done);
  return shell(
    null,
    "Done",
    false,
    h(
      "div",
      { class: "done-col" },
      h("div", { class: "done-badge" }, "✓"),
      h(
        "div",
        { class: "done-copy" },
        h("div", { class: "done-title" }, title),
        h("div", { class: "done-body" }, body),
      ),
      h(
        "div",
        { class: "done-actions" },
        // One pop returns to the task screen; entering it clears the fields
        // (spec "Field clearing"), so this reads as a fresh form.
        h(
          "button",
          { class: "cta", type: "button", onclick: back },
          "Add another",
        ),
        h(
          "button",
          { class: "btn-secondary", type: "button", onclick: homeFromDone },
          "Back to home",
        ),
      ),
    ),
  );
}

const SCREENS = {
  home: homeScreen,
  events: eventsScreen,
  add: addScreen,
  drain: drainScreen,
  signupRestore: signupRestoreScreen,
  update: updateScreen,
  broadcast: broadcastScreen,
  done: doneScreen,
  luma: lumaScreen,
  contact: contactScreen,
};
