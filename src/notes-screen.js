// General scratchpad, deliberately separate from contacts and Meeple (ADR 0011).
import { h, header, sectionLabel, cta } from "./ui.js";
import { back } from "./router.js";
import {
  saveNote,
  editNote,
  deleteNote,
  listNotes,
  importNotes,
} from "./notes.js";
import {
  readNewestNotesBackup,
  mergeNotes,
  pickNotesBackup,
} from "./backup.js";

const button = (label, onclick, cls = "btn-secondary") =>
  h("button", { type: "button", class: cls, onclick }, label);
const status = () => h("div", { class: "card-body", role: "status" });

// Editors own their drafts, so a fresh screen entry always starts empty.
function editor(text, label, saveLabel, save, cancel) {
  const notice = status();
  const input = h("textarea", {
    class: "input general-note-area",
    "aria-label": label,
    value: text,
    rows: 5,
    oninput: () => submit.update(),
  });
  const submit = cta(
    () => (input.value.trim() ? saveLabel : "Write a note first"),
    () => !!input.value.trim(),
    () => {
      try {
        save(input.value);
        input.value = "";
        submit.update();
        notice.textContent = "Saved on this device.";
      } catch {
        notice.textContent =
          "Could not save on this device. Your draft is still here; try again.";
      }
    },
  );
  return h(
    "div",
    { class: "stack" },
    h(
      "label",
      { class: "field" },
      h("span", { class: "field-label" }, label),
      input,
    ),
    submit.btn,
    cancel ? button("Cancel edit", cancel) : null,
    notice,
  );
}

function noteCard(note, refresh) {
  const card = h("article", { class: "card note-card" });
  function show() {
    card.replaceChildren(
      h("div", { class: "note-text" }, note.text),
      h("div", { class: "event-note" }, new Date(note.ts).toLocaleString()),
      button("Edit", () => {
        card.replaceChildren(
          editor(
            note.text,
            "Edit note",
            "Save changes",
            (text) => {
              if (!editNote(note.id, text)) throw new Error("Note unavailable");
              refresh(note.id);
            },
            show,
          ),
        );
        card.querySelector("textarea").focus();
      }),
      button("Delete", () => {
        const notice = status();
        card.replaceChildren(
          h("div", { class: "note-text" }, note.text),
          h("div", { class: "card-title" }, "Delete this note?"),
          h(
            "div",
            { class: "card-body" },
            "Removes it from this device's notes. Older Downloads backups may still hold a copy.",
          ),
          button(
            "Delete note",
            () => {
              try {
                deleteNote(note.id);
                refresh(note.id);
              } catch {
                notice.textContent =
                  "Could not delete on this device. The note is still saved; try again.";
              }
            },
            "cta",
          ),
          button("Keep note", show),
          notice,
        );
      }),
    );
  }
  show();
  return card;
}

export function notesScreen() {
  const list = h("div", { class: "stack" });
  const cards = new Map();
  const refresh = (savedId) => {
    // Reuse unchanged cards so another save/import cannot discard edit drafts.
    cards.delete(savedId);
    const notes = listNotes();
    const ids = new Set(notes.map((note) => note.id));
    for (const id of cards.keys()) if (!ids.has(id)) cards.delete(id);
    list.replaceChildren(
      ...(notes.length
        ? notes.map((note) => {
            if (!cards.has(note.id))
              cards.set(note.id, noteCard(note, refresh));
            return cards.get(note.id);
          })
        : [
            h(
              "div",
              { class: "empty" },
              "No notes yet. Write something to remember for next time.",
            ),
          ]),
    );
  };
  refresh();
  const notice = status();
  const pick = button(
    "Import from a backup file",
    async () => {
      if (pick.disabled) return;
      pick.disabled = true;
      try {
        const notes = await pickNotesBackup();
        // Native picker results may arrive after Cancel/back. Never mutate from
        // a detached screen, or let a result clear the next entry's draft.
        if (!pick.isConnected) return;
        if (!notes) {
          notice.textContent = "No backup file read.";
          return;
        }
        const added = importNotes(notes);
        refresh();
        notice.textContent = added
          ? `Added ${added} ${added === 1 ? "note" : "notes"} from the backup.`
          : "Nothing new — those notes are already saved.";
      } catch {
        notice.textContent =
          "Could not import on this device. Existing notes are unchanged; try again.";
      } finally {
        pick.disabled = false;
      }
    },
    "link-btn",
  );
  return h(
    "div",
    { class: "screen notes-screen" },
    header("Private · on this device", "Notes", back),
    h(
      "main",
      { class: "content" },
      h(
        "div",
        { class: "privacy-banner" },
        h(
          "div",
          { class: "privacy-banner-body" },
          "A scratchpad for anything. Nothing here is sent to Meeple, the mailing list, or anyone else. Saved on this device, with automatic copies in Downloads/BGN Coordinator when available.",
        ),
      ),
      h(
        "div",
        { class: "card" },
        editor("", "Note", "Save note", (text) => {
          if (!saveNote(text)) throw new Error("Empty note");
          refresh();
        }),
      ),
      sectionLabel("Saved notes · newest first"),
      list,
      pick,
      notice,
    ),
  );
}

let restoreFound;
let restoreDeclined = false;
export function notesRestoreCard(refreshHome) {
  if (restoreDeclined || listNotes().length) return null;
  if (restoreFound === undefined) restoreFound = readNewestNotesBackup();
  if (!restoreFound) return null;
  const notes = mergeNotes([], restoreFound.notes);
  if (!notes.length) return null;
  const notice = status();
  return h(
    "div",
    { class: "card notes-restore" },
    h("div", { class: "card-title" }, "Restore your notes?"),
    h(
      "div",
      { class: "card-body" },
      `Your notes are empty, but ${restoreFound.name} on this device holds ${notes.length} ${notes.length === 1 ? "note" : "notes"}. Nothing was sent anywhere.`,
    ),
    button(
      `Restore ${notes.length} ${notes.length === 1 ? "note" : "notes"}`,
      () => {
        try {
          importNotes(notes);
          refreshHome();
        } catch {
          notice.textContent =
            "Could not restore on this device. The backup is unchanged; try again.";
        }
      },
      "cta",
    ),
    button("Not now", () => {
      restoreDeclined = true;
      refreshHome();
    }),
    notice,
  );
}
