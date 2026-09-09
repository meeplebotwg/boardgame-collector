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

function noAgentOffer() {
  assert.doesNotMatch(
    globalThis.document.body.textContent,
    /have the agent|Discord agent|Ask for something|🤖/i,
  );
}

function input(window, selector, value) {
  const control = globalThis.document.querySelector(selector);
  control.value = value;
  control.dispatchEvent(new window.Event("input"));
}

test("single signup offers manual capture and join link, not unavailable automation", async () => {
  const window = setup();
  go("add");
  noAgentOffer();
  assert.equal(button("Enter an email").disabled, true);
  assert.equal(button("Enter an email to share the join link").disabled, true);
  input(window, 'input[aria-label="Email"]', "synthetic@example.org");
  button("Or send them the self-serve join link").click();
  await tick();
  assert.match(window.location.href, /^mailto:synthetic%40example.org\?/);
  assert.deepEqual(pendingAddresses(), []);
  button("Add to the list").click();
  assert.deepEqual(pendingAddresses(), ["synthetic@example.org"]);
  assert.match(globalThis.document.body.textContent, /queued/i);
});

test("batch signup queues parsed addresses without offering agent invites", () => {
  const window = setup();
  go("add");
  button("Paste a batch").click();
  noAgentOffer();
  assert.equal(button("Paste some emails").disabled, true);
  input(
    window,
    "textarea",
    "one@example.org, two@example.org, one@example.org, invalid",
  );
  assert.equal(button("Queue 2 for the list").disabled, false);
  button("Queue 2 for the list").click();
  assert.deepEqual(pendingAddresses(), ["one@example.org", "two@example.org"]);
  assert.equal(window.location.href, "");
  assert.match(globalThis.document.body.textContent, /queued/i);
});

test("broadcast keeps manual draft review and editing without scheduled agent sending", () => {
  const window = setup();
  noAgentOffer();
  input(window, "textarea", "SYNTHETIC draft — do not send");
  button("Review mail draft").click();
  noAgentOffer();
  assert.equal(button("Open in my mail app").disabled, false);
  assert.match(
    globalThis.document.body.textContent,
    /Nothing sends until you send it there/,
  );
  button("Keep editing").click();
  assert.equal(
    globalThis.document.querySelector("textarea").value,
    "SYNTHETIC draft — do not send",
  );
  assert.equal(button("Review mail draft").disabled, false);
  assert.equal(window.location.href, "");
  assert.deepEqual(pendingAddresses(), []);
  assert.deepEqual(listActivity(), []);
});

test("Luma previews a pasted event for manual handoff without offering a week-long agent watch", async (t) => {
  const window = setup();
  const requests = [];
  const copied = [];
  t.mock.method(globalThis.navigator.clipboard, "writeText", async (text) =>
    copied.push(text),
  );
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(url);
    return {
      ok: true,
      text: async () =>
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "Event",
          name: "SYNTHETIC game night",
          url: "https://luma.com/synthetic",
        })}</script>`,
    };
  });
  go("luma");
  noAgentOffer();
  assert.equal(button("Paste a Luma link").disabled, true);
  input(window, 'input[aria-label="Luma link"]', "lu.ma/synthetic");
  // Let the real input debounce and public-page parsers settle.
  await new Promise((resolve) => setTimeout(resolve, 550));
  noAgentOffer();
  assert.match(globalThis.document.body.textContent, /SYNTHETIC game night/);
  assert.equal(button("Add to our calendar").disabled, false);
  assert.equal(requests.length, 2);
  assert.deepEqual(copied, []);
  assert.equal(window.location.href, "");
  button("Add to our calendar").click();
  await tick();
  assert.match(window.location.href, /^https:\/\/luma.com\/calendar\/manage\//);
  assert.deepEqual(copied, ["https://luma.com/synthetic"]);
  assert.deepEqual(pendingAddresses(), []);
});

test("contact stays local and offers save/import instead of agent email", () => {
  const window = setup();
  go("contact");
  noAgentOffer();
  assert.equal(button("Add a name first").disabled, true);
  assert.ok(button("Import from a backup file"));
  input(window, 'input[aria-label="Name"]', "SYNTHETIC host");
  input(window, 'input[aria-label="Email"]', "host@example.org");
  assert.equal(button("Save contact 📇").disabled, false);
  button("Save contact 📇").click();
  assert.equal(window.location.href, "");
  assert.deepEqual(pendingAddresses(), []);
  go("contact");
  noAgentOffer();
  assert.match(globalThis.document.body.textContent, /SYNTHETIC host/);
  assert.match(globalThis.document.body.textContent, /host@example.org/);
  assert.match(
    globalThis.document.body.textContent,
    /Nothing here touches the mailing list or gets emailed/,
  );
});

test("an old agent route safely falls back to working Home actions", async (t) => {
  setup();
  globalThis.__APP_VERSION__ = "0.0.0-test";
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 503 }));
  go("agent", { task: "SYNTHETIC unavailable task" });
  assert.equal(globalThis.document.querySelector("h1").textContent, "Home");
  noAgentOffer();
  assert.doesNotMatch(
    globalThis.document.body.textContent,
    /SYNTHETIC unavailable task/,
  );
  const add = [...globalThis.document.querySelectorAll("button")].find((b) =>
    b.textContent.includes("Add to mailing list"),
  );
  add.click();
  assert.ok(button("Enter an email"));
  await tick();
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup() {
  const { window } = parseHTML(
    '<html><body><div id="app"></div></body></html>',
  );
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.history = { replaceState() {}, pushState() {} };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async () => {} } },
  });
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

// SYNTHETIC event-details UI fixtures. No live network or personal data.
const detailEvent = {
  eventId: "evt-SyntheticDetails",
  name: "SYNTHETIC details",
  slug: "synthetic-details",
  startAt: "2099-09-09T18:00:00-04:00",
  endAt: "2099-09-09T21:00:00-04:00",
  venue: "SYNTHETIC Hall",
  guestCount: 7,
  fullAddress: "123 Example St, Testville, MA 00000, USA",
  description: '<img src=x onerror="alert(1)"> SYNTHETIC details',
};
function cacheDetails(events = [detailEvent]) {
  localStorage.setItem(
    "bgn.calendar.v1",
    JSON.stringify({ ts: Date.now(), events }),
  );
}
const details = () =>
  globalThis.document.querySelector("details.event-details");
function offline(t) {
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 503 }));
  t.mock.method(console, "warn", () => {});
}

test("Upcoming cards use native summary with details/actions outside the toggle and untrusted text", async (t) => {
  setup();
  offline(t);
  cacheDetails();
  go("events");
  const card = details();
  assert.ok(card, "Upcoming card must be native details");
  assert.equal(card.hasAttribute("open"), false);
  const summary = card.querySelector("summary");
  assert.match(summary.textContent, /SYNTHETIC details/);
  assert.match(summary.textContent, /SYNTHETIC Hall/);
  assert.match(summary.textContent, /7 RSVPs/);
  assert.equal(summary.querySelector("button, a"), null);
  assert.equal(card.querySelector("img"), null);
  assert.match(card.querySelector(".event-description").textContent, /<img/);
  assert.equal(
    card.querySelector(".event-address").textContent,
    detailEvent.fullAddress,
  );
  assert.ok(button("Copy address"));
  assert.equal(
    card.querySelector("a").getAttribute("href"),
    "https://luma.com/synthetic-details",
  );
  await tick();
});

test("copy success waits for actual clipboard completion and link uses native opener without collapse", async (t) => {
  const window = setup();
  offline(t);
  cacheDetails();
  go("events");
  await tick();
  const card = details();
  assert.ok(card);
  card.setAttribute("open", "");
  let finish;
  const copied = [];
  t.mock.method(navigator.clipboard, "writeText", (text) => {
    copied.push(text);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  button("Copy address").click();
  assert.doesNotMatch(card.textContent, /Address copied/);
  assert.equal(button("Copy address").disabled, true);
  finish();
  await tick();
  assert.deepEqual(copied, [detailEvent.fullAddress]);
  assert.match(
    card.querySelector('[role="status"]').textContent,
    /Address copied/,
  );
  assert.ok(card.hasAttribute("open"));
  const calls = [];
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => calls.push({ cmd, args }),
  };
  try {
    card.querySelector("a").click();
    await tick();
    assert.equal(calls[0].cmd, "plugin:opener|open_url");
    assert.equal(calls[0].args.url, "https://luma.com/synthetic-details");
    assert.ok(card.hasAttribute("open"));
  } finally {
    delete window.__TAURI_INTERNALS__;
  }
});

for (const unavailable of [false, true])
  test(`clipboard ${unavailable ? "absent" : "denied"} gives selectable manual fallback, never false success`, async (t) => {
    setup();
    offline(t);
    cacheDetails();
    go("events");
    await tick();
    if (unavailable) delete navigator.clipboard;
    else
      t.mock.method(navigator.clipboard, "writeText", async () => {
        throw new Error("denied");
      });
    assert.ok(button("Copy address"));
    button("Copy address").click();
    await tick();
    assert.match(
      details().querySelector('[role="status"]').textContent,
      /select.*address.*copy/i,
    );
    assert.doesNotMatch(details().textContent, /Address copied/);
    assert.equal(button("Copy address").disabled, false);
    assert.equal(
      details().querySelector(".event-address").textContent,
      detailEvent.fullAddress,
    );
  });

test("legacy cached fields degrade honestly and unsafe source URL cannot navigate", async (t) => {
  const window = setup();
  offline(t);
  cacheDetails([
    {
      name: "SYNTHETIC legacy",
      venue: "City only",
      slug: "javascript:bad",
      fullAddress: {},
    },
  ]);
  go("events");
  await tick();
  assert.ok(details());
  assert.match(details().textContent, /Full address unavailable/);
  assert.equal(button("Copy address"), undefined);
  assert.equal(details().querySelector(".event-description"), null);
  const link = details().querySelector("a");
  assert.equal(link.textContent, "Open Luma calendar");
  link.click();
  await tick();
  assert.equal(window.location.href, "https://luma.com/boardgamenightwg");
  assert.match(
    globalThis.document.body.textContent,
    /Couldn't reach the calendar — pulled/,
  );
});

test("external event link remains original and opener failure is visible without collapse", async (t) => {
  const window = setup();
  offline(t);
  cacheDetails([
    { ...detailEvent, url: "https://example.org/event/123", hideRsvp: true },
  ]);
  go("events");
  await tick();
  const card = details();
  assert.ok(card);
  card.setAttribute("open", "");
  assert.doesNotMatch(card.textContent, /7 RSVPs/);
  const link = card.querySelector("a");
  assert.equal(link.textContent, "Open original event");
  assert.equal(link.getAttribute("href"), "https://example.org/event/123");
  window.__TAURI_INTERNALS__ = {
    invoke: async () => {
      throw new Error("no browser");
    },
  };
  try {
    link.click();
    await tick();
    assert.match(card.textContent, /Couldn't open/);
    assert.ok(card.hasAttribute("open"));
  } finally {
    delete window.__TAURI_INTERNALS__;
  }
});

for (const success of [false, true])
  test(`cached expanded cards survive ${success ? "successful" : "failed"} revalidation`, async (t) => {
    setup();
    cacheDetails();
    let finish;
    t.mock.method(console, "warn", () => {});
    t.mock.method(
      globalThis,
      "fetch",
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    go("events");
    const card = details();
    assert.ok(card);
    card.setAttribute("open", "");
    assert.match(globalThis.document.body.textContent, /Last known — pulled/);
    const response = {
      props: {
        pageProps: {
          initialData: {
            data: {
              featured_items: [
                {
                  event: {
                    api_id: detailEvent.eventId,
                    url: detailEvent.slug,
                    name: "SYNTHETIC updated",
                  },
                },
              ],
            },
          },
        },
      },
    };
    finish({
      ok: success,
      status: 503,
      text: async () =>
        `<script id="__NEXT_DATA__">${JSON.stringify(response)}</script>`,
    });
    await tick();
    assert.ok(details().hasAttribute("open"));
    if (success) {
      assert.match(details().textContent, /SYNTHETIC updated/);
      (globalThis.document.querySelector(".event-note").style.display,
        assert.match(
          localStorage.getItem("bgn.calendar.v1"),
          /SYNTHETIC updated/,
        ));
    } else {
      assert.equal(
        details(),
        card,
        "failed read must not replace usable cached DOM",
      );
      assert.match(
        globalThis.document.body.textContent,
        /Couldn't reach the calendar — pulled/,
      );
      assert.match(
        localStorage.getItem("bgn.calendar.v1"),
        /SYNTHETIC details/,
      );
    }
  });
