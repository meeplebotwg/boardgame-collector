import test from "node:test";
import assert from "node:assert/strict";
import {
  readNewestSignupBackup,
  writeSignupBackup,
  parseSignupBackup,
  parseBackup,
  mergeSignups,
} from "../src/backup.js";
import {
  backupSignups,
  importSignups,
  pendingAddresses,
  enqueue,
  markDrained,
} from "../src/queue.js";
const store = new Map();
const files = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
};
globalThis.BgnBackup = {
  write: (name, text) => {
    files.set(name, text);
    return null;
  },
  list: () => JSON.stringify([...files.keys()]),
  read: (name) => files.get(name) ?? null,
  remove: (name) => files.delete(name),
};
const wrap = (queue) =>
  JSON.stringify({ type: "bgn-signups", version: 1, queue });
test("signup recovery validates whole files and dedupes without replacing current metadata", () => {
  const current = [
    { kind: "one", email: "synthetic@example.org", name: "Current name" },
  ];
  const incoming = [
    {
      kind: "batch",
      emails: ["SYNTHETIC@example.org", "new@example.org", "NEW@example.org"],
    },
  ];
  assert.deepEqual(parseSignupBackup(wrap(incoming)), incoming);
  assert.deepEqual(mergeSignups(current, incoming), [
    ...current,
    { kind: "batch", emails: ["new@example.org"] },
  ]);
  for (const text of [
    "{",
    "null",
    "[]",
    wrap([{ kind: "one", email: "bad" }]),
    wrap([{ kind: "batch", emails: [] }]),
    wrap([{ kind: "broadcast", email: "test@example.org" }]),
    wrap([{ kind: "one", email: "test@example.org", name: 42 }]),
    wrap([{ kind: "batch", emails: ["test@example.org", 42] }]),
    wrap(incoming).replace('"version":1', '"version":2'),
  ])
    assert.equal(parseSignupBackup(text), null, text);
  assert.deepEqual(
    parseBackup('[{"name":"Legacy synthetic contact","tag":"Venue"}]'),
    [{ name: "Legacy synthetic contact", tag: "Venue" }],
  );
  assert.equal(
    parseBackup(wrap(incoming)),
    null,
    "signup file cannot contaminate contacts",
  );
});

test("prune only confirmed and readable snapshots covered by current data", () => {
  files.clear();
  const unique = "bgn-signups-1000000000000-0.json";
  const covered = "bgn-signups-1000000000001-0.json";
  const corrupt = "bgn-signups-1000000000002-0.json";
  files.set(unique, wrap([{ kind: "one", email: "lost@example.org" }]));
  files.set(covered, wrap([{ kind: "one", email: "kept@example.org" }]));
  files.set(corrupt, "{");
  files.set("bgn-contacts-2026-01-01-0000.json", "[]");
  for (let i = 0; i < 6; i++)
    files.set(`bgn-signups-1000000000003-${i}.json`, wrap([]));
  const before = [...files.keys()];
  const write = globalThis.BgnBackup.write;
  globalThis.BgnBackup.write = () => "write-failed";
  writeSignupBackup([{ kind: "one", email: "kept@example.org" }]);
  assert.deepEqual([...files.keys()], before, "failed write cannot prune");
  globalThis.BgnBackup.write = write;
  writeSignupBackup([{ kind: "one", email: "kept@example.org" }]);
  assert.equal(files.has(covered), false, "covered old backup is pruned");
  assert.equal(
    files.has(unique),
    true,
    "different pending address survives regardless of count",
  );
  assert.equal(
    files.has(corrupt),
    true,
    "unreadable files are not proof of redundancy",
  );
  assert.equal(files.has("bgn-contacts-2026-01-01-0000.json"), true);
  files.clear();
});

test("launch backup and explicit recovery preserve pending data and do not resurrect on read", async () => {
  store.clear();
  files.clear();
  store.set(
    "bgn.adds.v1",
    JSON.stringify([
      { kind: "one", email: "current@example.org", name: "Current" },
    ]),
  );
  backupSignups();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const recovered = readNewestSignupBackup();
  assert.equal(recovered.queue[0].name, "Current");
  assert.equal(
    importSignups([
      {
        kind: "batch",
        emails: [
          "CURRENT@example.org",
          "recovered@example.org",
          "RECOVERED@example.org",
        ],
      },
    ]),
    1,
  );
  assert.deepEqual(pendingAddresses(), [
    "current@example.org",
    "recovered@example.org",
  ]);
  assert.equal(importSignups(recovered.queue), 0);
  const before = store.get("bgn.adds.v1");
  assert.throws(() => importSignups([{ kind: "one", email: "bad" }]));
  assert.equal(store.get("bgn.adds.v1"), before);
  await new Promise((resolve) => setTimeout(resolve, 20));
  writeSignupBackup([]);
  assert.deepEqual(
    readNewestSignupBackup().queue,
    [],
    "newest empty snapshot is authoritative, not older pending data",
  );
  assert.deepEqual(
    pendingAddresses(),
    ["current@example.org", "recovered@example.org"],
    "read never imports",
  );
  store.set("bgn.adds.v1", "corrupt");
  assert.throws(() => importSignups(recovered.queue));
  assert.equal(
    store.get("bgn.adds.v1"),
    "corrupt",
    "never overwrite unreadable local queue",
  );
  store.clear();
  files.clear();
});

for (const existingCount of [1, 5]) {
  test(`clock rollback preserves and recovers the latest save with ${existingCount} existing snapshots`, (t) => {
    files.clear();
    t.after(() => files.clear());
    t.mock.method(Date, "now", () => 1799999999000);
    const previous = [{ kind: "one", email: "old@example.org" }];
    for (let i = 0; i < existingCount; i++)
      files.set(`bgn-signups-1800000000000-${i}.json`, wrap(previous));
    const latest = [...previous, { kind: "one", email: "new@example.org" }];
    writeSignupBackup(latest);
    assert.ok(
      [...files.values()].includes(wrap(latest)),
      "the just-written snapshot must survive pruning",
    );
    assert.deepEqual(readNewestSignupBackup().queue, latest);
    const firstName = readNewestSignupBackup().name;
    writeSignupBackup([]);
    assert.deepEqual(readNewestSignupBackup().queue, []);
    assert.notEqual(readNewestSignupBackup().name, firstName);
    assert.ok(files.has(firstName), "drain preserves earlier pending data");
    assert.ok([...files.values()].includes(wrap(latest)));
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("capture and drain back up versioned pending intents without overwriting recovery", async () => {
  enqueue({
    kind: "one",
    email: "synthetic@example.org",
    name: "SYNTHETIC Test",
    source: "At an event",
  });
  await settle();
  assert.equal(files.size, 1);
  const saved = JSON.parse([...files.values()][0]);
  assert.equal(saved.type, "bgn-signups");
  assert.equal(saved.version, 1);
  assert.equal(saved.queue[0].name, "SYNTHETIC Test");
  markDrained(["synthetic@example.org"]);
  await settle();
  assert.equal(
    files.size,
    2,
    "empty current state must not overwrite pre-drain recovery",
  );
  assert.deepEqual(JSON.parse([...files.values()].at(-1)).queue, []);
});
