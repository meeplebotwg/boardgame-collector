import test from "node:test";
import assert from "node:assert/strict";
import { pendingAddresses, nextBatch, markDrained } from "../src/queue.js";

import * as m from "../src/handoff.js";
const ORIGIN = "https://synthetic.tailnet.ts.net:9443";
const receipt = "b".repeat(32);
function setup() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
  };
  localStorage.setItem(
    "bgn.adds.v1",
    JSON.stringify([
      {
        kind: "one",
        email: "new@example.org",
        name: "Synthetic",
        source: "Test",
      },
    ]),
  );
  localStorage.setItem(
    "bgn.contacts.v1",
    JSON.stringify([
      {
        name: "Synthetic venue",
        email: "",
        phone: "@handle",
        tag: "Venue",
        notes: "<script>INJECTION</script>",
        ts: 1,
      },
    ]),
  );
  return data;
}

test("legacy and restored contact identity ignores timestamps; full metadata and notes remain data", async () => {
  setup();
  const first = await m.preview();
  assert.equal(first.length, 2);
  assert.equal(first[0].source, "Test");
  assert.equal(first[1].phone, "@handle");
  assert.match(first[1].notes, /<script>/);
  const cs = JSON.parse(localStorage.getItem("bgn.contacts.v1"));
  cs[0].ts = 999;
  localStorage.setItem("bgn.contacts.v1", JSON.stringify(cs));
  assert.deepEqual(await m.preview(), first);
  assert.equal(
    localStorage.getItem("bgn.handoff.v1"),
    null,
    "preview cannot start upload",
  );
});

test("origin parser rejects unsafe endpoint forms", () => {
  setup();
  assert.equal(m.validOrigin(ORIGIN), ORIGIN);
  for (const s of [
    "http://a.ts.net",
    "https://a.ts.net.evil.org",
    "https://user@a.ts.net",
    "https://a.ts.net/x",
    "https://a.ts.net/?q=x",
    "https://a.ts.net/#x",
    "https://a.ts.net\\@evil.org",
    "https://a.ts.net?",
    "https://a.ts.net#",
  ])
    assert.throws(() => m.validOrigin(s));
});

test("immutable durable batch survives lost ack and restart; no clearing or rerouting", async () => {
  setup();
  const rows = await m.preview();
  m.prepare(ORIGIN, [rows[0]]);
  const body = m.ledger().pending.body;
  assert.deepEqual(
    nextBatch(),
    [],
    "uncertain delegated records must not race manual drain",
  );
  assert.throws(() => markDrained(["new@example.org"]), /Meeple/);
  await assert.rejects(
    m.send(async () => {
      throw Error("timeout");
    }),
  );
  assert.equal(m.ledger().pending.body, body);
  assert.throws(() => m.prepare("https://other.ts.net", [rows[1]]), /pending/i);
  localStorage.setItem(
    "bgn.adds.v1",
    JSON.stringify([
      ...JSON.parse(localStorage.getItem("bgn.adds.v1")),
      { kind: "one", email: "later@example.org" },
    ]),
  );
  assert.deepEqual(nextBatch(), ["later@example.org"]);
  const calls = [];
  await m.send(async (origin, path, value) => {
    calls.push([origin, path, value]);
    return { job: receipt };
  });
  assert.deepEqual(calls, [[ORIGIN, "/v1/jobs", body]]);
  assert.deepEqual(pendingAddresses(), [
    "new@example.org",
    "later@example.org",
  ]);
  assert.equal(m.ledger().pending, null);
  assert.equal(m.ledger().jobs[0].job, receipt);
  assert.equal(
    (await m.preview()).length,
    2,
    "new capture and unselected contact remain new",
  );
  assert.deepEqual(
    nextBatch(),
    ["later@example.org"],
    "received is not permission to manual-drain",
  );
});

test("storage failure blocks before network; corrupt export fails closed", async () => {
  setup();
  const rows = await m.preview();
  const before = localStorage.getItem("bgn.adds.v1");
  localStorage.setItem = () => {
    throw Error("quota");
  };
  assert.throws(() => m.prepare(ORIGIN, rows), /quota/);
  assert.equal(localStorage.getItem("bgn.adds.v1"), before);
  setup();
  localStorage.setItem("bgn.contacts.v1", "{");
  await assert.rejects(m.preview());
  setup();
  localStorage.setItem("bgn.adds.v1", '[{"kind":"one","email":"invalid"}]');
  assert.match((await m.preview())[0].error, /signup email/i);
  setup();
  localStorage.setItem("bgn.handoff.v1", "{}");
  await assert.rejects(m.preview());
});

test("polling is bound to receipt, record IDs, kind and frozen destination", async () => {
  setup();
  const rows = await m.preview();
  m.prepare(ORIGIN, rows);
  await m.send(async () => ({ job: receipt }));
  const response = {
    job: receipt,
    items: rows.map((r) => ({
      id: r.id,
      record: r,
      status: r.kind === "signup" ? "added" : "stored_contact",
      evidence: "SYNTHETIC ONLY",
    })),
  };
  await m.poll(receipt, async (origin, path, body) => {
    assert.equal(origin, ORIGIN);
    assert.equal(path, "/v1/jobs/" + receipt);
    assert.equal(body, undefined);
    return response;
  });
  assert.equal(m.ledger().jobs[0].items[0].status, "added");
  await assert.rejects(
    m.poll(receipt, async () => ({ ...response, job: "c".repeat(32) })),
  );
  await assert.rejects(
    m.poll(receipt, async () => ({ ...response, items: [] })),
  );
  await assert.rejects(
    m.poll(receipt, async () => ({
      ...response,
      items: response.items.map((r) => ({ ...r, status: "added" })),
    })),
  );
  assert.equal(pendingAddresses().length, 1);
});

test("send acknowledgement cannot roll back concurrent status refresh", async () => {
  setup();
  const rows = await m.preview();
  m.prepare(ORIGIN, [rows[0]]);
  await m.send(async () => ({ job: receipt }));
  m.prepare(ORIGIN, [rows[1]]);
  let finish;
  const inFlight = m.send(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await m.poll(receipt, async () => ({
    job: receipt,
    items: [
      { id: rows[0].id, status: "added", evidence: "Synthetic observation" },
    ],
  }));
  finish({ job: "c".repeat(32) });
  await inFlight;
  assert.equal(m.ledger().jobs[0].items[0].status, "added");
});

test("malformed acknowledgement and persistence failure keep original retry batch", async () => {
  setup();
  m.prepare(ORIGIN, await m.preview());
  const before = m.ledger().pending.body;
  await assert.rejects(m.send(async () => ({ job: "wrong" })));
  assert.equal(m.ledger().pending.body, before);
  localStorage.setItem = () => {
    throw Error("quota");
  };
  await assert.rejects(m.send(async () => ({ job: receipt })));
  assert.equal(m.ledger().pending.body, before);
});

test("timestamps survive receipt and polling without inferring legacy addition or verification", async () => {
  setup();
  const rows = await m.preview();
  m.prepare(ORIGIN, [rows[0]]);
  await m.send(async () => ({ job: receipt, received_at: 100 }));
  assert.equal(m.ledger().jobs[0].received_at, 100);
  const response = {
    job: receipt,
    received_at: 100,
    items: [
      {
        id: rows[0].id,
        status: "added",
        evidence: "Synthetic only",
        received_at: 50,
        added_at: 75,
        verified_at: 200,
        updated: 200,
      },
    ],
  };
  await m.poll(receipt, async () => response);
  assert.deepEqual(m.ledger().jobs[0].items, response.items);
  const before = localStorage.getItem("bgn.handoff.v1");
  for (const value of [-1, 1.5, "200", true, 8640000000001]) {
    await assert.rejects(
      m.poll(receipt, async () => ({
        ...response,
        items: [{ ...response.items[0], added_at: value }],
      })),
      /timestamp/i,
    );
    assert.equal(localStorage.getItem("bgn.handoff.v1"), before);
  }
  await assert.rejects(
    m.poll(receipt, async () => ({ ...response, received_at: "100" })),
    /timestamp/i,
  );
  // A legacy receiver's updated is not an addition or membership verification date.
  await m.poll(receipt, async () => ({
    job: receipt,
    items: [
      {
        id: rows[0].id,
        status: "already_member",
        evidence: "Legacy synthetic",
        updated: 300,
      },
    ],
  }));
  const item = m.ledger().jobs[0].items[0];
  assert.equal(
    item.added_at,
    75,
    "legacy response must not erase known history",
  );
  assert.equal(item.verified_at, 200);
  assert.equal(item.received_at, 50);
  assert.equal(item.updated, 300);
  setup();
  m.prepare(ORIGIN, [rows[0]]);
  await m.send(async () => ({ job: receipt }));
  await m.poll(receipt, async () => ({
    job: receipt,
    items: [
      {
        id: rows[0].id,
        status: "already_member",
        evidence: "Legacy",
        updated: 300,
      },
    ],
  }));
  assert.equal(m.ledger().jobs[0].items[0].added_at, null);
  assert.equal(m.ledger().jobs[0].items[0].verified_at, null);
  assert.equal(m.ledger().jobs[0].received_at, null);
});

test("invalid receipt timestamp preserves immutable retry batch", async () => {
  setup();
  m.prepare(ORIGIN, await m.preview());
  await assert.rejects(
    m.send(async () => ({ job: receipt, received_at: "not-a-date" })),
    /timestamp/i,
  );
  assert.ok(m.ledger().pending);
  assert.equal(m.ledger().jobs.length, 0);
});

test("normal browser has no production sending capability", async () => {
  setup();
  globalThis.window = {};
  await assert.rejects(
    m.nativeRequest(ORIGIN, "/v1/jobs", "{}"),
    /installed app/i,
  );
});
