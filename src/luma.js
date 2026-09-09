// Flow 3 (Add a community Luma event): URL normalization, event-page
// extraction, and calendar dedupe matching. The same calendar-page parse
// also feeds Home's next-event card and the Events page (date/time, venue,
// RSVP count, days out). Pure string in / object out — the network read
// lives at the backend.js seam, so all of this is testable against
// fixtures (docs/adr/0004-credential-free-luma-handoff.md).
//
// Extraction chain, most stable first: schema.org JSON-LD (Luma serves it
// for search rich-results), OpenGraph tags, then the embedded __NEXT_DATA__
// page state (richest — the only source of the stable evt-… id and the
// Luma categories — but the first to move when Luma changes their stack).
// Every field degrades on its own: render whatever survives.

// "lu.ma/x", "https://www.luma.com/x?utm_campaign=z#live" → "https://luma.com/x"
// (lu.ma 301s to luma.com; canonical og:url is luma.com — normalize before
// preview and dedupe). Null when the pasted text is not a Luma link.
export function normalizeLumaUrl(raw) {
  const m = String(raw)
    .trim()
    .match(/^(?:https?:\/\/)?(?:www\.)?(?:lu\.ma|luma\.com)\//i);
  if (!m) return null;
  const slug = String(raw)
    .trim()
    .slice(m[0].length)
    .split(/[/?#\s]/)[0];
  return slug ? `https://luma.com/${slug}` : null;
}

export const slugOf = (url) => normalizeLumaUrl(url)?.split("/").pop() ?? null;

function jsonLdEvent(html) {
  for (const m of html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let block;
    try {
      block = JSON.parse(m[1]);
    } catch {
      continue; // a malformed sibling block must not sink the others
    }
    const items = Array.isArray(block)
      ? block
      : block["@graph"]
        ? block["@graph"]
        : [block];
    const ev = items.find((it) => it?.["@type"] === "Event");
    if (ev) return ev;
  }
  return null;
}

function ogTags(html) {
  const pick = (prop) => {
    const m =
      html.match(
        new RegExp(`<meta[^>]*property="${prop}"[^>]*content="([^"]*)"`, "i"),
      ) ??
      html.match(
        new RegExp(`<meta[^>]*content="([^"]*)"[^>]*property="${prop}"`, "i"),
      );
    return m ? m[1] : null;
  };
  return {
    title: pick("og:title"),
    image: pick("og:image"),
    url: pick("og:url"),
  };
}

function nextData(html) {
  const m = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1])?.props?.pageProps?.initialData?.data ?? null;
  } catch {
    return null;
  }
}

const trimmed = (s) => (typeof s === "string" && s.trim() ? s.trim() : null);

// Preview of a pasted event link. Returns { isEvent, title, startAt, timezone,
// venue, tags, cover, eventId, url } with any field null/empty when its source
// is missing. `isEvent` is the one non-degrading field: only an actual event
// page carries a JSON-LD Event block or a page-state event object, so a
// calendar/user page pasted by mistake reads as not-an-event even though it
// serves an og:title.
export function parseEventPage(html) {
  const ld = jsonLdEvent(html);
  const og = ogTags(html);
  const data = nextData(html);
  const ev = data?.event;

  const venue =
    (ev?.geo_address_info &&
      ev.geo_address_info.mode !== "obfuscated" &&
      ev.geo_address_info.address) ||
    ld?.location?.name ||
    ev?.geo_address_info?.city_state ||
    ev?.geo_address_info?.city ||
    null;

  return {
    isEvent: Boolean(ld || ev),
    title:
      trimmed(ld?.name) ??
      trimmed(og.title?.replace(/\s*·\s*Luma$/i, "")) ??
      trimmed(ev?.name),
    startAt: ld?.startDate ?? ev?.start_at ?? null,
    // IANA zone only comes from the page state; JSON-LD carries the event's
    // wall time as an offset instead (rendered without a zone name).
    timezone: ev?.timezone ?? null,
    venue,
    tags: (data?.categories ?? []).map((c) => c?.name).filter(Boolean),
    cover:
      ev?.cover_url ??
      ev?.social_image_url ??
      [].concat(ld?.image ?? [])[0] ??
      og.image ??
      null,
    eventId:
      typeof ev?.api_id === "string" && ev.api_id.startsWith("evt-")
        ? ev.api_id
        : null,
    url: normalizeLumaUrl(
      ld?.url ?? og.url ?? (ev?.url ? `https://luma.com/${ev.url}` : ""),
    ),
  };
}

// Wall-clock parts of an instant in the event's own timezone — the shared
// core of formatWhen/formatWhenRange. Offset-bearing ISO (JSON-LD) carries
// the wall time in the string itself; UTC + IANA zone (page state) needs a
// zoned format. `ymd` is the wall calendar date, so a range can tell
// same-day from overnight. Returns null when there is nothing to parse.
function wallParts(iso, timezone, longWeekday = false) {
  const m = String(iso ?? "").match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?/,
  );
  if (!m) return null;
  let parts;
  let ymd = `${m[1]}-${m[2]}-${m[3]}`;
  let offsetMinutes = null;
  let tz;
  if (m[6] && m[6] !== "Z") {
    // Wall time is right there in the string — no conversion needed.
    parts = {
      weekday: null,
      month: null,
      day: +m[3],
      hour: +m[4],
      minute: m[5],
    };
    const o = m[6].match(/^([+-])(\d{2}):?(\d{2})$/);
    offsetMinutes = o ? (o[1] === "-" ? -1 : 1) * (+o[2] * 60 + +o[3]) : null;
  } else {
    tz = m[6] === "Z" && timezone ? timezone : undefined;
    try {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: longWeekday ? "long" : "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      parts = Object.fromEntries(
        fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
      );
      // The wall date, not the UTC date — a midnight-UTC start can land on
      // the previous day in the event's own zone.
      ymd = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(iso));
    } catch {
      return null;
    }
  }
  if (parts.weekday == null) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`); // weekday/month names only
    parts.weekday = d.toLocaleDateString("en-US", {
      weekday: longWeekday ? "long" : "short",
    });
    parts.month = d.toLocaleDateString("en-US", { month: "short" });
  }
  const hour12 = parts.hour % 12 || 12;
  const minute = String(parts.minute).padStart(2, "0");
  const ampm = String(
    parts.dayPeriod ?? (parts.hour < 12 ? "am" : "pm"),
  ).toLowerCase();
  return {
    weekday: parts.weekday,
    month: parts.month,
    day: parts.day,
    clock: `${hour12}:${minute}`,
    ampm,
    ymd,
    offsetMinutes,
    tz,
  };
}

// Wall time of the event in its own timezone, rendered spec-style:
// "Thu Aug 13 · 7:00 pm". Returns null when there is nothing to render.
export function formatWhen(startAt, timezone) {
  const p = wallParts(startAt, timezone);
  return p ? `${p.weekday} ${p.month} ${p.day} · ${p.clock} ${p.ampm}` : null;
}

// Home's next-event card line (spec §1): "Wednesday, Aug 5 · 6:00–9:00 pm".
// Same-day ranges render start–end with one am/pm; an overnight or missing
// end drops the end time rather than putting it on the wrong date.
export function formatWhenRange(startAt, endAt, timezone) {
  const s = wallParts(startAt, timezone, true);
  if (!s) return null;
  const head = `${s.weekday}, ${s.month} ${s.day}`;
  const e = endAt == null ? null : wallParts(endAt, timezone, true);
  if (e && e.ymd === s.ymd) {
    const range =
      s.ampm === e.ampm
        ? `${s.clock}–${e.clock} ${e.ampm}`
        : `${s.clock} ${s.ampm}–${e.clock} ${e.ampm}`;
    return `${head} · ${range}`;
  }
  return `${head} · ${s.clock} ${s.ampm}`;
}

// Calendar source URLs are untrusted, including those restored from old caches.
// Only Luma entries may turn a bare slug into a URL. External URLs stay original.
export function eventSourceUrl(raw, platform) {
  const value = trimmed(raw);
  // Explicitly reject controls at this untrusted URL boundary.
  // eslint-disable-next-line no-control-regex
  if (!value || /[\\\s\u0000-\u001f\u007f]/.test(value)) return null;
  if (/^[a-zA-Z0-9_-]+$/.test(value))
    return platform === "external" ? null : `https://luma.com/${value}`;
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (/^(www\.)?(lu\.ma|luma\.com)$/i.test(url.hostname)) {
      // Check the raw path too: URL() would silently normalize dot segments.
      const path = value.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
      if (!/^\/[a-zA-Z0-9_-]+\/?$/.test(path)) return null;
      return `https://luma.com/${path.split("/")[1]}`;
    }
    return url.href;
  } catch {
    return null;
  }
}

// Upcoming events embedded in the group calendar's public page — the
// credential-free dedupe source, and the read Home's next-event card
// renders from. Empty and unreadable are distinct: a recognized list that
// happens to be empty yields [], while a page whose structure we no longer
// recognize yields null, which the screens render as "couldn't check" /
// "couldn't reach" rather than asserting the calendar is empty.
export function parseCalendarEvents(html) {
  const data = nextData(html);
  if (!data) return null;
  // featured_items sits at initialData.data on the calendars probed; fall
  // back to a shallow scan so a re-nested key degrades instead of breaking.
  const looksRight = (xs) =>
    Array.isArray(xs) &&
    xs.some(
      (it) =>
        it?.event?.api_id ||
        it?.event?.url ||
        (it?.platform === "external" && trimmed(it?.event?.name)),
    );
  // Only a list we recognize, or an empty one, counts as read: a populated
  // list whose items we no longer recognize means the markup moved, and
  // must read as unreadable rather than as an empty calendar.
  const isEmptyList = (xs) => Array.isArray(xs) && !xs.length;
  const items = looksRight(data.featured_items)
    ? data.featured_items
    : (Object.values(data).find(looksRight) ??
      (isEmptyList(data.featured_items) ? data.featured_items : null));
  if (!items) return null;
  return items
    .map((it) => {
      // event.url is a slug for Luma events, a full URL for external-platform
      // entries (which then dedupe by id only).
      const u = it?.event?.url ?? it?.url ?? null;
      const ev = it?.event;
      // Same venue rule as parseEventPage, minus the JSON-LD fallback —
      // calendar entries have no JSON-LD of their own.
      const geo = ev?.geo_address_info;
      const guests = it?.guest_count ?? ev?.guest_count;
      const addressPublic =
        ["shown", "visible"].includes(geo?.mode) &&
        (!ev?.geo_address_visibility || ev.geo_address_visibility === "public");
      const url = eventSourceUrl(u, it?.platform);
      return {
        eventId: typeof ev?.api_id === "string" ? ev.api_id : null,
        slug: slugOf(url),
        url,
        fullAddress: addressPublic ? trimmed(geo?.full_address) : null,
        description: trimmed(ev?.description),
        name: it?.name ?? ev?.name ?? null,
        // Home's next-event card renders from these; each stays null when
        // the page doesn't carry it and the card degrades around it.
        startAt: it?.start_at ?? ev?.start_at ?? null,
        endAt: ev?.end_at ?? null,
        timezone: ev?.timezone ?? null,
        venue:
          (addressPublic && trimmed(geo?.address)) ||
          geo?.city_state ||
          geo?.city ||
          null,
        // The public surface carries the RSVP count but NO capacity number
        // (ticket_count mirrors guest_count), so the card renders RSVPs
        // only and omits the capacity tile rather than faking one.
        guestCount: Number.isFinite(guests) ? guests : null,
        hideRsvp: Boolean(ev?.hide_rsvp),
      };
    })
    .filter((e) => e.eventId || e.url || e.name);
}

// The soonest entry that hasn't ended yet — an in-progress event still
// reads as the next one at the venue door. Undated entries can't be
// ordered and are skipped. `now` is injectable for tests.
export function nextUpcoming(events, now = new Date()) {
  const t = +now;
  return (
    (events ?? [])
      .filter((e) => {
        const start = Date.parse(e?.startAt ?? "");
        if (Number.isNaN(start)) return false;
        const end = Date.parse(e?.endAt ?? "");
        return (Number.isNaN(end) ? start : end) > t;
      })
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0] ?? null
  );
}

// Every entry that hasn't ended yet, soonest first — the Events page's
// full list, where nextUpcoming is the Home card's single pick. Same
// not-ended rule; entries with no readable start can't be ordered, so
// they go last rather than being dropped — unless their end says they
// are already over. `now` is injectable for tests.
export function upcomingEvents(events, now = new Date()) {
  const t = +now;
  return (events ?? [])
    .filter((e) => {
      const start = Date.parse(e?.startAt ?? "");
      const end = Date.parse(e?.endAt ?? "");
      if (Number.isNaN(start)) return Number.isNaN(end) ? true : end > t;
      return (Number.isNaN(end) ? start : end) > t;
    })
    .sort((a, b) => {
      const sa = Date.parse(a?.startAt ?? "");
      const sb = Date.parse(b?.startAt ?? "");
      if (Number.isNaN(sa)) return Number.isNaN(sb) ? 0 : 1;
      if (Number.isNaN(sb)) return -1;
      return sa - sb;
    });
}

// Whole calendar days until the start, in the event's own timezone — the
// day boundary that matters is the venue's, not the device's. 0 = today.
// Null on junk input. Both dates come off the same wall-clock rules the
// card line uses, so the chip can never disagree with the line it sits on:
// an offset-bearing start takes its own date and puts `now` in that same
// offset; Z/naive starts use the event timezone (device zone when absent).
export function daysOut(startAt, timezone, now = new Date()) {
  const s = wallParts(startAt, timezone);
  if (!s || Number.isNaN(+now)) return null;
  let nowYmd;
  if (s.offsetMinutes != null) {
    nowYmd = new Date(+now + s.offsetMinutes * 60000)
      .toISOString()
      .slice(0, 10);
  } else {
    try {
      nowYmd = new Intl.DateTimeFormat("en-CA", {
        timeZone: s.tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
    } catch {
      return null;
    }
  }
  // Both parse as UTC midnights, so the difference is exact days.
  return Math.round((Date.parse(s.ymd) - Date.parse(nowYmd)) / 864e5);
}

// The chip label above the card's date line. An in-progress event whose
// start was before the venue's midnight is still happening now, so a
// non-positive count reads "Today" rather than a negative day count.
// Null (junk input) means no chip at all.
export function daysOutLabel(startAt, timezone, now = new Date()) {
  const d = daysOut(startAt, timezone, now);
  if (d == null) return null;
  return d <= 0 ? "Today" : d === 1 ? "Tomorrow" : `${d} days out`;
}

// Match the pasted event against the calendar's upcoming list: stable evt-…
// id first, URL slug second. Returns the matching entry or null.
export function findDuplicate(preview, entries) {
  const slug = slugOf(preview?.url ?? "");
  return (
    entries.find((e) => preview?.eventId && e.eventId === preview.eventId) ??
    entries.find((e) => slug && e.slug === slug) ??
    null
  );
}
