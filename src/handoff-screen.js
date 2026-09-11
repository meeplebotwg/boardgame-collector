import { h, header } from "./ui.js";
import { back } from "./router.js";
import {
  preview,
  ledger,
  prepare,
  send,
  poll,
  nativeRequest,
  approveOrigin,
} from "./handoff.js";

const labels = {
  received: "Received — awaiting processing",
  stored_contact: "Stored private contact — not a mailing signup",
  added: "Added",
  already_member: "Already member",
  invitation_required: "Invitation required — not added",
  blocked: "Blocked",
  needs_verification: "Needs verification — do not retry Google blindly",
};

export function handoffScreen({
  request = nativeRequest,
  approve = approveOrigin,
} = {}) {
  const main = h("main", { class: "content meeple-content" });
  const notice = h("p", { role: "status", "aria-live": "polite" });
  const root = h(
    "div",
    { class: "screen" },
    header("Private Tailscale handoff", "Send to Meeple", back),
    main,
  );
  let busy = false;
  async function paint() {
    try {
      const state = ledger();
      let records = [];
      let previewError = null;
      try {
        records = await preview();
      } catch (e) {
        previewError = h(
          "p",
          { role: "alert" },
          `Can't preview local capture: ${e.message} Transfer history and retry remain available.`,
        );
      }
      const selected = new Set();
      const endpoint = h("input", {
        class: "input",
        "aria-label": "Meeple endpoint",
        placeholder: "https://your-host.your-tailnet.ts.net:port",
        value:
          state.pending?.origin ??
          localStorage.getItem("bgn.meeple.origin.v1") ??
          "",
      });
      endpoint.disabled = !!state.pending;
      const saveEndpoint = h(
        "button",
        {
          class: "btn-secondary",
          onclick: async () => {
            try {
              await approve(endpoint.value);
              notice.textContent =
                "Exact destination approved on this installation.";
            } catch (e) {
              notice.textContent = e.message;
            }
          },
        },
        "Approve this exact destination",
      );
      saveEndpoint.disabled = !!state.pending;
      const destination = h(
        "div",
        { class: "card" },
        h("label", {}, "Private receiver destination", endpoint),
        saveEndpoint,
        h(
          "p",
          {},
          "Check this exact hostname and port with the host owner. Tailscale must be connected on your phone. Capture still works offline.",
        ),
      );
      const submit = h(
        "button",
        {
          class: "cta",
          onclick: async () => {
            if (busy || !selected.size) return;
            try {
              if (
                endpoint.value !== localStorage.getItem("bgn.meeple.origin.v1")
              )
                throw Error("Approve the exact destination first.");
              if (
                request === nativeRequest &&
                !globalThis.window?.__TAURI_INTERNALS__
              )
                throw Error(
                  "Nothing sent: use the installed app with Tailscale connected. No batch saved.",
                );
              prepare(
                endpoint.value,
                records.filter((r) => selected.has(r.id)),
              );
              await transfer();
            } catch (e) {
              notice.textContent = e.message;
            }
          },
        },
        "Select records to send",
      );
      submit.disabled = true;
      const rows = records.map((r) => {
        const check = h("input", {
          type: "checkbox",
          "aria-label": `Send ${r.kind}: ${r.name || r.email}`,
          onchange: () => {
            if (check.disabled) return;
            if (check.checked) selected.add(r.id);
            else selected.delete(r.id);
            submit.disabled =
              busy || !!state.pending || !selected.size || selected.size > 100;
            submit.textContent = selected.size
              ? `Send ${selected.size} selected record${selected.size === 1 ? "" : "s"}`
              : "Select records to send";
          },
        });
        check.disabled = !!state.pending || !!r.error;
        return h(
          "label",
          { class: "card meeple-record" },
          check,
          h(
            "div",
            { class: "stack" },
            h(
              "strong",
              {},
              r.kind === "signup"
                ? "Mailing signup · bgn-wg"
                : "Private contact · never enroll",
            ),
            ...Object.entries(r)
              .filter(([k, v]) => !["id", "kind", "error"].includes(k) && v)
              .map(([k, v]) => h("div", {}, `${k}: ${v}`)),
            r.error
              ? h(
                  "p",
                  { role: "alert" },
                  `Not eligible for handoff: ${r.error} You can send other eligible records; this original stays on the device.`,
                )
              : null,
          ),
        );
      });
      const pending = state.pending
        ? h(
            "div",
            { class: "card" },
            h("strong", {}, "Unknown delivery — saved batch needs retry"),
            h(
              "p",
              {},
              `Frozen destination: ${state.pending.origin}. Cancel or leaving this screen does not discard the batch or prove failure.`,
            ),
            h(
              "button",
              { class: "cta", onclick: transfer },
              "Retry same batch",
            ),
          )
        : null;
      const jobs = [...state.jobs].reverse().map((job) =>
        h(
          "section",
          { class: "card" },
          h("strong", {}, "Receipt · " + job.job),
          h("div", {}, job.origin),
          ...job.items.map((item) => {
            const r = JSON.parse(job.body).records.find(
              (r) => r.id === item.id,
            );
            return h(
              "div",
              { class: "stack" },
              h("strong", {}, r.name || r.email),
              h("div", {}, r.email || r.phone || ""),
              h("div", {}, labels[item.status]),
              item.evidence ? h("div", {}, item.evidence) : null,
            );
          }),
          h(
            "button",
            {
              class: "btn-secondary",
              onclick: async (e) => {
                e.currentTarget.disabled = true;
                try {
                  await poll(job.job, request);
                  notice.textContent = "Outcomes refreshed from receiver.";
                } catch {
                  notice.textContent =
                    "Couldn't refresh; showing last known outcomes, not new confirmation.";
                }
                await paint();
              },
            },
            "Refresh outcomes",
          ),
        ),
      );
      main.replaceChildren(
        h(
          "div",
          { class: "card" },
          h(
            "p",
            {},
            "Only selected records are shared with Meeple for club logistics, including its configured model provider. Notes are data, not instructions. No automatic outreach.",
          ),
          h(
            "p",
            {},
            "Received means safely stored, NOT added to Google Groups. Owner login and computer-use access are required for processing.",
          ),
          h(
            "p",
            {},
            "All phone contacts and signups stay on this device. Delegated signups are held out of manual drain to avoid duplicate work. After reinstall/restore, reconcile with the host before manual adds.",
          ),
        ),
        destination,
        notice,
        ...(pending ? [pending] : []),
        h(
          "h2",
          { class: "card-title" },
          `${records.length} existing record${records.length === 1 ? "" : "s"} not yet sent`,
        ),
        h("p", {}, "Select up to 100. Nothing uploads automatically."),
        ...(previewError ? [previewError] : []),
        ...rows,
        submit,
        ...jobs,
      );
    } catch (e) {
      main.replaceChildren(
        h(
          "p",
          { role: "alert" },
          `Can't read local records: ${e.message} Nothing sent or cleared.`,
        ),
      );
    }
  }
  async function transfer() {
    if (busy) return;
    busy = true;
    main.querySelectorAll("button").forEach((b) => {
      b.disabled = true;
    });
    notice.textContent =
      "Sending saved batch… Leaving does not cancel a possible receipt.";
    try {
      await send(request);
      notice.textContent =
        "Received — originals retained. Membership has not been confirmed.";
    } catch {
      notice.textContent =
        "Unknown delivery. Check Tailscale and retry the same batch; nothing cleared.";
    } finally {
      busy = false;
      await paint();
    }
  }
  void paint();
  return root;
}
