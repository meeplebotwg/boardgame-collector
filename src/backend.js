// The swap points between the app and the outside world. The app never
// performs the privileged act itself — it composes, a human's own apps
// execute (ADR 0005 add drain, ADR 0002 broadcast mailto, ADR 0004 Luma).
//
// v1 add (docs/adr/0005-coordinator-initiated-adds.md): consumer
// googlegroups.com groups have no membership API, so adds are captured into
// the device-local queue at the door and drained at home in Google Groups'
// own owner UI — the coordinator pastes the app's copy-ready blocks there
// and submits. The app's only moves are clipboard copy and a browser
// deep link. Explicit private intake lives in handoff.js (ADR 0010). The self-serve join
// link survives as a demoted secondary fallback (ADR 0002).

import { isValidEmail } from "./parse.js";

export const JOIN_LINK = "https://groups.google.com/g/bgn-wg/about";
export const JOIN_MAIL = "bgn-wg+subscribe@googlegroups.com";
// The club's public site (chapters, events, FAQ). Home's "Club website"
// card is a plain external handoff — the same ACTION_VIEW pattern as the
// members-page deep link; the app never embeds or writes to it.
export const WEBSITE_URL = "https://boardgamenightwg.com/";

export async function openWebsite() {
  await openExternal(WEBSITE_URL);
}

// The group's owner UI — the drain screen's deep-link target and the ONLY
// write path for adds: the coordinator is signed in there, the app just
// opens the page.
export const MEMBERS_URL = "https://groups.google.com/g/bgn-wg/members";
// Mailing a Google Group's own address IS broadcasting to it, so Flow 2's
// send mechanism is the same compose-and-hand-off pattern (ADR 0002):
// compose a mailto and let the coordinator's own mail app do the sending.
export const LIST_MAIL = "bgn-wg@googlegroups.com";

export function composeMessage() {
  return (
    `One-tap link to join bgn-wg: ${JOIN_LINK}\n` +
    `Or join by email: mailto:${JOIN_MAIL}`
  );
}

const SUBJECT = "Join Board Game Night";

export function singleMailtoUri(email) {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(composeMessage())}`;
}

// Demoted fallback (ADR 0005): when the member at the door can self-serve,
// the coordinator shares the join-link message instead of queueing. The
// device share sheet does the handing; with no Web Share API (Android
// WebView) it falls back to a mailto addressed to the member.
export async function handOffJoinLink(email) {
  if (navigator.share) {
    await navigator.share({ title: SUBJECT, text: composeMessage() });
    return;
  }
  if (!isValidEmail(email))
    throw new Error("no share target and no valid email");
  await openExternal(singleMailtoUri(email));
}

// Open the group's owner UI in the coordinator's browser — the drain
// screen's deep link. Just an ACTION_VIEW intent; the app sends nothing.
export async function openMembersPage() {
  await openExternal(MEMBERS_URL);
}

// Flow 2 broadcast: the edited preview's subject + body, addressed to the
// group. Sent by the coordinator's own mail app — the app never sends itself.
export function broadcastMailtoUri(subject, body) {
  return `mailto:${LIST_MAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* ------------------------- Flow 3: community Luma events -------------------------
 * Credential-free v1 (docs/adr/0004-credential-free-luma-handoff.md): the app
 * reads public lu.ma pages and hands the actual add to Luma's own UI. All
 * network here is read-only GETs; the ONLY write path is the coordinator
 * acting in Luma after handOffLuma() opens it. Luma Plus / API keys were
 * declined — nothing in this file may grow a credential. */

// The group's community calendar (captain-confirmed: a Luma calendar,
// admined by the captain's account; identified 2026-08-16 by resolving the
// calendar id to its public slug). The public page feeds the calendar read
// (flow 3's dedupe and Home's next-event card); the manage page is the
// handoff deep-link target.
export const GROUP_CALENDAR = {
  name: "Board Game Night WG",
  slug: "boardgamenightwg",
  id: "cal-v6H3Jm84BrwuOYb",
};

export const calendarUrl = () => `https://luma.com/${GROUP_CALENDAR.slug}`;

// The admin "Add Existing Luma Event" panel the group's documented flow uses;
// the coordinator is signed in there, so the handoff lands two taps from done.
export const calendarManageUrl = () =>
  `https://luma.com/calendar/manage/${GROUP_CALENDAR.id}`;

// A browser fetch of luma.com dies on CORS (no Access-Control-Allow-Origin),
// so inside Tauri the request goes through the Rust-side http plugin
// (capability-scoped to luma.com / lu.ma). Bare browser dev falls back to
// window.fetch and sees the error state instead — same as airplane mode.
const FETCH_TIMEOUT_MS = 10_000;
export async function fetchLumaPage(url) {
  const f = window.__TAURI_INTERNALS__ ? tauriFetch : globalThis.fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // Race guards the case where the fetch impl ignores the abort signal.
    const res = await Promise.race([
      f(url, {
        redirect: "follow",
        signal: ctrl.signal,
        headers: { accept: "text/html" },
      }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), FETCH_TIMEOUT_MS + 500),
      ),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

import { parseEventPage, parseCalendarEvents, eventSourceUrl } from "./luma.js";

// Preview of a pasted event link: one GET of the public page, parsed with
// graceful per-field degradation (docs/adr/0004). Throws on network/HTTP
// failure — the screen renders its offline/error state.
export async function fetchEventPreview(url) {
  return parseEventPage(await fetchLumaPage(url));
}

// Upcoming events embedded in the group calendar's public page — the
// best-effort dedupe read, and the read behind Home's next-event card and
// the Events page (one GET per screen entry). Throws when the page can't be
// fetched and resolves null when its structure isn't recognized; the screens
// render both as "couldn't read" — and never block the add.
export async function fetchCalendarEvents() {
  return parseCalendarEvents(await fetchLumaPage(calendarUrl()));
}

// Event-card link handoff: validate again at the external-opener boundary.
export async function openEventPage(url) {
  const safe = eventSourceUrl(url, "external");
  if (!safe) throw new Error("Invalid event URL");
  await openExternal(safe);
}

// Last successful calendar read, cached for Home's next-event card and the
// Events page: a venue-door cold start on bad wifi shows the last known
// events (marked as such) rather than nothing. Same localStorage approach as
// the add queue. The list is cached, not the pick — selection runs against
// the current clock at render time, so a stale cache can never show a past
// event as upcoming.
const CALENDAR_CACHE_KEY = "bgn.calendar.v1";

export function loadCalendarCache() {
  try {
    return JSON.parse(localStorage.getItem(CALENDAR_CACHE_KEY)) ?? null;
  } catch {
    return null;
  }
}

// Swallows storage failures (quota, DOM storage off in the WebView): the
// cache is a cold-start nicety, and losing it must not turn a successful
// read into the card's error state.
export function saveCalendarCache(events) {
  try {
    localStorage.setItem(
      CALENDAR_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), events }),
    );
  } catch (err) {
    console.warn(`[luma] calendar cache write failed: ${err?.message ?? err}`);
  }
}

// Hand the confirmed event to Luma's own Add Event panel: the event URL goes
// to the clipboard (Luma's panel takes a pasted link), then the group's
// calendar page opens in the coordinator's browser, where they are already
// signed in and are an admin. This is THE swap point for the add mechanism —
// a funded Luma Plus upgrade replaces this function with
// POST /v1/calendars/events/add without touching the screen.
export async function handOffLuma(preview) {
  try {
    await navigator.clipboard.writeText(preview.url);
  } catch (err) {
    // Not fatal: the coordinator can still type the link into Luma's panel.
    console.warn(`[luma] clipboard copy failed: ${err?.message ?? err}`);
  }
  await openExternal(calendarManageUrl());
}

// The opener/http JS APIs are only IPC wrappers; importing them statically
// is safe outside Tauri (they are never called there).
import { openUrl } from "@tauri-apps/plugin-opener";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

// OS-level handoff (ACTION_VIEW on Android via tauri-plugin-opener). A bare
// location.href can't carry a mailto: through the WebView — it dies with
// ERR_UNKNOWN_URL_SCHEME and wipes the app UI.
async function openExternal(uri) {
  if (window.__TAURI_INTERNALS__) {
    await openUrl(uri);
    return;
  }
  // Bare browser (desktop dev): plain navigation opens the mail client.
  window.location.href = uri;
}

// Hand the confirmed broadcast to the coordinator's mail app. Resolves once
// the OS accepts the handoff; throws when it can't (no mail app), and the
// caller stays on the confirm step — the draft is untouched, so tapping again
// retries. Deliberately not queued: the on-screen confirm step is the retry,
// and a parked broadcast must not sit in the add queue (ADR 0005).
export async function handOffBroadcast({ subject, body }) {
  await openExternal(broadcastMailtoUri(subject, body));
}
