// Only facts carried by the coordinator's selected calendar event belong
// in templates. Missing facts are omitted, never replaced with sample copy.
import { formatWhenRange } from "./luma.js";

export const validAttendance = (value) =>
  /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value));

export function eventDraft(template, event, attendance) {
  if (!event) return "";
  if (template === "recap") {
    if (!validAttendance(attendance)) return "";
    return `Subject: Recap${event.name ? ` — ${event.name}` : ""}\n\nThanks for joining${event.name ? ` ${event.name}` : " us"}. ${Number(attendance)} attendees came out.`;
  }
  return [
    `Subject: ${template === "announce" ? "New event" : "Reminder"}${event.name ? ` — ${event.name}` : ""}`,
    "",
    event.name,
    formatWhenRange(event.startAt, event.endAt, event.timezone),
    event.venue,
    Number.isInteger(event.guestCount) &&
    event.guestCount >= 0 &&
    !event.hideRsvp
      ? `${event.guestCount} RSVPs (last-known calendar count).`
      : null,
    event.url,
  ]
    .filter((line) => line != null)
    .join("\n");
}
