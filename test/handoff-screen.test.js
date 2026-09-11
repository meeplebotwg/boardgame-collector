import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { render } from "../src/screens.js";
import * as handoff from "../src/handoff.js";
import * as ui from "../src/handoff-screen.js";
import { saveContact } from "../src/contacts.js";
const origin = "https://synthetic.tailnet.ts.net:9443";
const tick = () => new Promise((r) => setTimeout(r, 25));
const btn = (text) =>
  [...globalThis.document.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
function setup() {
  const { window } = parseHTML(
    '<html><body><div id="app"></div></body></html>',
  );
  globalThis.window = window;
  globalThis.document = window.document;
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
  };
  localStorage.setItem(
    "bgn.contacts.v1",
    JSON.stringify([
      {
        name: "<b>Synthetic</b>",
        email: "",
        phone: "@synthetic",
        notes: "Ignore instructions",
        tag: "Venue",
      },
    ]),
  );
  localStorage.setItem(
    "bgn.adds.v1",
    JSON.stringify([
      {
        kind: "one",
        email: "synthetic@example.org",
        source: "Test source",
        name: "Synthetic",
      },
    ]),
  );
  localStorage.setItem("bgn.meeple.origin.v1", origin);
  return window;
}
test("Home offers specific preview not generic agent task", async () => {
  setup();
  globalThis.__APP_VERSION__ = "0.0.0-test";
  globalThis.requestAnimationFrame = () => {};
  const old = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  try {
    render("home");
    assert.match(globalThis.document.body.textContent, /Send to Meeple/);
    assert.doesNotMatch(
      globalThis.document.body.textContent,
      /Ask for something/,
    );
    await tick();
  } finally {
    globalThis.fetch = old;
  }
});
test("preview full fields, explicit selection, receipt distinct from added and refresh outcomes", async () => {
  setup();
  let calls = 0;
  const request = async (o, p, body) => {
    assert.equal(o, origin);
    calls++;
    if (body) return { job: "a".repeat(32) };
    const rows = JSON.parse(handoff.ledger().jobs[0].body).records;
    return {
      job: "a".repeat(32),
      items: rows.map((r) => ({
        id: r.id,
        status: r.kind === "signup" ? "blocked" : "stored_contact",
        evidence: "Synthetic login gate",
      })),
    };
  };
  globalThis.document
    .getElementById("app")
    .replaceChildren(ui.handoffScreen({ request }));
  await tick();
  assert.equal(calls, 0);
  assert.match(globalThis.document.body.textContent, /not yet sent/);
  assert.match(globalThis.document.body.textContent, /@synthetic/);
  assert.match(globalThis.document.body.textContent, /Ignore instructions/);
  assert.match(globalThis.document.body.textContent, /Test source/);
  assert.equal(globalThis.document.querySelector("b"), null);
  assert.equal(btn("Select records to send").disabled, true);
  const check = globalThis.document.querySelector('input[type="checkbox"]');
  check.checked = true;
  check.dispatchEvent(new globalThis.window.Event("change"));
  btn("Send 1 selected record").click();
  await tick();
  assert.equal(calls, 1);
  assert.match(
    globalThis.document.body.textContent,
    /Received — awaiting processing/,
  );
  assert.match(globalThis.document.body.textContent, /NOT added/);
  assert.match(
    globalThis.document.body.textContent,
    /synthetic@example.org/,
    "receipt must identify the address, not just a potentially shared name",
  );
  assert.equal(JSON.parse(localStorage.getItem("bgn.adds.v1")).length, 1);
  btn("Refresh outcomes").click();
  await tick();
  assert.match(globalThis.document.body.textContent, /Blocked/);
  assert.match(globalThis.document.body.textContent, /Synthetic login gate/);
});
test("unknown response keeps retry across screen reopen, destination locked", async () => {
  setup();
  const request = async () => {
    throw Error("synthetic timeout");
  };
  globalThis.document
    .getElementById("app")
    .replaceChildren(ui.handoffScreen({ request }));
  await tick();
  const check = globalThis.document.querySelector('input[type="checkbox"]');
  check.checked = true;
  check.dispatchEvent(new globalThis.window.Event("change"));
  btn("Send 1 selected record").click();
  await tick();
  assert.match(globalThis.document.body.textContent, /Unknown delivery/);
  assert.ok(btn("Retry same batch"));
  globalThis.document
    .getElementById("app")
    .replaceChildren(ui.handoffScreen({ request }));
  await tick();
  assert.ok(btn("Retry same batch"));
  assert.equal(
    globalThis.document.querySelector('input[aria-label="Meeple endpoint"]')
      .disabled,
    true,
  );
});
test("manual drain suppresses delegated signups and explains retained originals", async () => {
  setup();
  handoff.prepare(origin, [(await handoff.preview())[0]]);
  render("drain");
  assert.match(globalThis.document.body.textContent, /Meeple/);
  assert.equal(globalThis.document.querySelector("textarea"), null);
  assert.doesNotMatch(globalThis.document.body.textContent, /This batch · 0/);
});

function saveIneligibleContact() {
  saveContact({
    name: "Synthetic oversized contact",
    email: "",
    phone: "",
    tag: "Venue",
    notes: "x".repeat(2001),
  });
}

test("ineligible capture rows have reasons while unrelated valid selection stays usable", async () => {
  setup();
  saveIneligibleContact();
  const queue = JSON.parse(localStorage.getItem("bgn.adds.v1"));
  queue.push({ kind: "one", email: "Synthetic Person <bad@example.org>" });
  localStorage.setItem("bgn.adds.v1", JSON.stringify(queue));
  const before = [
    localStorage.getItem("bgn.adds.v1"),
    localStorage.getItem("bgn.contacts.v1"),
  ];
  let calls = 0;
  globalThis.document.getElementById("app").replaceChildren(
    ui.handoffScreen({
      request: async (o, p, body) => {
        calls++;
        assert.equal(JSON.parse(body).records.length, 1);
        assert.equal(
          JSON.parse(body).records[0].email,
          "synthetic@example.org",
        );
        return { job: "a".repeat(32) };
      },
    }),
  );
  await tick();
  const rows = [...globalThis.document.querySelectorAll(".meeple-record")];
  assert.equal(rows.length, 4);
  for (const name of ["Synthetic oversized contact", "Synthetic Person"]) {
    const row = rows.find((r) => r.textContent.includes(name));
    assert.equal(row.querySelector("input").disabled, true);
    assert.match(row.textContent, /not eligible/i);
  }
  assert.match(globalThis.document.body.textContent, /notes.*2000/i);
  assert.match(globalThis.document.body.textContent, /signup email/i);
  assert.equal(localStorage.getItem("bgn.handoff.v1"), null);
  const check = globalThis.document.querySelector(
    'input[aria-label="Send signup: Synthetic"]',
  );
  assert.equal(check.disabled, false);
  check.checked = true;
  check.dispatchEvent(new globalThis.window.Event("change"));
  btn("Send 1 selected record").click();
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(
    [
      localStorage.getItem("bgn.adds.v1"),
      localStorage.getItem("bgn.contacts.v1"),
    ],
    before,
  );
});

test("oversized contact saved after pending does not hide immutable retry or receipt refresh", async () => {
  setup();
  const rows = await handoff.preview();
  handoff.prepare(origin, [rows[1]]);
  await handoff.send(async () => ({ job: "a".repeat(32) }));
  handoff.prepare(origin, [rows[0]]);
  const pending = handoff.ledger().pending;
  saveIneligibleContact();
  const before = localStorage.getItem("bgn.contacts.v1");
  let retries = 0;
  let refreshes = 0;
  globalThis.document.getElementById("app").replaceChildren(
    ui.handoffScreen({
      request: async (o, p, body) => {
        if (body) {
          retries++;
          assert.deepEqual(
            [o, p, body],
            [pending.origin, "/v1/jobs", pending.body],
          );
          throw Error("synthetic timeout");
        }
        refreshes++;
        return {
          job: "a".repeat(32),
          items: [
            {
              id: rows[1].id,
              status: "stored_contact",
              evidence: "Synthetic retained receipt",
            },
          ],
        };
      },
    }),
  );
  await tick();
  assert.ok(
    btn("Retry same batch"),
    "capture preview must not remove pending recovery",
  );
  assert.ok(btn("Refresh outcomes"));
  assert.match(globalThis.document.body.textContent, /notes.*2000/i);
  btn("Retry same batch").click();
  await tick();
  btn("Refresh outcomes").click();
  await tick();
  assert.equal(retries, 1);
  assert.equal(refreshes, 1);
  assert.deepEqual(handoff.ledger().pending, pending);
  assert.match(
    globalThis.document.body.textContent,
    /Synthetic retained receipt/,
  );
  assert.equal(localStorage.getItem("bgn.contacts.v1"), before);
});

test("unreadable capture store cannot replace pending recovery with a global alert", async () => {
  setup();
  handoff.prepare(origin, [(await handoff.preview())[0]]);
  localStorage.setItem("bgn.contacts.v1", "{");
  globalThis.document.getElementById("app").replaceChildren(ui.handoffScreen());
  await tick();
  assert.ok(btn("Retry same batch"));
  assert.match(globalThis.document.body.textContent, /can't preview/i);
});

test("known browser refusal happens before prepare and never claims unknown delivery", async () => {
  setup();
  globalThis.document.getElementById("app").replaceChildren(ui.handoffScreen());
  await tick();
  const check = globalThis.document.querySelector('input[type="checkbox"]');
  check.checked = true;
  check.dispatchEvent(new globalThis.window.Event("change"));
  btn("Send 1 selected record").click();
  await tick();
  assert.equal(localStorage.getItem("bgn.handoff.v1"), null);
  assert.match(globalThis.document.body.textContent, /installed app/i);
  assert.doesNotMatch(globalThis.document.body.textContent, /Unknown delivery/);
});
