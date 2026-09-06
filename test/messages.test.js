import { test } from "node:test";
import assert from "node:assert/strict";
import { eventDraft } from "../src/messages.js";

const event = {
  name: "SYNTHETIC Test Game Night",
  startAt: "2026-10-10T18:00:00Z",
  endAt: "2026-10-10T20:00:00Z",
  timezone: "UTC",
  venue: "SYNTHETIC Test Hall",
  url: "https://example.org/test-event",
  guestCount: 7,
};

test("reminder and announcement use only the selected event facts", () => {
  for (const template of ["reminder", "announce"]) {
    const draft = eventDraft(template, event);
    for (const text of [event.name, event.venue, event.url, "7 RSVPs", "Oct"])
      assert.ok(draft.includes(text), `${template}: ${text}`);
    assert.doesNotMatch(draft, /Aug 5|Cambridge|34|38|Free|Wingspan/);
  }
  assert.equal(eventDraft("reminder", null), "");
});

test("recap requires actual attendance, never substitutes RSVPs", () => {
  for (const count of [undefined, "", " ", "-1", "1.5", "abc", "Infinity"])
    assert.equal(eventDraft("recap", event, count), "");
  assert.match(eventDraft("recap", event, "0"), /0 attendees/);
  assert.match(eventDraft("recap", event, "12"), /12 attendees/);
  assert.doesNotMatch(eventDraft("recap", event, "12"), /RSVP|photos|next up/i);
  const sparse = eventDraft("announce", {
    name: "Only a name",
    hideRsvp: true,
    guestCount: 7,
  });
  assert.doesNotMatch(sparse, /undefined|null|Invalid|RSVP|Cambridge/);
});
