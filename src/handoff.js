// Explicit private transfer; capture/backup stores are never rewritten (ADR 0010).
import { invoke } from "@tauri-apps/api/core";

const KEY = "bgn.handoff.v1";
const JOB = /^[a-f0-9]{32}$/;
const ID = /^[a-f0-9]{64}$/;
const LIMIT = 128 * 1024;
const STATES = [
  "received",
  "added",
  "already_member",
  "invitation_required",
  "blocked",
  "needs_verification",
];

export function validOrigin(value) {
  if (
    typeof value !== "string" ||
    !/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net(?::[0-9]+)?\/?$/.test(
      value,
    )
  )
    throw Error(
      "Use an HTTPS Tailscale .ts.net origin only, without path or credentials.",
    );
  return new URL(value).origin;
}

function fields(kind, value, checkEmail = false) {
  const limits =
    kind === "signup"
      ? { email: 254, name: 200, source: 200 }
      : { name: 200, email: 254, phone: 100, notes: 2000, tag: 200 };
  const result = { kind };
  for (const [key, bound] of Object.entries(limits)) {
    const text = value[key] ?? "";
    if (
      typeof text !== "string" ||
      text.length > bound ||
      [...text].some((c) => c.charCodeAt(0) < 32 && !["\n", "\t"].includes(c))
    )
      throw Error(
        `Invalid ${key}: use text up to ${bound} characters without control characters. Original kept; nothing sent.`,
      );
    result[key] =
      kind === "signup" && key === "email" ? text.trim().toLowerCase() : text;
  }
  // Match the receiver boundary, not capture's deliberately permissive parser.
  if (
    checkEmail &&
    kind === "signup" &&
    // Python's Unicode whitespace also includes NEL (U+0085).
    !/^[^\s@\u0085]+@[^\s@\u0085]+\.[^\s@\u0085]+$/.test(result.email)
  )
    throw Error(
      "Invalid signup email: use one plain address (person@example.org), without display names or internal whitespace. Original kept; capture a corrected signup separately.",
    );
  if (kind === "contact" && !result.name.trim())
    throw Error("Invalid contact name; nothing sent.");
  return result;
}

function validateBatch(body, checkEmail = false) {
  const value = JSON.parse(body);
  if (
    value.version !== 1 ||
    !JOB.test(value.key) ||
    !Array.isArray(value.records) ||
    !value.records.length ||
    value.records.length > 100 ||
    new TextEncoder().encode(body).length > LIMIT
  )
    throw Error("Invalid transfer batch.");
  const seen = new Set();
  for (const r of value.records) {
    if (
      !ID.test(r.id) ||
      seen.has(r.id) ||
      !["signup", "contact"].includes(r.kind)
    )
      throw Error("Invalid transfer record.");
    fields(r.kind, r, checkEmail);
    seen.add(r.id);
  }
  return value;
}

export function ledger() {
  const text = localStorage.getItem(KEY);
  if (text === null) return { version: 1, pending: null, jobs: [] };
  const value = JSON.parse(text);
  if (
    value?.version !== 1 ||
    !Array.isArray(value.jobs) ||
    !("pending" in value)
  )
    throw Error("Unreadable Meeple transfer history; nothing changed.");
  for (const entry of [
    ...value.jobs,
    ...(value.pending ? [value.pending] : []),
  ]) {
    validOrigin(entry.origin);
    // Preserve historical frozen bytes: stricter NEW-transfer validation must
    // never make a possibly received batch unreadable or release its drain lock.
    validateBatch(entry.body);
    if (entry !== value.pending && !JOB.test(entry.job))
      throw Error("Unreadable Meeple receipt.");
  }
  return value;
}
const save = (value) => localStorage.setItem(KEY, JSON.stringify(value));

// Called synchronously by manual drain, including stale confirmation screens.
export function delegatedEmails() {
  const state = ledger();
  return new Set(
    [...state.jobs, ...(state.pending ? [state.pending] : [])].flatMap((e) =>
      JSON.parse(e.body)
        .records.filter((r) => r.kind === "signup")
        .map((r) => r.email.trim().toLowerCase()),
    ),
  );
}

export async function preview() {
  const state = ledger();
  const queue = JSON.parse(localStorage.getItem("bgn.adds.v1") ?? "[]");
  const contacts = JSON.parse(localStorage.getItem("bgn.contacts.v1") ?? "[]");
  if (!Array.isArray(queue) || !Array.isArray(contacts))
    throw Error("Unreadable local records; nothing sent.");
  const records = queue.flatMap((it) =>
    (it?.kind === "batch" && Array.isArray(it.emails)
      ? it.emails
      : [it?.email]
    ).map((email) => ({ ...it, kind: "signup", email })),
  );
  records.push(...contacts.map((c) => ({ ...c, kind: "contact" })));
  const known = new Set(
    [...state.jobs, ...(state.pending ? [state.pending] : [])].flatMap((e) =>
      JSON.parse(e.body).records.map((r) => r.id),
    ),
  );
  const result = [];
  for (const raw of records) {
    let r;
    try {
      r = fields(raw.kind, raw, true);
    } catch (e) {
      // Ineligible capture is still visible, never truncated, rewritten or delegated.
      result.push({
        ...Object.fromEntries(
          Object.entries(raw).filter(([k]) =>
            [
              "kind",
              "email",
              "name",
              "source",
              "phone",
              "notes",
              "tag",
            ].includes(k),
          ),
        ),
        error: e.message,
      });
      continue;
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(r)),
    );
    const id = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (!known.has(id)) result.push({ id, ...r });
    known.add(id);
  }
  return result;
}

export function prepare(origin, records) {
  const state = ledger();
  if (state.pending)
    throw Error(
      "Resolve pending transfer before selecting another batch or destination.",
    );
  const body = JSON.stringify({
    version: 1,
    key: crypto.randomUUID().replaceAll("-", ""),
    records,
  });
  validateBatch(body, true);
  state.pending = { origin: validOrigin(origin), body };
  save(state); // Must succeed before network; frozen body + endpoint in one write.
}

export async function nativeRequest(origin, path, body) {
  validOrigin(origin);
  if (!globalThis.window?.__TAURI_INTERNALS__)
    throw Error("Sending requires the installed app with Tailscale connected.");
  return JSON.parse(
    await invoke("meeple_request", { origin, path, body: body ?? null }),
  );
}

export async function approveOrigin(origin) {
  const normalized = validOrigin(origin);
  const current = ledger();
  if (current.pending && current.pending.origin !== normalized)
    throw Error("Pending transfer pins its destination; retry it first.");
  if (!globalThis.window?.__TAURI_INTERNALS__)
    throw Error("Endpoint approval requires the installed app.");
  await invoke("meeple_approve_origin", { origin: normalized });
  localStorage.setItem("bgn.meeple.origin.v1", normalized);
  return normalized;
}

let sending = false;
export async function send(request = nativeRequest) {
  if (sending) throw Error("Transfer already in progress.");
  const state = ledger();
  if (!state.pending) throw Error("No pending transfer.");
  sending = true;
  try {
    const pending = state.pending;
    const result = await request(pending.origin, "/v1/jobs", pending.body);
    if (!JOB.test(result?.job))
      throw Error("Invalid receipt; retry the same batch.");
    const latest = ledger();
    if (
      latest.pending?.body !== pending.body ||
      latest.pending.origin !== pending.origin
    )
      throw Error("Pending transfer changed; reconcile before retry.");
    latest.jobs.push({
      ...pending,
      job: result.job,
      items: JSON.parse(pending.body).records.map((r) => ({
        id: r.id,
        status: r.kind === "signup" ? "received" : "stored_contact",
        evidence: "",
      })),
    });
    latest.pending = null;
    save(latest); // Failure retains original on-disk batch and blocks false success.
    return result.job;
  } finally {
    sending = false;
  }
}

export async function poll(job, request = nativeRequest) {
  const state = ledger();
  const entry = state.jobs.find((e) => e.job === job);
  if (!entry) throw Error("Unknown local receipt.");
  const response = await request(entry.origin, "/v1/jobs/" + job);
  const records = JSON.parse(entry.body).records;
  if (
    response?.job !== job ||
    !Array.isArray(response.items) ||
    response.items.length !== records.length ||
    new Set(response.items.map((r) => r.id)).size !== records.length
  )
    throw Error("Mismatched status response.");
  for (const item of response.items) {
    const record = records.find((r) => r.id === item.id);
    if (
      !record ||
      !(record.kind === "signup" ? STATES : ["stored_contact"]).includes(
        item.status,
      ) ||
      typeof item.evidence !== "string" ||
      item.evidence.length > 2000
    )
      throw Error("Invalid item outcome.");
  }
  // Reload after await: concurrent new capture/send must not be rolled back by polling.
  const latest = ledger();
  latest.jobs.find((e) => e.job === job).items = response.items.map(
    ({ id, status, evidence }) => ({ id, status, evidence }),
  );
  save(latest);
  return response;
}
