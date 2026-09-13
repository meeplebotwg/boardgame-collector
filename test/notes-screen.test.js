/* global document, window */
import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { render } from "../src/screens.js";
import { start, go } from "../src/router.js";
import { listNotes } from "../src/notes.js";

const wrap = (notes) =>
  JSON.stringify({ type: "bgn-notes", version: 1, notes });
const recovered = { id: "synthetic-old", text: "SYNTHETIC recovery", ts: 1000 };
const button = (text, root = document) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === text);
const tick = () => new Promise((r) => setTimeout(r, 10));
function setup(t, files = new Map()) {
  const { window } = parseHTML(
    '<html><body><div id="app"></div></body></html>',
  );
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.__APP_VERSION__ = "0.3.4";
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  globalThis.history = {
    replaceState() {},
    pushState() {},
    back: () => render("home"),
  };
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 503 }));
  t.mock.method(console, "warn", () => {});
  globalThis.BgnBackup = {
    list: () => JSON.stringify([...files.keys()]),
    read: (name) => files.get(name),
    write: (name, text) => {
      files.set(name, text);
      return null;
    },
    remove: (name) => files.delete(name),
    pick() {},
  };
  start(render);
  return { store, files };
}
function input(label, text) {
  const el = document.querySelector(`textarea[aria-label="${label}"]`);
  assert.ok(el, `${label} textarea exists`);
  el.value = text;
  el.dispatchEvent(new window.Event("input"));
}

test("Home notes restore counts real adds, preserves offer on storage failure, and Not now is session-only", async (t) => {
  const { store } = setup(
    t,
    new Map([["bgn-notes-1700000000000-0.json", wrap([recovered, recovered])]]),
  );
  assert.ok(button("Restore 1 note"), "empty notes offers recovery");
  assert.match(
    document.querySelector(".notes-restore").textContent,
    /bgn-notes-1700000000000-0.json/,
  );
  const setter = localStorage.setItem;
  localStorage.setItem = (k, v) => {
    if (k === "bgn.notes.v1") throw new Error("full");
    setter(k, v);
  };
  button("Restore 1 note").click();
  assert.match(
    document.querySelector(".notes-restore").textContent,
    /Could not restore/,
  );
  assert.equal(listNotes().length, 0);
  localStorage.setItem = setter;
  button("Restore 1 note").click();
  assert.deepEqual(listNotes(), [recovered]);
  assert.equal(document.querySelector(".notes-restore"), null);
  store.delete("bgn.notes.v1");
  render("home");
  button("Not now", document.querySelector(".notes-restore")).click();
  go("notes");
  button("Cancel").click();
  assert.equal(document.querySelector(".notes-restore"), null);
  await tick();
});

test("Home opens local multiline notes: trim, empty refusal, safe text and fresh-entry draft clearing", async (t) => {
  setup(t);
  const entry = [...document.querySelectorAll("button")].find((b) =>
    b.textContent.includes("Take a note"),
  );
  assert.ok(entry, "Home exposes Take a note");
  entry.click();
  assert.equal(document.querySelector("h1").textContent, "Notes");
  assert.match(document.body.textContent, /Nothing here is sent/);
  assert.match(document.body.textContent, /No notes yet/);
  input("Note", " \n ");
  assert.equal(button("Write a note first").disabled, true);
  input("Note", "  SYNTHETIC first\n<img src=x onerror=alert(1)>  ");
  button("Save note").click();
  assert.equal(
    listNotes()[0].text,
    "SYNTHETIC first\n<img src=x onerror=alert(1)>",
  );
  assert.equal(
    document.querySelector(".note-text").textContent,
    listNotes()[0].text,
  );
  assert.equal(document.querySelector("img"), null);
  assert.equal(document.querySelector('textarea[aria-label="Note"]').value, "");
  input("Note", "discard this draft");
  button("Cancel").click();
  go("notes");
  assert.equal(document.querySelector('textarea[aria-label="Note"]').value, "");
  assert.equal(listNotes().length, 1);
  await tick();
});

test("inline edit resurfaces notes; delete requires confirm and cancel keeps the note", async (t) => {
  const { store } = setup(t);
  store.set(
    "bgn.notes.v1",
    JSON.stringify([
      { id: "new", text: "SYNTHETIC newest", ts: 2000 },
      recovered,
    ]),
  );
  go("notes");
  const old = document.querySelectorAll(".note-card")[1];
  assert.ok(old, "notes render their own cards");
  button("Edit", old).click();
  input("Edit note", "  ");
  assert.equal(button("Write a note first", old).disabled, true);
  input("Edit note", "SYNTHETIC revised\nsecond line");
  button("Save changes", old).click();
  assert.equal(listNotes()[0].id, recovered.id);
  assert.equal(
    document.querySelector(".note-text").textContent,
    "SYNTHETIC revised\nsecond line",
  );
  button("Edit", document.querySelector(".note-card")).click();
  input("Edit note", "not saved");
  button("Cancel edit").click();
  assert.equal(listNotes()[0].text, "SYNTHETIC revised\nsecond line");
  button("Delete").click();
  assert.equal(listNotes().length, 2);
  assert.match(document.body.textContent, /Delete this note/);
  button("Keep note").click();
  assert.equal(listNotes().length, 2);
  button("Delete").click();
  button("Delete note").click();
  assert.deepEqual(
    listNotes().map((n) => n.id),
    ["new"],
  );
  await tick();
});

test("list refresh preserves other edit drafts across add, edit, delete and import", async (t) => {
  const { store } = setup(t);
  store.set(
    "bgn.notes.v1",
    JSON.stringify([
      recovered,
      { id: "other", text: "SYNTHETIC other", ts: 500 },
    ]),
  );
  go("notes");
  const first = document.querySelectorAll(".note-card")[0];
  const other = document.querySelectorAll(".note-card")[1];
  button("Edit", first).click();
  const draft = first.querySelector("textarea");
  draft.value = "SYNTHETIC keep this draft";
  const checkDraft = () => {
    assert.equal(draft.isConnected, true, "open draft must remain attached");
    assert.equal(draft.value, "SYNTHETIC keep this draft");
  };
  input("Note", "SYNTHETIC new");
  button("Save note").click();
  checkDraft();
  button("Edit", other).click();
  const secondDraft = other.querySelector("textarea");
  secondDraft.value = "SYNTHETIC revised other";
  secondDraft.dispatchEvent(new window.Event("input"));
  button("Save changes", other).click();
  checkDraft();
  button("Delete").click();
  button("Delete note").click();
  checkDraft();
  button("Import from a backup file").click();
  globalThis.__bgnBackupPicked(
    wrap([{ id: "import", text: "SYNTHETIC import", ts: 1 }]),
  );
  await tick();
  checkDraft();
  draft.dispatchEvent(new window.Event("input"));
  button("Save changes", first).click();
  assert.equal(
    listNotes().find((n) => n.id === recovered.id).text,
    "SYNTHETIC keep this draft",
  );
  await tick();
});

test("failed local writes keep add/edit drafts and delete confirmation without false success", async (t) => {
  const { store } = setup(t);
  store.set("bgn.notes.v1", JSON.stringify([recovered]));
  go("notes");
  input("Note", "SYNTHETIC unsaved");
  const setter = localStorage.setItem;
  localStorage.setItem = (k, v) => {
    if (k === "bgn.notes.v1") throw new Error("full");
    setter(k, v);
  };
  button("Save note").click();
  assert.equal(
    document.querySelector('textarea[aria-label="Note"]').value,
    "SYNTHETIC unsaved",
  );
  assert.match(document.body.textContent, /Could not save/);
  button("Edit").click();
  input("Edit note", "SYNTHETIC unsaved edit");
  button("Save changes").click();
  assert.equal(
    document.querySelector('textarea[aria-label="Edit note"]').value,
    "SYNTHETIC unsaved edit",
  );
  button("Cancel edit").click();
  button("Delete").click();
  button("Delete note").click();
  assert.match(document.body.textContent, /Could not delete/);
  assert.ok(button("Keep note"));
  assert.deepEqual(listNotes(), [recovered]);
  localStorage.setItem = setter;
  await tick();
});

test("notes picker adds only, rejects other formats, cancellation is inert and late result cannot import after leaving", async (t) => {
  const { store } = setup(t);
  store.set("bgn.notes.v1", JSON.stringify([recovered]));
  go("notes");
  assert.ok(
    button("Import from a backup file"),
    "notes has an explicit import",
  );
  button("Import from a backup file").click();
  assert.equal(button("Import from a backup file").disabled, true);
  globalThis.__bgnBackupPicked(
    wrap([
      { ...recovered, text: "stale" },
      { id: "added", text: "SYNTHETIC imported", ts: 2000 },
    ]),
  );
  await tick();
  assert.match(document.body.textContent, /Added 1 note/);
  assert.equal(
    listNotes().find((n) => n.id === recovered.id).text,
    recovered.text,
  );
  button("Import from a backup file").click();
  globalThis.__bgnBackupPicked(wrap(listNotes()));
  await tick();
  assert.match(document.body.textContent, /Nothing new/);
  for (const file of [
    null,
    "broken",
    '[{"name":"SYNTHETIC contact","tag":"Venue"}]',
    '{"type":"bgn-signups","version":1,"queue":[]}',
  ]) {
    button("Import from a backup file").click();
    globalThis.__bgnBackupPicked(file);
    await tick();
    assert.match(document.body.textContent, /No backup file read/);
    assert.equal(listNotes().length, 2);
  }
  button("Import from a backup file").click();
  button("Cancel").click();
  globalThis.__bgnBackupPicked(
    wrap([{ id: "late", text: "must not import", ts: 3000 }]),
  );
  await tick();
  assert.equal(listNotes().length, 2);
});
