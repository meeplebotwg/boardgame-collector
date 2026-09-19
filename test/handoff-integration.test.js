// Synthetic integration: real JS outbox -> real HTTP/SQLite -> local gated CLI -> polling.
// Transport is explicitly injected loopback, NOT live Tailscale/native/Google proof.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { preview, prepare, send, poll, ledger } from "../src/handoff.js";
import { pendingAddresses } from "../src/queue.js";

test("synthetic lost ACK, receiver restart, gated processor and individual outcomes", async () => {
  const root = mkdtempSync(join(tmpdir(), "bgn-synthetic-"));
  const config = join(root, "config.json");
  const origin = "https://synthetic.tailnet.ts.net:9443";
  writeFileSync(
    config,
    JSON.stringify({ owners: ["owner@example.org"], origin, port: 0 }),
    { mode: 0o600 },
  );
  let server;
  let port;
  const boot = async () => {
    server = spawn(
      "python3",
      [
        "-u",
        "-c",
        "import sys;sys.path.insert(0,'receiver');from meeple_receiver import Store,make_server;s=make_server(Store(sys.argv[1]),sys.argv[2]);print(s.server_port,flush=True);s.serve_forever()",
        root,
        config,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    port = Number((await once(server.stdout, "data"))[0].toString().trim());
    assert.ok(port > 0);
  };
  const stop = async () => {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await exited;
  };
  const request = async (destination, path, body) => {
    assert.equal(destination, origin);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: body ? "POST" : "GET",
      body,
      headers: {
        "Tailscale-User-Login": "owner@example.org",
        "X-BGN-Handoff": "1",
        "Content-Type": "application/json",
      },
    });
    assert.ok(res.ok, `HTTP ${res.status}`);
    return res.json();
  };
  const cli = (...args) => {
    const result = spawnSync(
      "python3",
      ["receiver/meeple_receiver.py", "--data", root, ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    await boot();
    const data = new Map();
    globalThis.localStorage = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
    };
    localStorage.setItem(
      "bgn.adds.v1",
      JSON.stringify([
        {
          kind: "batch",
          emails: [
            "one@example.org",
            "two@example.org",
            "three@example.org",
            "four@example.org",
          ],
          name: "Synthetic",
          source: "integration",
        },
      ]),
    );
    localStorage.setItem(
      "bgn.contacts.v1",
      JSON.stringify([
        {
          name: "Synthetic venue",
          email: "",
          phone: "@synthetic",
          tag: "Venue",
          notes: "$(false) is data",
        },
      ]),
    );
    const rows = await preview();
    prepare(origin, rows);
    let original;
    await assert.rejects(
      send(async (...args) => {
        original = await request(...args);
        throw Error("Synthetic ACK lost after commit");
      }),
    );
    await stop();
    await boot();
    const job = await send(request);
    assert.equal(job, original.job);
    assert.ok(Number.isInteger(original.received_at));
    assert.equal(ledger().jobs[0].received_at, original.received_at);
    assert.equal(JSON.parse(cli("list")).length, 1);
    assert.equal(cli("run", job), "blocked");
    await poll(job, request);
    assert.equal(ledger().jobs[0].items[0].status, "blocked");
    assert.equal(ledger().jobs[0].items[0].received_at, original.received_at);
    assert.equal(ledger().jobs[0].items[0].added_at, null);
    assert.equal(ledger().jobs[0].items[0].verified_at, null);
    const evidence = join(root, "evidence.txt");
    writeFileSync(
      evidence,
      "SYNTHETIC test observation only; no Google interaction",
    );
    const statuses = [
      "added",
      "already_member",
      "invitation_required",
      "blocked",
    ];
    for (let i = 0; i < 4; i++)
      cli(
        "set",
        job,
        rows[i].id,
        statuses[i],
        "--evidence-file",
        evidence,
        ...(i === 0 ? ["--added-at", "2020-01-02T03:04:05Z"] : []),
      );
    const result = await poll(job, request);
    assert.deepEqual(
      result.items.map((i) => i.status),
      [...statuses, "stored_contact"],
    );
    const persisted = ledger().jobs[0];
    assert.equal(persisted.received_at, original.received_at);
    assert.equal(persisted.items[0].added_at, 1577934245);
    assert.ok(persisted.items[0].verified_at > persisted.items[0].added_at);
    assert.equal(
      persisted.items[1].added_at,
      null,
      "already_member does not invent an original add date",
    );
    assert.ok(Number.isInteger(persisted.items[1].verified_at));
    assert.equal(persisted.items[2].verified_at, null);
    assert.equal(
      persisted.items[4].added_at,
      null,
      "contacts are never enrolled",
    );
    assert.equal(pendingAddresses().length, 4);
    assert.equal(JSON.parse(localStorage.getItem("bgn.contacts.v1")).length, 1);
    console.log(
      JSON.stringify({
        evidence: "SYNTHETIC LOOPBACK ONLY",
        job,
        receiptReusedAfterRestart: true,
        statuses: result.items.map((i) => i.status),
        phoneSignupsRetained: 4,
        contactsRetained: 1,
        googleInvoked: false,
      }),
    );
  } finally {
    if (server && server.exitCode === null) await stop();
    rmSync(root, { recursive: true, force: true });
    console.log(
      "Synthetic receiver stopped; private temporary database removed.",
    );
  }
});
