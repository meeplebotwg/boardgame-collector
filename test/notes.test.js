// General notes (docs/adr/0011): the scratchpad is device-local, newest
// first, survives kill/relaunch, and gets the signup-style dated backup
// treatment — monotonic names, readback verification, covered-set pruning.
// Every note here is fabricated and the shared-storage bridge is a stub, so
// nothing touches the filesystem or the network.

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNotesBackup,
  mergeNotes,
  writeNotesBackup,
  readNewestNotesBackup,
  KEEP,
  pickNotesBackup,
  pickBackup,
  pickSignupBackup,
} from "../src/backup.js";
import {
  saveNote,
  editNote,
  deleteNote,
  listNotes,
  importNotes,
  backupNotes,
} from "../src/notes.js";

const store = new Map();
const files = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
};

const bridgeOk = {
  write: (name, text) => {
    files.set(name, text);
    return null;
  },
  list: () => JSON.stringify([...files.keys()]),
  read: (name) => files.get(name) ?? null,
  remove: (name) => files.delete(name),
};

// Fresh stubs per test; the bridge defaults to absent so store tests never
// race their fire-and-forget setTimeout backups into the files map.
const reset = (bridge = null) => {
  store.clear();
  files.clear();
  globalThis.BgnBackup = bridge;
};

const wrap = (notes) =>
  JSON.stringify({ type: "bgn-notes", version: 1, notes });

const noteNames = () =>
  [...files.keys()].filter((n) => n.startsWith("bgn-notes-")).sort();

// Deterministic clock for ordering/naming tests (13-digit epoch ms so the
// backup names stay shape-valid).
const withClock = (start, fn) => {
  const real = Date.now;
  let clock = start;
  Date.now = () => clock;
  const advance = (ms) => (clock += ms);
  try {
    fn(advance, () => clock);
  } finally {
    Date.now = real;
  }
};

test("notes store trims, refuses empty, and keeps newest first", () => {
  reset();
  withClock(1_700_000_000_000, (advance) => {
    assert.equal(saveNote("   "), null);
    assert.equal(saveNote(""), null);
    assert.equal(saveNote(null), null);
    const a = saveNote("  Table 4 needed a second rules copy  ");
    assert.equal(a.text, "Table 4 needed a second rules copy");
    advance(1000);
    const b = saveNote("Venue contact wants setup by 6pm");
    assert.deepEqual(
      listNotes().map((n) => n.text),
      [
        "Venue contact wants setup by 6pm",
        "Table 4 needed a second rules copy",
      ],
    );
    assert.ok(a.id !== b.id);
  });
});

test("malformed local notes cannot break Home or overwrite recovery on launch", () => {
  reset(bridgeOk);
  for (const raw of [
    "{}",
    "42",
    '"wrong"',
    "[null]",
    '[{"id":"x","text":42}]',
  ]) {
    store.set("bgn.notes.v1", raw);
    assert.deepEqual(listNotes(), []);
    backupNotes();
  }
  assert.equal(noteNames().length, 0);
});

test("mutations refuse unreadable existing notes instead of overwriting them", () => {
  reset();
  for (const raw of [
    "{",
    "null",
    "{}",
    '[{"id":"keep","text":"SYNTHETIC valid"},null]',
  ]) {
    store.set("bgn.notes.v1", raw);
    for (const mutate of [
      () => saveNote("SYNTHETIC new"),
      () => editNote("keep", "SYNTHETIC edit"),
      () => deleteNote("keep"),
      () => importNotes([{ id: "import", text: "SYNTHETIC import", ts: 1 }]),
    ]) {
      assert.throws(mutate, /read/i);
      assert.equal(store.get("bgn.notes.v1"), raw);
    }
  }
  const getter = localStorage.getItem;
  localStorage.getItem = () => {
    throw new Error("SYNTHETIC read failure");
  };
  try {
    assert.throws(() => saveNote("SYNTHETIC new"), /read/i);
  } finally {
    localStorage.getItem = getter;
  }
});

test("notes imports refuse blank text and invalid timestamps", () => {
  for (const note of [
    { id: "x", text: " \n " },
    { id: "x", text: "ok", ts: -1 },
    { id: "x", text: "ok", ts: 9e15 },
  ])
    assert.equal(parseNotesBackup(wrap([note])), null);
  assert.equal(
    parseNotesBackup(
      '{"type":"bgn-notes","version":1,"notes":[{"id":"x","text":"ok","ts":1e999}]}',
    ),
    null,
  );
});

test("note ids stay unique across rapid same-millisecond saves", () => {
  reset();
  withClock(1_700_000_000_000, () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(saveNote(`note ${i}`).id);
    assert.equal(ids.size, 50);
  });
});

test("notes persist across a relaunch (fresh read of the same storage)", () => {
  reset();
  saveNote("Brought two spare decks");
  const raw = JSON.parse(store.get("bgn.notes.v1"));
  assert.equal(raw.length, 1);
  assert.equal(raw[0].text, "Brought two spare decks");
  assert.deepEqual(
    listNotes().map((n) => n.text),
    ["Brought two spare decks"],
  );
});

test("edit refuses empty, resurfaces the note newest-first, and ignores unknown ids", () => {
  reset();
  withClock(1_700_000_000_000, (advance) => {
    const a = saveNote("First");
    advance(1000);
    saveNote("Second");
    advance(1000);
    assert.equal(editNote(a.id, "  "), null);
    assert.equal(editNote("missing", "x"), null);
    const edited = editNote(a.id, "First, revised");
    assert.equal(edited.text, "First, revised");
    assert.deepEqual(
      listNotes().map((n) => n.text),
      ["First, revised", "Second"],
    );
    assert.equal(listNotes().length, 2);
  });
});

test("a rapid edit resurfaces even when saves share the same millisecond", () => {
  reset();
  withClock(1_700_000_000_000, () => {
    const first = saveNote("SYNTHETIC first");
    saveNote("SYNTHETIC second");
    editNote(first.id, "SYNTHETIC revised");
    assert.equal(listNotes()[0].id, first.id);
  });
});

test("delete removes exactly the tapped note and reports repeats", () => {
  reset();
  const a = saveNote("Keep");
  const b = saveNote("Drop");
  assert.equal(deleteNote(b.id), true);
  assert.equal(deleteNote(b.id), false);
  assert.deepEqual(
    listNotes().map((n) => n.id),
    [a.id],
  );
});

test("every store mutation fires one dated backup through the bridge", async () => {
  // Flush the earlier store tests' pending fire-and-forget timers while the
  // bridge is still absent, so this test counts only its own backup write.
  await new Promise((r) => setTimeout(r, 10));
  reset(bridgeOk);
  saveNote("Door count 41");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(noteNames().length, 1);
  assert.match(noteNames()[0], /^bgn-notes-\d{13}-\d+\.json$/);
  assert.deepEqual(
    parseNotesBackup(files.get(noteNames()[0])).map((n) => n.text),
    ["Door count 41"],
  );
});

test("parseNotesBackup accepts the envelope and rejects everything else", () => {
  const good = [{ id: "1-a", text: "Setup by six", ts: 1_700_000_000_000 }];
  assert.deepEqual(parseNotesBackup(wrap(good)), good);
  for (const text of [
    "{",
    "null",
    "[]",
    JSON.stringify({ type: "bgn-signups", version: 1, notes: good }),
    wrap(good).replace('"version":1', '"version":2'),
    wrap("not an array"),
    wrap([null]),
    wrap([{ id: "", text: "x" }]),
    wrap([{ id: "1", text: "" }]),
    wrap([{ text: "no id" }]),
    wrap([{ id: "1", text: "x", ts: "yesterday" }]),
    wrap([{ id: 42, text: "x" }]),
  ])
    assert.equal(parseNotesBackup(text), null, text);
  assert.equal(parseNotesBackup(null), null);
  // Oversized files are refused before parsing, same ceiling as signups.
  assert.equal(
    parseNotesBackup(wrap([{ id: "1", text: "x".repeat(1024 * 1024) }])),
    null,
  );
});

test("mergeNotes only adds, dedupes by id, and the in-app copy wins", () => {
  const current = [{ id: "a", text: "In-app wins", ts: 2 }];
  const incoming = [
    { id: "a", text: "Stale copy", ts: 5 },
    { id: "b", text: "Recovered", ts: 1 },
    { id: "b", text: "Recovered twice", ts: 3 },
  ];
  assert.deepEqual(mergeNotes(current, incoming), [
    { id: "a", text: "In-app wins", ts: 2 },
    { id: "b", text: "Recovered", ts: 1 },
  ]);
  assert.throws(() => mergeNotes(current, "junk"));
  assert.throws(() => mergeNotes("junk", current));
});

test("importNotes folds a backup into the store and counts real adds", () => {
  reset();
  const mine = saveNote("Fresh");
  const added = importNotes([
    { id: mine.id, text: "ignored duplicate", ts: Date.now() },
    { id: "old-1", text: "From backup", ts: 1 },
  ]);
  assert.equal(added, 1);
  assert.deepEqual(
    listNotes().map((n) => n.text),
    ["Fresh", "From backup"],
  );
});

test("writeNotesBackup is inert without a bridge and on invalid input", () => {
  reset(null);
  assert.doesNotThrow(() => writeNotesBackup([{ id: "1", text: "x", ts: 1 }]));
  reset(bridgeOk);
  writeNotesBackup("junk");
  writeNotesBackup([{ id: "", text: "x" }]);
  assert.equal(noteNames().length, 0);
});

test("backup names stay monotonic even under clock rollback", () => {
  reset(bridgeOk);
  const seeded = "bgn-notes-1700000000000-0.json";
  files.set(seeded, wrap([{ id: "f", text: "future save", ts: 1 }]));
  withClock(1_600_000_000_000, () => {
    writeNotesBackup([{ id: "n", text: "rollback save", ts: 2 }]);
  });
  const names = noteNames();
  assert.equal(names.length, 2);
  const written = names[1];
  assert.equal(Number(written.split("-")[2]), 1700000000001);
  assert.deepEqual(parseNotesBackup(files.get(written)), [
    { id: "n", text: "rollback save", ts: 2 },
  ]);
});

test("a failed readback stops the write before any pruning", () => {
  const badReadback = {
    ...bridgeOk,
    read: () => "not what was written",
  };
  reset(badReadback);
  const oldName = `bgn-notes-${Date.now() - 10_000}-0.json`;
  files.set(oldName, wrap([{ id: "old", text: "old note", ts: 1 }]));
  writeNotesBackup([{ id: "new", text: "new note", ts: 2 }]);
  assert.ok(files.has(oldName), "readback failure must not prune");
});

test("pruning keeps the newest window and never drops uncovered notes", () => {
  // Covered duplicates: the oldest rotates off once the window is full.
  reset(bridgeOk);
  withClock(1_700_000_000_000, (advance) => {
    const covered = { id: "c1", text: "same text", ts: 100 };
    for (let i = 0; i < KEEP; i++) {
      advance(1000);
      files.set(`bgn-notes-${Date.now()}-0.json`, wrap([covered]));
    }
    writeNotesBackup([covered]);
    const left = noteNames();
    assert.equal(left.length, KEEP); // this save plus KEEP - 1 old
    assert.ok(!files.has(`bgn-notes-1700000001000-0.json`)); // oldest gone
  });

  // A snapshot holding the PRE-edit text of a note is not covered by the
  // post-edit book, so it survives past the window — the ADR 0009 rule.
  reset(bridgeOk);
  withClock(1_700_000_000_000, (advance) => {
    const preEdit = `bgn-notes-${Date.now()}-0.json`;
    files.set(preEdit, wrap([{ id: "c1", text: "pre-edit text", ts: 90 }]));
    for (let i = 0; i < KEEP; i++) {
      advance(1000);
      files.set(
        `bgn-notes-${Date.now()}-0.json`,
        wrap([{ id: "c1", text: "same text", ts: 100 }]),
      );
    }
    writeNotesBackup([{ id: "c1", text: "same text", ts: 100 }]);
    assert.ok(files.has(preEdit), "uncovered backup must survive");
  });
});

test("empty launches cannot mask recovery, including legacy empty snapshots", async () => {
  await new Promise((r) => setTimeout(r, 10));
  reset(bridgeOk);
  const old = "bgn-notes-1700000000000-0.json";
  files.set(old, wrap([{ id: "recover", text: "SYNTHETIC recover", ts: 1 }]));
  backupNotes();
  backupNotes();
  assert.deepEqual(noteNames(), [old]);
  files.set("bgn-notes-1700000000001-0.json", wrap([]));
  assert.equal(readNewestNotesBackup().name, old);
});

test("shared picker cannot steal an outstanding callback across backup types", async () => {
  reset({ ...bridgeOk, pick() {} });
  const pending = pickNotesBackup();
  const callback = globalThis.__bgnBackupPicked;
  const blockedContact = pickBackup();
  assert.equal(
    globalThis.__bgnBackupPicked,
    callback,
    "a second picker must not replace the first callback",
  );
  assert.equal(await blockedContact, null);
  assert.equal(await pickSignupBackup(), null);
  callback(wrap([{ id: "picked", text: "SYNTHETIC picked", ts: 1 }]));
  assert.equal((await pending)[0].id, "picked");
  const contact = pickBackup();
  globalThis.__bgnBackupPicked('[{"name":"SYNTHETIC contact","tag":"Venue"}]');
  assert.equal((await contact)[0].name, "SYNTHETIC contact");
  const signup = pickSignupBackup();
  globalThis.__bgnBackupPicked(
    '{"type":"bgn-signups","version":1,"queue":[{"kind":"one","email":"synthetic@example.org"}]}',
  );
  assert.equal((await signup)[0].email, "synthetic@example.org");
});

test("readNewestNotesBackup skips unreadable and foreign files", () => {
  reset(bridgeOk);
  files.set("bgn-contacts-2026-09-09-2145.json", "[not notes]");
  files.set("bgn-signups-1700000000000-0.json", '{"type":"bgn-signups"}');
  files.set("bgn-notes-1700000000002-0.json", ""); // zero-byte mid-write kill
  files.set(
    "bgn-notes-1700000000001-0.json",
    wrap([{ id: "r", text: "readable", ts: 1 }]),
  );
  const found = readNewestNotesBackup();
  assert.equal(found.name, "bgn-notes-1700000000001-0.json");
  assert.deepEqual(found.notes, [{ id: "r", text: "readable", ts: 1 }]);
  reset(null);
  assert.equal(readNewestNotesBackup(), null);
});
