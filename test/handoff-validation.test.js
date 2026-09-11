import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as handoff from "../src/handoff.js";
import { isValidEmail } from "../src/parse.js";
import { nextBatch } from "../src/queue.js";

const origin = "https://synthetic.tailnet.ts.net:9443";
const cases = [
  ["Synthetic Person <synthetic@example.org>", false],
  ["synthetic person@example.org", false],
  ["synthetic@example .org", false],
  ["synthetic\tperson@example.org", false],
  ["synthetic\nperson@example.org", false],
  ["synthetic\u0085person@example.org", false],
  ["synthetic@@example.org", false],
  ["synthetic@example.org@other.org", false],
  ["synthetic@example.org,other@example.org", false],
  ["synthetic@example.org", true],
  ["Synthetic+tag@Sub.Example.org", true],
  [" \tSynthetic@example.org\n", true],
];
function setup(email) {
  const data = new Map([
    ["bgn.adds.v1", JSON.stringify([{ kind: "one", email }])],
  ]);
  globalThis.localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  return data;
}
function record(email) {
  return { id: "a".repeat(64), kind: "signup", email, name: "", source: "" };
}

for (const [email, accepted] of cases) {
  test(`client/receiver email contract: ${JSON.stringify(email)}`, async () => {
    const data = setup(email);
    const before = new Map(data);
    assert.equal(
      isValidEmail(email),
      true,
      "legacy capture semantics stay unchanged",
    );
    const body = JSON.stringify({
      version: 1,
      key: "b".repeat(32),
      records: [record(email)],
    });
    const receiver = spawnSync(
      "python3",
      [
        "-c",
        "import json,sys;sys.path.insert(0,'receiver');from meeple_receiver import validate;\ntry: validate(json.load(sys.stdin)); print('accepted')\nexcept ValueError: print('rejected')",
      ],
      { input: body, encoding: "utf8" },
    );
    assert.equal(receiver.status, 0, receiver.stderr);
    assert.equal(receiver.stdout.trim(), accepted ? "accepted" : "rejected");
    const [row] = await handoff.preview();
    if (accepted) {
      assert.equal(row.error, undefined);
      handoff.prepare(origin, [row]);
      assert.equal(
        JSON.parse(handoff.ledger().pending.body).records[0].email,
        email.trim().toLowerCase(),
      );
    } else {
      // Direct boundary callers cannot bypass preview by supplying a valid-looking ID.
      assert.throws(
        () => handoff.prepare(origin, [record(email)]),
        /signup email/i,
      );
      assert.match(row.error, /signup email/i);
      assert.equal(
        row.email,
        email,
        "ineligible preview must not rewrite the source",
      );
      assert.throws(() => handoff.prepare(origin, [row]));
      assert.deepEqual(
        data,
        before,
        "no ledger or source write on local rejection",
      );
      assert.equal(handoff.ledger().pending, null);
      assert.deepEqual([...handoff.delegatedEmails()], []);
      assert.deepEqual(nextBatch(), [email], "no delegated manual-drain lock");
    }
  });
}

test("historical malformed pending remains readable and retries exact original bytes", async () => {
  const email = cases[0][0];
  setup(email);
  const pending = {
    origin,
    body: JSON.stringify({
      version: 1,
      key: "b".repeat(32),
      records: [record(email)],
    }),
  };
  localStorage.setItem(
    "bgn.handoff.v1",
    JSON.stringify({ version: 1, pending, jobs: [] }),
  );
  const before = localStorage.getItem("bgn.handoff.v1");
  assert.deepEqual(handoff.ledger().pending, pending);
  await assert.rejects(
    handoff.send(async (...args) => {
      assert.deepEqual(args, [origin, "/v1/jobs", pending.body]);
      throw Error(
        "synthetic receiver rejection after an earlier unknown attempt",
      );
    }),
  );
  assert.equal(localStorage.getItem("bgn.handoff.v1"), before);
  assert.deepEqual([...handoff.delegatedEmails()], [email.toLowerCase()]);
});
