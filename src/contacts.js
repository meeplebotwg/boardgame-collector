// Private on-device contact capture, deliberately separate from mailing signups.
// Saving never sends. Explicit Home → Send to Meeple exports selected records
// through src/handoff.js (ADR 0010); backups stay on-device (ADR 0009).

import { writeBackup, mergeContacts } from "./backup.js";

const KEY = "bgn.contacts.v1";

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
}

function store(contacts) {
  localStorage.setItem(KEY, JSON.stringify(contacts));
  // Every change gets a dated copy in shared storage (docs/adr/0009);
  // fire-and-forget and off the interactive path, so neither a storage
  // failure nor a slow MediaStore hop ever costs the save.
  setTimeout(() => writeBackup(contacts), 0);
}

// Newest first, matching how the saved list renders.
export function saveContact(c) {
  store([{ ...c, ts: Date.now() }, ...load()]);
}

// Fold a backup file's entries in (docs/adr/0009). Returns how many were
// actually added — an import only ever adds (see mergeContacts).
export function importContacts(incoming) {
  const before = load();
  const merged = mergeContacts(before, incoming);
  store(merged);
  return merged.length - before.length;
}

export function listContacts() {
  return load();
}

// Row model for the saved list: the emoji is the tag's leading token; the
// second line falls back notes → email → phone, so a phone-only contact
// still reads as something.
export function rowOf(c) {
  return {
    icon: c.tag.split(" ")[0],
    name: c.name,
    note: c.notes || c.email || c.phone || "",
  };
}
