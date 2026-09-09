// Flow 3 (Add a community Luma event): extraction chain, per-field
// degradation, URL normalization, and the best-effort dedupe match — plus
// the calendar-entry helpers Home's next-event card renders from
// (nextUpcoming / daysOut / formatWhenRange). All fixtures below are
// fabricated — obviously fake events and calendars, never the group's
// real calendar (docs/adr/0004).

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLumaUrl,
  slugOf,
  parseEventPage,
  formatWhen,
  formatWhenRange,
  parseCalendarEvents,
  findDuplicate,
  nextUpcoming,
  upcomingEvents,
  daysOut,
  daysOutLabel,
} from "../src/luma.js";

/* ------------------------------ URL normalization ------------------------------ */

test("normalizeLumaUrl: lu.ma and luma.com spellings, query/fragment stripped", () => {
  assert.equal(normalizeLumaUrl("lu.ma/fake1234"), "https://luma.com/fake1234");
  assert.equal(
    normalizeLumaUrl("https://lu.ma/fake1234"),
    "https://luma.com/fake1234",
  );
  assert.equal(
    normalizeLumaUrl("https://www.luma.com/fake1234"),
    "https://luma.com/fake1234",
  );
  assert.equal(
    normalizeLumaUrl("luma.com/fake1234"),
    "https://luma.com/fake1234",
  );
  assert.equal(
    normalizeLumaUrl("  https://lu.ma/fake1234?utm_source=chat#live  "),
    "https://luma.com/fake1234",
  );
  // Trailing path segments beyond the slug drop off.
  assert.equal(
    normalizeLumaUrl("lu.ma/fake1234/extra"),
    "https://luma.com/fake1234",
  );
});

test("normalizeLumaUrl: non-Luma input yields null", () => {
  assert.equal(normalizeLumaUrl(""), null);
  assert.equal(normalizeLumaUrl("   "), null);
  assert.equal(normalizeLumaUrl("example.com/fake1234"), null);
  assert.equal(normalizeLumaUrl("not a link at all"), null);
  assert.equal(normalizeLumaUrl("lu.ma/"), null);
  assert.equal(normalizeLumaUrl("lu.ma/?utm_source=x"), null);
});

test("slugOf round-trips the slug", () => {
  assert.equal(slugOf("https://lu.ma/fake1234?x=1"), "fake1234");
  assert.equal(slugOf(null), null);
  assert.equal(slugOf("https://example.com/x"), null);
});

/* ------------------------------ extraction chain ------------------------------ */

// Fixture: full page — JSON-LD + OG + embedded page state, fake event.
const FULL_PAGE = `<!doctype html>
<html><head>
<script data-cfasync="false" type="application/ld+json">
{"@context":"https://schema.org","@type":"Event","@id":"https://luma.com/fake1234",
 "url":"https://luma.com/fake1234","name":"Fixture Game Night",
 "location":{"@type":"Place","name":"Fixture Hall","address":{"@type":"PostalAddress","addressLocality":"Springfield"}},
 "image":["https://images.example.test/cover.png"],
 "description":"A fake event for tests.",
 "startDate":"2026-09-03T18:30:00.000-04:00","endDate":"2026-09-03T21:00:00.000-04:00"}
</script>
<meta property="og:title" content="Fixture Game Night · Luma">
<meta property="og:image" content="https://images.example.test/og.png">
<meta property="og:url" content="https://luma.com/fake1234">
</head><body>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"initialData":{"data":{
  "event":{"api_id":"evt-FakeFakeFakeFak","name":"Fixture Game Night","url":"fake1234",
           "start_at":"2026-09-03T22:30:00.000Z","timezone":"America/New_York",
           "geo_address_info":{"mode":"obfuscated","city":"Springfield","city_state":"Springfield, MA"},
           "cover_url":"https://images.example.test/cover.png"},
  "categories":[{"api_id":"cat-1","name":"Games"},{"api_id":"cat-2","name":"Community"}]
}}}}}
</script>
</body></html>`;

test("full page: every field extracted, dedupe id and canonical URL included", () => {
  const p = parseEventPage(FULL_PAGE);
  assert.equal(p.isEvent, true);
  assert.equal(p.title, "Fixture Game Night");
  assert.equal(p.startAt, "2026-09-03T18:30:00.000-04:00"); // JSON-LD wins
  assert.equal(p.timezone, "America/New_York");
  assert.equal(p.venue, "Fixture Hall"); // JSON-LD place name over obfuscated city
  assert.deepEqual(p.tags, ["Games", "Community"]);
  assert.equal(p.cover, "https://images.example.test/cover.png");
  assert.equal(p.eventId, "evt-FakeFakeFakeFak");
  assert.equal(p.url, "https://luma.com/fake1234");
});

// Fixture: only OpenGraph survives (JSON-LD and page state both gone).
const OG_ONLY_PAGE = `<html><head>
<meta property="og:title" content="OG Only Event · Luma">
<meta property="og:image" content="https://images.example.test/og.png">
<meta property="og:url" content="https://luma.com/ogonly77">
</head><body></body></html>`;

test("OG-only page degrades to a title, image, and URL — but is not an event page", () => {
  const p = parseEventPage(OG_ONLY_PAGE);
  // OG alone can't tell an event from a calendar page: the screen refuses it.
  assert.equal(p.isEvent, false);
  assert.equal(p.title, "OG Only Event"); // " · Luma" suffix stripped
  assert.equal(p.cover, "https://images.example.test/og.png");
  assert.equal(p.url, "https://luma.com/ogonly77");
  assert.equal(p.startAt, null);
  assert.equal(p.timezone, null);
  assert.equal(p.venue, null);
  assert.deepEqual(p.tags, []);
  assert.equal(p.eventId, null);
});

// Fixture: JSON-LD only (no OG, no page state) — venue host-obfuscated to city.
const LD_ONLY_PAGE = `<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Event","name":"City Level Event",
 "location":{"@type":"Place","name":"Boston, MA"},
 "startDate":"2026-10-01T19:00:00.000-04:00"}
</script>`;

test("JSON-LD-only page still yields title, wall time, and city-level venue", () => {
  const p = parseEventPage(LD_ONLY_PAGE);
  assert.equal(p.isEvent, true);
  assert.equal(p.title, "City Level Event");
  assert.equal(p.venue, "Boston, MA");
  assert.equal(formatWhen(p.startAt, p.timezone), "Thu Oct 1 · 7:00 pm");
  assert.equal(p.eventId, null); // id only lives in the page state
});

test("page state venue wins when the host published a real address", () => {
  const page = `<script id="__NEXT_DATA__" type="application/json">
  {"props":{"pageProps":{"initialData":{"data":{"event":{
    "api_id":"evt-AddrVenueFake12","name":"Venue Event","url":"venfake88",
    "start_at":"2026-09-05T23:00:00.000Z","timezone":"America/New_York",
    "geo_address_info":{"mode":"visible","address":"The Back Room","city_state":"Boston, MA"}}}}}}}
  </script>`;
  const p = parseEventPage(page);
  assert.equal(p.venue, "The Back Room");
});

// A real calendar page serves an og:title, so the title alone can't tell it
// apart from an event — only the absence of an event object can.
test("a non-event page reads as not-an-event even when it serves an og:title", () => {
  const p = parseEventPage(`<html><head>
    <meta property="og:title" content="Fixture Community Calendar · Luma">
    <meta property="og:url" content="https://luma.com/fixturecal">
    </head><body><script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"initialData":{"data":{"featured_items":[]}}}}}</script></body></html>`);
  assert.equal(p.isEvent, false);
  assert.equal(p.title, "Fixture Community Calendar");
  assert.equal(p.startAt, null);
  assert.equal(parseEventPage("").isEvent, false);
  assert.equal(parseEventPage("").title, null);
  assert.equal(parseEventPage("garbage, not html at all").title, null);
});

test("an empty og:title yields a null title, never an empty string", () => {
  const p = parseEventPage(`<html><head><meta property="og:title" content="">
    </head><body><script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"initialData":{"data":{"event":{
      "api_id":"evt-NamelessFake12","url":"nameless9","name":"  "}}}}}}</script></body></html>`);
  assert.equal(p.isEvent, true);
  assert.equal(p.title, null);
});

test("a malformed JSON-LD block does not sink a valid sibling", () => {
  const page = `<script type="application/ld+json">{broken json</script>
    <script type="application/ld+json">{"@type":"Event","name":"Second Block Wins"}</script>`;
  assert.equal(parseEventPage(page).title, "Second Block Wins");
});

/* ------------------------------ time rendering ------------------------------ */

test("formatWhen renders offset ISO in the event's own wall time", () => {
  assert.equal(
    formatWhen("2026-08-13T19:00:00.000-04:00"),
    "Thu Aug 13 · 7:00 pm",
  );
  assert.equal(
    formatWhen("2026-08-13T09:05:00.000-04:00"),
    "Thu Aug 13 · 9:05 am",
  );
  assert.equal(
    formatWhen("2026-08-13T00:30:00.000-04:00"),
    "Thu Aug 13 · 12:30 am",
  );
});

test("formatWhen converts UTC + IANA zone to the event's wall time", () => {
  // 22:30 UTC on Sep 3 is 18:30 in New York (EDT, UTC-4).
  assert.equal(
    formatWhen("2026-09-03T22:30:00.000Z", "America/New_York"),
    "Thu Sep 3 · 6:30 pm",
  );
});

test("formatWhen degrades on junk input", () => {
  assert.equal(formatWhen(null), null);
  assert.equal(formatWhen(""), null);
  assert.equal(formatWhen("not a date"), null);
});

/* ------------------------------ dedupe ------------------------------ */

const CALENDAR_PAGE = `<html><body>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"initialData":{"data":{
  "featured_items":[
    {"name":"Fixture Game Night","start_at":"2026-09-03T22:30:00.000Z","guest_count":12,"platform":"luma","status":"approved","tags":[],
     "event":{"api_id":"evt-FakeFakeFakeFak","url":"fake1234",
              "start_at":"2026-09-03T22:30:00.000Z","end_at":"2026-09-04T01:30:00.000Z","timezone":"America/New_York","hide_rsvp":false,
              "geo_address_info":{"mode":"visible","address":"Fixture Hall, 1 Main St","city_state":"Springfield, MA"}}},
    {"name":"Trivia Tuesday","start_at":"2026-09-08T23:00:00.000Z","platform":"external","status":"approved","tags":[],
     "event":{"api_id":"evt-TriviaTriviaTri","url":"https://example.com/trivia"}}
  ]
}}}}}
</script></body></html>`;

test("parseCalendarEvents pulls ids + slugs from the embedded upcoming list", () => {
  const events = parseCalendarEvents(CALENDAR_PAGE);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    eventId: "evt-FakeFakeFakeFak",
    slug: "fake1234",
    url: "https://luma.com/fake1234",
    fullAddress: null,
    description: null,
    name: "Fixture Game Night",
    startAt: "2026-09-03T22:30:00.000Z",
    endAt: "2026-09-04T01:30:00.000Z",
    timezone: "America/New_York",
    venue: "Fixture Hall, 1 Main St",
    guestCount: 12,
    hideRsvp: false,
  });
  assert.equal(events[1].eventId, "evt-TriviaTriviaTri");
});

test("parseCalendarEvents: a bare external entry degrades every card field to null", () => {
  const e = parseCalendarEvents(CALENDAR_PAGE)[1];
  assert.equal(e.startAt, "2026-09-08T23:00:00.000Z"); // item-level start survives
  assert.equal(e.endAt, null);
  assert.equal(e.timezone, null);
  assert.equal(e.venue, null);
  assert.equal(e.guestCount, null);
  assert.equal(e.hideRsvp, false);
});

test("parseCalendarEvents: an event-level guest count still feeds the RSVP tile", () => {
  const page = `<script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"initialData":{"data":{"featured_items":[
      {"name":"Nested Count Night",
       "event":{"api_id":"evt-NestedCountAaa","url":"nested-count-night","guest_count":9}}
    ]}}}}}
  </script>`;
  assert.equal(parseCalendarEvents(page)[0].guestCount, 9);
});

test("parseCalendarEvents: obfuscated venue degrades to city level", () => {
  const page = `<script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"initialData":{"data":{"featured_items":[
      {"name":"Hidden Loft Night","guest_count":7,
       "event":{"api_id":"evt-HiddenVenueFake","url":"hidden77",
                "start_at":"2026-09-10T22:00:00.000Z","timezone":"America/New_York","hide_rsvp":true,
                "geo_address_info":{"mode":"obfuscated","address":"Secret Loft","city_state":"Boston, MA"}}}
    ]}}}}}</script>`;
  const e = parseCalendarEvents(page)[0];
  assert.equal(e.venue, "Boston, MA"); // street address suppressed by the host
  assert.equal(e.guestCount, 7); // the parser carries the count…
  assert.equal(e.hideRsvp, true); // …the card decides not to render it
});

test("parseCalendarEvents: unreadable pages yield null, not an empty list", () => {
  assert.equal(parseCalendarEvents(""), null);
  assert.equal(parseCalendarEvents("<html>no next data here</html>"), null);
  // Recognizable page shape, but no list container we know how to read.
  const noList = `<script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"initialData":{"data":{"calendar":{"name":"Ours"}}}}}}</script>`;
  assert.equal(parseCalendarEvents(noList), null);
  // The container survived but its items were renamed: the markup moved,
  // so this is unreadable — never a (false) empty calendar.
  const renamedItems = `<script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"initialData":{"data":{"featured_items":[
      {"name":"Renamed Fields Night","event":{"id":"evt-RenamedFake123","slug":"renamed99"}}
    ]}}}}}</script>`;
  assert.equal(parseCalendarEvents(renamedItems), null);
});

test("parseCalendarEvents: a recognized but empty list yields []", () => {
  const empty = `<script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"initialData":{"data":{"featured_items":[]}}}}}</script>`;
  assert.deepEqual(parseCalendarEvents(empty), []);
});

test("parseCalendarEvents: a reshaped page still finds the list under data", () => {
  const reshaped = `<script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"initialData":{"data":{"upcoming":[
      {"name":"Moved List","event":{"api_id":"evt-MovedListFake12","url":"moved999"}}
    ]}}}}}</script>`;
  assert.equal(parseCalendarEvents(reshaped)[0].eventId, "evt-MovedListFake12");
});

test("findDuplicate matches by evt id first, then by slug, else null", () => {
  const events = parseCalendarEvents(CALENDAR_PAGE);
  const byId = findDuplicate(parseEventPage(FULL_PAGE), events);
  assert.equal(byId.name, "Fixture Game Night");
  // Same slug but no id extracted (OG-only preview) still matches.
  const bySlug = findDuplicate(
    { url: "https://luma.com/fake1234", eventId: null },
    events,
  );
  assert.equal(bySlug.eventId, "evt-FakeFakeFakeFak");
  assert.equal(
    findDuplicate(
      { url: "https://luma.com/unlisted1", eventId: "evt-Nope" },
      events,
    ),
    null,
  );
  assert.equal(findDuplicate({ url: null, eventId: null }, events), null);
});

/* ------------------------- next-event card helpers ------------------------- */

test("formatWhenRange renders a same-day range with one am/pm (spec §1 line)", () => {
  assert.equal(
    formatWhenRange(
      "2026-08-05T18:00:00.000-04:00",
      "2026-08-05T21:00:00.000-04:00",
    ),
    "Wednesday, Aug 5 · 6:00–9:00 pm",
  );
  // UTC + IANA zone: 22:00–01:00Z on Sep 9/10 is 6–9pm wall time, same day.
  assert.equal(
    formatWhenRange(
      "2026-09-09T22:00:00.000Z",
      "2026-09-10T01:00:00.000Z",
      "America/New_York",
    ),
    "Wednesday, Sep 9 · 6:00–9:00 pm",
  );
});

test("formatWhenRange keeps both am/pm when the range crosses noon", () => {
  assert.equal(
    formatWhenRange(
      "2026-08-05T11:00:00.000-04:00",
      "2026-08-05T13:30:00.000-04:00",
    ),
    "Wednesday, Aug 5 · 11:00 am–1:30 pm",
  );
});

test("formatWhenRange drops an overnight or missing end instead of misdating it", () => {
  // Wall times cross midnight: Sep 9 6pm → Sep 10 1am.
  assert.equal(
    formatWhenRange(
      "2026-09-09T18:00:00.000-04:00",
      "2026-09-10T01:00:00.000-04:00",
    ),
    "Wednesday, Sep 9 · 6:00 pm",
  );
  assert.equal(
    formatWhenRange("2026-09-09T22:00:00.000Z", null, "America/New_York"),
    "Wednesday, Sep 9 · 6:00 pm",
  );
});

test("formatWhenRange degrades on junk input", () => {
  assert.equal(formatWhenRange(null, null), null);
  assert.equal(formatWhenRange("not a date", null), null);
});

test("nextUpcoming picks the soonest entry that hasn't ended", () => {
  const now = new Date("2026-08-18T19:00:00Z");
  const events = [
    { name: "Later", startAt: "2026-09-01T22:00:00Z" },
    {
      name: "Soonest",
      startAt: "2026-08-20T00:30:00Z",
      endAt: "2026-08-20T04:00:00Z",
    },
    {
      name: "Past",
      startAt: "2026-08-10T22:00:00Z",
      endAt: "2026-08-11T01:00:00Z",
    },
    { name: "Undated" },
  ];
  assert.equal(nextUpcoming(events, now).name, "Soonest");
});

test("nextUpcoming: an in-progress event still counts; an ended one doesn't", () => {
  const now = new Date("2026-08-18T19:00:00Z");
  const live = [
    {
      name: "Running",
      startAt: "2026-08-18T18:00:00Z",
      endAt: "2026-08-18T21:00:00Z",
    },
  ];
  assert.equal(nextUpcoming(live, now).name, "Running");
  const ended = [
    {
      name: "Done",
      startAt: "2026-08-18T15:00:00Z",
      endAt: "2026-08-18T18:00:00Z",
    },
  ];
  assert.equal(nextUpcoming(ended, now), null);
  // No end date: the start is the deadline instead.
  const startOnly = [{ name: "Started", startAt: "2026-08-18T15:00:00Z" }];
  assert.equal(nextUpcoming(startOnly, now), null);
});

test("nextUpcoming: empty / all-past / junk lists yield null", () => {
  const now = new Date("2026-08-18T19:00:00Z");
  assert.equal(nextUpcoming([], now), null);
  assert.equal(nextUpcoming(null, now), null);
  assert.equal(nextUpcoming([{ name: "Undated" }], now), null);
  assert.equal(nextUpcoming([{ startAt: "garbage" }], now), null);
});

test("upcomingEvents keeps not-ended entries, soonest first, undated last", () => {
  const now = new Date("2026-08-18T19:00:00Z");
  const events = [
    { name: "Later", startAt: "2026-09-01T22:00:00Z" },
    {
      name: "Soonest",
      startAt: "2026-08-20T00:30:00Z",
      endAt: "2026-08-20T04:00:00Z",
    },
    {
      name: "Running", // in-progress still counts, like nextUpcoming
      startAt: "2026-08-18T18:00:00Z",
      endAt: "2026-08-18T21:00:00Z",
    },
    {
      name: "Past",
      startAt: "2026-08-10T22:00:00Z",
      endAt: "2026-08-11T01:00:00Z",
    },
    { name: "Undated" },
  ];
  assert.deepEqual(
    upcomingEvents(events, now).map((e) => e.name),
    ["Running", "Soonest", "Later", "Undated"],
  );
  // The input array is not mutated in place.
  assert.equal(events[0].name, "Later");
});

test("upcomingEvents: ended-at-now and start-only-past entries drop", () => {
  const now = new Date("2026-08-18T19:00:00Z");
  // End exactly now is no longer upcoming (same strict rule as nextUpcoming).
  assert.deepEqual(
    upcomingEvents(
      [
        {
          name: "Ends now",
          startAt: "2026-08-18T17:00:00Z",
          endAt: "2026-08-18T19:00:00Z",
        },
      ],
      now,
    ),
    [],
  );
  // No end date: the start stands in for it, so a started event is over.
  assert.deepEqual(
    upcomingEvents([{ name: "Started", startAt: "2026-08-18T15:00:00Z" }], now),
    [],
  );
});

test("upcomingEvents: unreadable start drops when the end is already past", () => {
  const now = new Date("2026-08-18T19:00:00Z");
  // Start unreadable but the end says it is over — not upcoming.
  assert.deepEqual(
    upcomingEvents(
      [{ name: "Over", startAt: null, endAt: "2026-08-17T22:00:00Z" }],
      now,
    ),
    [],
  );
  // Start unreadable, end still ahead — kept, and sorted after the dated one.
  assert.deepEqual(
    upcomingEvents(
      [
        {
          name: "Undated but running",
          startAt: "",
          endAt: "2026-08-19T02:00:00Z",
        },
        { name: "Dated", startAt: "2026-08-18T20:00:00Z" },
      ],
      now,
    ).map((e) => e.name),
    ["Dated", "Undated but running"],
  );
  // Neither field readable — kept, as before.
  assert.deepEqual(
    upcomingEvents([{ name: "Unknown", startAt: null, endAt: null }], now).map(
      (e) => e.name,
    ),
    ["Unknown"],
  );
});

test("upcomingEvents: empty / null input yields an empty list", () => {
  const now = new Date("2026-08-18T19:00:00Z");
  assert.deepEqual(upcomingEvents([], now), []);
  assert.deepEqual(upcomingEvents(null, now), []);
});

test("daysOut counts calendar days in the event's own timezone", () => {
  // 2026-08-21T00:30Z is Aug 20 wall time in Los Angeles — the venue's day
  // boundary, not the UTC one, is what the chip counts.
  const start = "2026-08-21T00:30:00.000Z";
  assert.equal(
    daysOut(start, "America/Los_Angeles", new Date("2026-08-18T19:00:00Z")),
    2,
  );
  assert.equal(
    daysOut(start, "America/Los_Angeles", new Date("2026-08-19T19:00:00Z")),
    1,
  );
  assert.equal(
    daysOut(start, "America/Los_Angeles", new Date("2026-08-20T19:00:00Z")),
    0,
  );
});

test("daysOut agrees with the card line on offset-bearing starts", () => {
  // No event timezone (external-platform entry): the chip must count from
  // the offset in the string, not the device zone, or it can read
  // "Tomorrow" under a line that says tonight.
  const start = "2026-08-19T23:00:00-04:00";
  assert.match(
    formatWhenRange(start, null, null),
    /Wednesday, Aug 19 · 11:00 pm/,
  );
  assert.equal(daysOut(start, null, new Date("2026-08-19T20:00:00Z")), 0);
  assert.equal(daysOut(start, null, new Date("2026-08-19T02:00:00Z")), 1);
});

test("daysOut degrades on junk input", () => {
  assert.equal(daysOut(null, "America/New_York"), null);
  assert.equal(daysOut("not a date", "America/New_York"), null);
  assert.equal(daysOut("2026-08-21T00:30:00.000Z", "Not/AZone"), null);
});

test("daysOutLabel clamps an in-progress overnight event to Today", () => {
  // Started 8:00 pm, ends 1:00 am — at 00:30 the chip must not read "-1
  // days out" above a line showing yesterday's date.
  const start = "2026-08-19T20:00:00-04:00";
  assert.equal(
    daysOutLabel(start, "America/New_York", new Date("2026-08-20T04:30:00Z")),
    "Today",
  );
  assert.equal(
    daysOutLabel(start, "America/New_York", new Date("2026-08-19T18:00:00Z")),
    "Today",
  );
  assert.equal(
    daysOutLabel(start, "America/New_York", new Date("2026-08-18T18:00:00Z")),
    "Tomorrow",
  );
  assert.equal(
    daysOutLabel(start, "America/New_York", new Date("2026-08-16T18:00:00Z")),
    "3 days out",
  );
  assert.equal(daysOutLabel("not a date", "America/New_York"), null);
});
