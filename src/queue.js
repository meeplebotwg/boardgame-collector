// Device-local capture queue for mailing-list adds (ADR 0005).
//
// Submit at the door = enqueue + optimistic confirm: addresses queue on this
// device with zero member action and no network. The coordinator later drains
// them in Google Groups' own owner UI (the drain screen in src/screens.js
// presents copy-ready blocks; marking a batch drained clears it here). The
// app never sends or writes anything itself. localStorage survives app
// restarts, so everything captured offline is still queued at home.

import { writeSignupBackup, validSignups, mergeSignups } from "./backup.js";

const KEY = "bgn.adds.v1";
const DRAIN_KEY = "bgn.drainlog.v1";

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
}

function save(queue) {
  localStorage.setItem(KEY, JSON.stringify(queue));
  setTimeout(() => writeSignupBackup(queue), 0);
}

function readableQueue() {
  const value = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  if (!validSignups(value))
    throw new Error("Unreadable local signup queue; nothing changed.");
  return value;
}

export function importSignups(incoming) {
  const current = readableQueue();
  const merged = mergeSignups(current, incoming);
  const count = (queue) =>
    queue.reduce(
      (n, it) => n + (it.kind === "batch" ? it.emails.length : 1),
      0,
    );
  const added = count(merged) - count(current);
  if (added) save(merged);
  return added;
}

export function backupSignups() {
  try {
    writeSignupBackup(readableQueue());
  } catch {
    /* Preserve unreadable local data. */
  }
}

export function enqueue(intent) {
  const next = [...readableQueue(), intent];
  if (!validSignups(next)) throw new Error("Invalid signup; nothing queued.");
  save(next);
}

// Every queued address, flat, in capture (FIFO) order.
export function pendingAddresses() {
  return load().flatMap((it) => (it.kind === "batch" ? it.emails : [it.email]));
}

// Defensive cap per presented drain batch. Google's Add members dialog shows
// no visible address-count limit (captain-verified on the live group,
// 2026-08-18), but the community-reported owner throttle is ~100 adds/day
// with 24h+ recovery — never present a mega-batch that could trip it
// mid-paste. The remainder stays queued for the next batch.
export const DRAIN_LIMIT = 100;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function drainLog() {
  try {
    const rec = JSON.parse(localStorage.getItem(DRAIN_KEY));
    if (rec?.day === today()) return rec;
  } catch {
    // unreadable record: fall through to a fresh day
  }
  return { day: today(), n: 0 };
}

// Adds already marked drained today. This device's own tally — adds done
// elsewhere aren't counted, and the batch cap stays defensive either way.
export function drainedToday() {
  return drainLog().n;
}

export const remainingToday = () => Math.max(0, DRAIN_LIMIT - drainedToday());

// The batch the drain screen presents: the FIFO head, capped at what's left
// of today's budget (empty once the budget is used up — drain the rest tomorrow).
export const nextBatch = () => pendingAddresses().slice(0, remainingToday());

// The coordinator pasted this batch into Google's UI and submitted: drop one
// occurrence of each address (FIFO) and count what was actually removed
// against today's budget.
export function markDrained(emails) {
  const left = [...emails];
  const next = [];
  for (const it of readableQueue()) {
    if (it.kind === "batch") {
      const keep = it.emails.filter((e) => {
        const i = left.indexOf(e);
        if (i === -1) return true;
        left.splice(i, 1);
        return false;
      });
      if (keep.length) next.push({ ...it, emails: keep });
    } else {
      const i = left.indexOf(it.email);
      if (i === -1) next.push(it);
      else left.splice(i, 1);
    }
  }
  save(next);
  const rec = drainLog();
  rec.n += emails.length - left.length;
  localStorage.setItem(DRAIN_KEY, JSON.stringify(rec));
}
