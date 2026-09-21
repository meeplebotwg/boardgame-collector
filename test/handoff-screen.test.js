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
test("worker invitation evidence distinguishes pending, unsent and legacy unknown", async () => {
  setup();
  const { document } = globalThis;
  const [row] = await handoff.preview();
  const job = "e".repeat(32);
  handoff.prepare(origin, [row]);
  await handoff.send(async () => ({ job }));
  for (const [evidence, label] of [
    [
      JSON.stringify({ worker: 1, meaning: "invitation_pending_verified" }),
      "Invitation pending — membership not verified",
    ],
    [
      JSON.stringify({ worker: 1, meaning: "invitation_not_sent" }),
      "Invitation required — not sent",
    ],
    ["Legacy observation", "Invitation required — sending not confirmed"],
    ["{broken", "Invitation required — sending not confirmed"],
    ["null", "Invitation required — sending not confirmed"],
    [
      JSON.stringify({ worker: 2, meaning: "invitation_pending_verified" }),
      "Invitation required — sending not confirmed",
    ],
  ]) {
    await handoff.poll(job, async () => ({
      job,
      items: [{ id: row.id, status: "invitation_required", evidence }],
    }));
    document.getElementById("app").replaceChildren(ui.handoffScreen());
    await tick();
    assert.ok(document.body.textContent.includes(label), label);
    assert.match(document.body.textContent, /Date added: Unknown/);
    assert.match(
      document.body.textContent,
      /Last membership verification recorded: Unknown/,
    );
  }
});

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

test("receipt dates render separately with unknown legacy and non-success states, manual refresh and offline retention", async () => {
  setup();
  const { document } = globalThis;
  const rows = await handoff.preview();
  const job = "a".repeat(32);
  handoff.prepare(origin, [rows[0]]);
  await handoff.send(async () => ({ job, received_at: 100 }));
  let response = {
    job,
    received_at: 100,
    items: [
      {
        id: rows[0].id,
        status: "already_member",
        evidence: "Synthetic only",
        received_at: 50,
        added_at: null,
        verified_at: 200,
        updated: 200,
      },
    ],
  };
  let calls = 0;
  const request = async () => {
    calls++;
    if (!response) throw Error("offline");
    return response;
  };
  const open = async () => {
    document
      .getElementById("app")
      .replaceChildren(ui.handoffScreen({ request }));
    await tick();
  };
  await open();
  assert.equal(
    calls,
    0,
    "screen uses explicit manual refresh, not background polling",
  );
  assert.match(
    document.body.textContent,
    /Submission received: 1970-01-01 00:01:40 UTC/,
  );
  assert.match(
    document.body.textContent,
    /Date received \(first record receipt\): Unknown/,
  );
  btn("Refresh outcomes").click();
  await tick();
  assert.match(
    document.body.textContent,
    /Date received \(first record receipt\): 1970-01-01 00:00:50 UTC/,
  );
  assert.match(document.body.textContent, /Date added: Unknown/);
  assert.match(
    document.body.textContent,
    /Last membership verification recorded: 1970-01-01 00:03:20 UTC/,
  );
  response.items[0] = { ...response.items[0], status: "added", added_at: 75 };
  btn("Refresh outcomes").click();
  await tick();
  assert.match(
    document.body.textContent,
    /Date added: 1970-01-01 00:01:15 UTC/,
  );
  response = null;
  btn("Refresh outcomes").click();
  await tick();
  assert.match(
    document.body.textContent,
    /last known outcomes, not new confirmation/,
  );
  assert.match(
    document.body.textContent,
    /Date added: 1970-01-01 00:01:15 UTC/,
  );
  await open();
  assert.match(
    document.body.textContent,
    /Date added: 1970-01-01 00:01:15 UTC/,
  );
  const legacy = handoff.ledger();
  delete legacy.jobs[0].received_at;
  for (const status of [
    "received",
    "blocked",
    "invitation_required",
    "needs_verification",
    "already_member",
  ]) {
    legacy.jobs[0].items = [
      { id: rows[0].id, status, evidence: "Legacy synthetic" },
    ];
    localStorage.setItem("bgn.handoff.v1", JSON.stringify(legacy));
    await open();
    assert.match(document.body.textContent, /Submission received: Unknown/);
    assert.match(document.body.textContent, /Date added: Unknown/);
    assert.match(
      document.body.textContent,
      /Last membership verification recorded: Unknown/,
    );
    assert.doesNotMatch(document.body.textContent, /Invalid Date/);
  }
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
