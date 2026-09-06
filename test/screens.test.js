import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { render } from "../src/screens.js";
import { start, go } from "../src/router.js";
import { listActivity } from "../src/activity.js";
import { pendingAddresses } from "../src/queue.js";

test("signup recovery previews stale-file warning before additive restore", () => {
  setup();
  globalThis.BgnBackup = {
    list: () => JSON.stringify(["bgn-signups-1000000000000-0.json"]),
    read: () =>
      JSON.stringify({
        type: "bgn-signups",
        version: 1,
        queue: [{ kind: "one", email: "synthetic@example.org" }],
      }),
  };
  go("signupRestore");
  assert.deepEqual(pendingAddresses(), []);
  assert.match(globalThis.document.body.textContent, /already.*completed/i);
  button("Restore 1 pending signup").click();
  assert.deepEqual(pendingAddresses(), ["synthetic@example.org"]);
  assert.match(
    globalThis.document.body.textContent,
    /Restored 1 pending signup/,
  );
  assert.ok(button("Choose a signup backup file"));
  delete globalThis.BgnBackup;
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup() {
  const { window } = parseHTML(
    '<html><body><div id="app"></div></body></html>',
  );
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.history = { replaceState() {}, pushState() {} };
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  globalThis.requestAnimationFrame = () => {};
  start((screen, opts) => {
    if (screen !== "home") render(screen, opts);
  });
  window.location = { href: "" };
  go("broadcast");
  return window;
}
const button = (text) =>
  [...globalThis.document.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );

const template = (title) =>
  [...globalThis.document.querySelectorAll(".tpl-card")].find((b) =>
    b.textContent.includes(title),
  );

function selectEvent(window, value) {
  const select = globalThis.document.querySelector(
    'select[aria-label="Event"]',
  );
  [...select.querySelectorAll("option")].find(
    (option) => option.value === String(value),
  ).selected = true;
  select.dispatchEvent(new window.Event("change"));
}

function setupEvents() {
  const window = setup();
  globalThis.localStorage.setItem(
    "bgn.calendar.v1",
    JSON.stringify({
      events: [
        { name: "SYNTHETIC A", url: "https://example.org/a" },
        { name: "SYNTHETIC B", url: "https://example.org/b" },
      ],
    }),
  );
  go("broadcast");
  selectEvent(window, 0);
  return window;
}

test("attendance is hidden and disabled outside recap despite stack layout", () => {
  setupEvents();
  const input = globalThis.document.querySelector(
    'input[aria-label="Actual attendance"]',
  );
  const row = input.parentElement;
  for (const title of [
    "Event reminder",
    "Post-night recap",
    "New event announced",
  ]) {
    template(title).click();
    const recap = title === "Post-night recap";
    assert.equal(row.hidden, !recap);
    assert.equal(
      row.style.display,
      recap ? "" : "none",
      "hidden must override the stack flex display",
    );
    assert.equal(input.disabled, !recap);
    assert.ok(row.classList.contains("stack"), "keep normal recap layout");
  }
});

test("irrelevant attendance input cannot replace coordinator draft edits", () => {
  const window = setupEvents();
  const input = globalThis.document.querySelector(
    'input[aria-label="Actual attendance"]',
  );
  const area = globalThis.document.querySelector("textarea");
  for (const title of ["Event reminder", "New event announced"]) {
    template(title).click();
    area.value = "SYNTHETIC coordinator edits";
    area.dispatchEvent(new window.Event("input"));
    input.value = "12";
    input.dispatchEvent(new window.Event("input"));
    assert.equal(area.value, "SYNTHETIC coordinator edits");
  }
});

test("changing events requires fresh actual attendance for the next recap", () => {
  const window = setupEvents();
  template("Post-night recap").click();
  const input = globalThis.document.querySelector(
    'input[aria-label="Actual attendance"]',
  );
  const area = globalThis.document.querySelector("textarea");
  const submit = globalThis.document.querySelector(".cta");
  input.value = "12";
  input.dispatchEvent(new window.Event("input"));
  assert.match(area.value, /SYNTHETIC A[\s\S]*12 attendees/);
  assert.equal(submit.disabled, false);
  selectEvent(window, 1);
  assert.equal(input.value, "", "A's attendance is not a fact about B");
  assert.doesNotMatch(area.value, /12 attendees/);
  assert.equal(submit.disabled, true);
  input.value = "7";
  input.dispatchEvent(new window.Event("input"));
  assert.match(area.value, /SYNTHETIC B[\s\S]*7 attendees/);
  assert.equal(submit.disabled, false);
  // Changing events while attendance is hidden must clear it too.
  template("Event reminder").click();
  selectEvent(window, 0);
  template("Post-night recap").click();
  assert.equal(input.value, "");
  assert.equal(submit.disabled, true);
});

test("mail handoff receipt and activity do not claim a send", async () => {
  const window = setup();
  const area = globalThis.document.querySelector("textarea");
  area.value = "Subject: SYNTHETIC test only\n\nDo not send";
  area.dispatchEvent(new window.Event("input"));
  globalThis.document.querySelector(".cta").click();
  button("Open in my mail app").click();
  await tick();
  assert.match(window.location.href, /^mailto:/);
  assert.match(
    globalThis.document.body.textContent,
    /Draft opened in mail app/,
  );
  assert.doesNotMatch(
    globalThis.document.body.textContent,
    /Message sent|will.*archive|It'll also/,
  );
  assert.equal(listActivity()[0].what, "Opened mail draft for the list");
});

test("failed mail handoff keeps edited draft and records no activity", async () => {
  const window = setup();
  Object.defineProperty(window.location, "href", {
    set() {
      throw new Error("No test mail app");
    },
  });
  const area = globalThis.document.querySelector("textarea");
  area.value = "SYNTHETIC edited draft";
  area.dispatchEvent(new window.Event("input"));
  globalThis.document.querySelector(".cta").click();
  button("Open in my mail app").click();
  await tick();
  assert.match(
    globalThis.document.body.textContent,
    /Couldn't open your mail app/,
  );
  assert.equal(area.value, "SYNTHETIC edited draft");
  assert.equal(button("Open in my mail app").disabled, false);
  assert.deepEqual(listActivity(), []);
});
