// Automatic backup of the contact book to user-visible shared storage
// (docs/adr/0009-automatic-contact-backup.md). The book lives in
// localStorage, which an uninstall or an "app data clear" wipes — that
// wipe cost the captain a contact, and Android's own cloud backup stays
// deliberately off. So the app writes its own copy into
// Downloads/BGN Coordinator/ through the `BgnBackup` bridge in
// MainActivity.kt (MediaStore, API 29+, no permission and no network):
// still on the device, still nothing sent anywhere, but now it survives a
// reinstall and the coordinator can see and copy the file themselves.
//
// Everything here is fire-and-forget: no bridge (bare-browser dev, older
// Android) or a storage failure means no backup this time, never a broken
// contact save.

// bgn-contacts-YYYY-MM-DD-HHmm.json — dated, so plain name order is also
// newest-last order.
export const FILE_RE = /^bgn-contacts-\d{4}-\d{2}-\d{2}-\d{4}\.json$/;

// How many dated copies to keep; older ones are pruned after each write.
export const KEEP = 5;

const pad = (n) => String(n).padStart(2, "0");

export function backupName(d) {
  return (
    `bgn-contacts-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}.json`
  );
}

const dated = (names) => (names ?? []).filter((n) => FILE_RE.test(n)).sort();

// The backups to delete after a write: everything older than the newest
// `keep`. Files that aren't ours are never touched.
export function toPrune(names, keep = KEEP) {
  return dated(names).slice(0, -keep);
}

// Of those, the ones actually safe to delete (captain decision, ADR 0009):
// a backup holding MORE contacts than the book being written survives past
// the keep window. Without that, a data clear followed by "Not now" and a
// handful of saves rotates the whole pre-wipe book off the device — the
// exact incident this feature exists to prevent. `countOf` reads a backup's
// contact count (0 when it is unreadable, so junk still gets cleaned up);
// only the window's leftovers are ever asked about.
export function prunable(names, size, countOf, keep = KEEP) {
  return toPrune(names, keep).filter((n) => countOf(n) <= size);
}

const newestFirst = (names) => dated(names).reverse();

// A contact's identity for dedupe: everything the coordinator typed. The
// timestamp is deliberately out — the same contact backed up and re-imported
// is one contact, not two.
const keyOf = (c) => JSON.stringify([c.name, c.email, c.phone, c.notes, c.tag]);

// Fold a backup's entries into the book. An import can only ADD: an entry
// identical to one already in the book is dropped, and nothing already in
// the book is ever overwritten by the file — the in-app copy always wins.
// Result stays newest-first, the order the saved list renders.
export function mergeContacts(current, incoming) {
  const seen = new Set(current.map(keyOf));
  const added = [];
  for (const c of incoming ?? []) {
    if (!c?.name || seen.has(keyOf(c))) continue;
    seen.add(keyOf(c));
    added.push({ ...c, ts: Number(c.ts) || Date.now() });
  }
  return [...current, ...added].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
}

// The contract the saved list renders against (rowOf in contacts.js): a
// name to show and a tag to take the emoji from, both strings. The picker
// hands us any file the coordinator taps, so a near-miss — a hand-edited
// backup with the tag stripped, an unrelated export that happens to carry
// names — must be rejected here rather than persisted into the book and
// then written back out over the good backups.
const isContact = (c) =>
  typeof c?.name === "string" && c.name !== "" && typeof c.tag === "string";

// A backup file's text -> the contact array, or null when it is not one.
export function parseBackup(text) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) && v.every(isContact) ? v : null;
  } catch {
    return null;
  }
}

// Signup snapshots deliberately use their own versioned envelope and names.
// Legacy contact arrays/readers remain untouched. Never reuse a name: even
// two saves in one millisecond must preserve the previous recovery snapshot.
import { isValidEmail } from "./parse.js";

const validAddress = (s) => typeof s === "string" && isValidEmail(s);
export const validSignups = (queue) =>
  Array.isArray(queue) &&
  queue.every(
    (it) =>
      it &&
      typeof it === "object" &&
      ["name", "source"].every(
        (key) => it[key] === undefined || typeof it[key] === "string",
      ) &&
      (it.kind === "one"
        ? validAddress(it.email)
        : it.kind === "batch" &&
          Array.isArray(it.emails) &&
          it.emails.length > 0 &&
          it.emails.every(validAddress)),
  );

export function parseSignupBackup(text) {
  try {
    if (
      typeof text !== "string" ||
      new TextEncoder().encode(text).length > 1024 * 1024
    )
      return null;
    const value = JSON.parse(text);
    return value?.type === "bgn-signups" &&
      value.version === 1 &&
      validSignups(value.queue)
      ? value.queue
      : null;
  } catch {
    return null;
  }
}

const addressKey = (email) => email.trim().toLowerCase();
const addressesIn = (queue) =>
  queue.flatMap((it) => (it.kind === "batch" ? it.emails : [it.email]));
export function mergeSignups(current, incoming) {
  if (!validSignups(current) || !validSignups(incoming))
    throw new Error("Invalid signup queue; nothing imported.");
  const seen = new Set(addressesIn(current).map(addressKey));
  const result = [...current];
  for (const it of incoming) {
    const emails = addressesIn([it]).filter((email) => {
      const key = addressKey(email);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (emails.length)
      result.push(it.kind === "batch" ? { ...it, emails } : { ...it });
  }
  return result;
}

export function readNewestSignupBackup() {
  try {
    const b = bridge();
    if (!b) return null;
    for (const name of signupNames(JSON.parse(b.list())).reverse()) {
      const queue = parseSignupBackup(b.read(name));
      if (queue) return { name, queue };
    }
  } catch {
    /* Unavailable storage. */
  }
  return null;
}

const SIGNUP_RE = /^bgn-signups-\d{13}-\d+\.json$/;
const signupNames = (names) =>
  names
    .filter((n) => SIGNUP_RE.test(n))
    .sort((a, b) => {
      const [, , timeA, seqA] = a.replace(".json", "").split("-");
      const [, , timeB, seqB] = b.replace(".json", "").split("-");
      return Number(timeA) - Number(timeB) || Number(seqA) - Number(seqB);
    });
const signupFacts = (queue) =>
  queue.flatMap((it) =>
    addressesIn([it]).map((email) =>
      JSON.stringify([addressKey(email), it.name ?? "", it.source ?? ""]),
    ),
  );
export function writeSignupBackup(queue) {
  try {
    const b = bridge();
    if (!b || !validSignups(queue)) return;
    const names = signupNames(JSON.parse(b.list()));
    // Logical time keeps saves newest even after clock rollback or a restart.
    const previousTime = Number(names.at(-1)?.split("-")[2] ?? 0);
    const time = Math.max(Date.now(), previousTime + 1);
    const name = `bgn-signups-${time}-0.json`;
    const text = JSON.stringify({ type: "bgn-signups", version: 1, queue });
    if (!parseSignupBackup(text) || b.write(name, text)) return;
    // Readback protects recovery even if a bridge reports a partial write as success.
    if (b.read(name) !== text) return;
    const covered = new Set(signupFacts(queue));
    // Only pre-existing files are candidates; keep this save plus KEEP - 1 old.
    for (const old of names.slice(0, 1 - KEEP)) {
      const previous = parseSignupBackup(b.read(old));
      if (previous && signupFacts(previous).every((fact) => covered.has(fact)))
        b.remove(old);
    }
  } catch {
    // Best effort, same on-device bridge as contacts.
  }
}

/* ------------------------------ the bridge ------------------------------ */

const bridge = () => globalThis.BgnBackup ?? null;

const countIn = (b, name) => parseBackup(b.read(name))?.length ?? 0;

// Write a dated copy and prune the old ones. Never throws. An empty book is
// never written: a launch or a clear-out must not push the real backups out
// of the keep window — the n=0 case of the same rule `prunable` enforces for
// every smaller book.
//
// Nothing is ever pruned except after a CONFIRMED write. The bridge reports
// failure by returning a token ("unsupported", "insert-failed", ...) rather
// than throwing, so a full disk would otherwise delete a real backup with
// nothing written to replace it — precisely the loss this exists to prevent.
export function writeBackup(contacts) {
  try {
    const b = bridge();
    if (!b || !contacts?.length) return;
    if (b.write(backupName(new Date()), JSON.stringify(contacts))) return;
    const names = JSON.parse(b.list());
    for (const name of prunable(names, contacts.length, (n) => countIn(b, n)))
      b.remove(name);
  } catch {
    // Shared storage unavailable — a contact save must not care.
  }
}

// The newest READABLE backup on disk as { name, contacts }, or null. A kill
// between MediaStore's insert and the stream write leaves a zero-byte file
// that is newest by name, and that moment is a wipe-adjacent one — so walk
// back through the older copies rather than dropping the offer entirely.
export function readNewestBackup() {
  try {
    const b = bridge();
    if (!b) return null;
    for (const name of newestFirst(JSON.parse(b.list()))) {
      const contacts = parseBackup(b.read(name));
      if (contacts?.length) return { name, contacts };
    }
    return null;
  } catch {
    return null;
  }
}

// The explicit import: Android's own file picker, so a backup the app can no
// longer see (a reinstall drops MediaStore ownership) is still reachable.
// Resolves to the contact array, or null when cancelled or unreadable.
export const pickSignupBackup = () => pickBackup(parseSignupBackup);

export function pickBackup(parse = parseBackup) {
  return new Promise((resolve) => {
    const b = bridge();
    if (!b?.pick) return resolve(null);
    globalThis.__bgnBackupPicked = (text) => {
      delete globalThis.__bgnBackupPicked;
      resolve(text == null ? null : parse(text));
    };
    try {
      b.pick();
    } catch {
      delete globalThis.__bgnBackupPicked;
      resolve(null);
    }
  });
}
