const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith("http://127.0.0.1:5179/")
        ? route.continue()
        : route.abort(),
    );
    await page.goto("http://127.0.0.1:5179/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "bgn.adds.v1",
        JSON.stringify([
          {
            kind: "one",
            email: "synthetic@example.org",
            name: "Synthetic signup",
            source: "Test fixture",
          },
        ]),
      );
      localStorage.setItem(
        "bgn.contacts.v1",
        JSON.stringify([
          {
            name: "Synthetic venue",
            email: "host@example.org",
            phone: "@synthetic-host",
            notes: "SYNTHETIC DATA ONLY. " + "x".repeat(300),
            tag: "Venue",
            ts: 1,
          },
        ]),
      );
      localStorage.setItem(
        "bgn.meeple.origin.v1",
        "https://synthetic.tailnet.ts.net:9443",
      );
    });
    await page.getByRole("button", { name: /Send to Meeple/ }).click();
    await page.getByText("2 existing records not yet sent").waitFor();
    await page.screenshot({
      path: "/tmp/meeple-preview-mobile.png",
      fullPage: true,
    });
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll(".meeple-content *")]
        .filter(
          (el) =>
            el.getBoundingClientRect().right > 390.5 ||
            (el.tagName !== "INPUT" && el.scrollWidth > el.clientWidth + 1),
        )
        .map((el) => ({
          tag: el.tagName,
          cls: el.className,
          right: el.getBoundingClientRect().right,
        })),
    );
    assert.deepEqual(overflow, [], "mobile contents must not overflow");
    await page.locator(".meeple-content").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.screenshot({
      path: "/tmp/meeple-records-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("checkbox", { name: "Send signup: Synthetic signup" })
      .check();
    await page
      .getByRole("button", { name: "Send 1 selected record", exact: true })
      .click();
    await page.getByText(/Nothing sent: use the installed app/).waitFor();
    assert.equal(
      await page.evaluate(() => localStorage.getItem("bgn.handoff.v1")),
      null,
    );
    assert.equal(await page.getByText(/Unknown delivery/).count(), 0);
    // Synthetic pending was explicitly prepared here, not by the refused browser send.
    await page.evaluate(async () => {
      const handoff = await import("/src/handoff.js");
      const { saveContact } = await import("/src/contacts.js");
      const { handoffScreen } = await import("/src/handoff-screen.js");
      handoff.prepare("https://synthetic.tailnet.ts.net:9443", [
        (await handoff.preview())[0],
      ]);
      saveContact({
        name: "Synthetic oversized contact",
        notes: "x".repeat(2001),
        tag: "Venue",
      });
      const queue = JSON.parse(localStorage.getItem("bgn.adds.v1"));
      queue.push({ kind: "one", email: "Synthetic Person <bad@example.org>" });
      localStorage.setItem("bgn.adds.v1", JSON.stringify(queue));
      document.getElementById("app").replaceChildren(handoffScreen());
    });
    await page
      .getByRole("button", { name: "Retry same batch", exact: true })
      .waitFor();
    assert.equal(await page.getByRole("alert").count(), 2);
    assert.match(
      await page.locator(".meeple-content").textContent(),
      /notes.*2000/,
    );
    assert.match(
      await page.locator(".meeple-content").textContent(),
      /Invalid signup email/,
    );
    assert.equal(
      await page
        .getByRole("checkbox", { name: /Synthetic oversized contact/ })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("checkbox", { name: /Synthetic Person/ })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("bgn.adds.v1")).length,
      ),
      2,
    );
    await page.screenshot({
      path: "/tmp/meeple-unknown-mobile.png",
      fullPage: true,
    });
    await page.getByRole("alert").first().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "/tmp/meeple-ineligible-mobile.png",
      fullPage: true,
    });
    assert.deepEqual(
      await page.evaluate(() =>
        [...document.querySelectorAll(".meeple-content *")]
          .filter(
            (el) =>
              el.getBoundingClientRect().right > 390.5 ||
              (el.tagName !== "INPUT" && el.scrollWidth > el.clientWidth + 1),
          )
          .map((el) => el.tagName),
      ),
      [],
      "ineligible records must wrap too",
    );
    // Synthetic status transport only: this does not submit anything to Google.
    await page.evaluate(async () => {
      const handoff = await import("/src/handoff.js");
      const { handoffScreen } = await import("/src/handoff-screen.js");
      await handoff.send(async () => ({ job: "a".repeat(32), received_at: 100 }));
      let refreshes = 0;
      const request = async () => {
        refreshes++;
        if (refreshes > 2) throw Error("Synthetic offline refresh");
        const id = JSON.parse(handoff.ledger().jobs[0].body).records[0].id;
        return { job: "a".repeat(32), received_at: 100, items: [{
          id, status: refreshes === 1 ? "already_member" : "added",
          evidence: "SYNTHETIC local observation only", received_at: 50,
          added_at: refreshes === 1 ? null : 75, verified_at: 200, updated: 200,
        }] };
      };
      document.getElementById("app").replaceChildren(handoffScreen({ request }));
    });
    await page.getByText("Submission received: 1970-01-01 00:01:40 UTC", { exact: true }).waitFor();
    await page.getByText("Date received (first record receipt): Unknown", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Refresh outcomes", exact: true }).click();
    await page.getByText("Already member", { exact: true }).waitFor();
    await page.getByText("Date added: Unknown", { exact: true }).waitFor();
    await page.getByText("Last membership verification recorded: 1970-01-01 00:03:20 UTC", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Refresh outcomes", exact: true }).click();
    await page.getByText("Date added: 1970-01-01 00:01:15 UTC", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Refresh outcomes", exact: true }).click();
    await page.getByText(/Couldn't refresh; showing last known outcomes/).waitFor();
    await page.getByText("Date added: 1970-01-01 00:01:15 UTC", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() =>
      [...document.querySelectorAll(".meeple-content *")].filter((el) =>
        el.getBoundingClientRect().right > 390.5 ||
        (el.tagName !== "INPUT" && el.scrollWidth > el.clientWidth + 1),
      ).map((el) => el.tagName),
    ), [], "timestamps must fit the mobile screen");
    await page.getByText("Date added: 1970-01-01 00:01:15 UTC", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/meeple-ledger-dates-mobile.png", fullPage: true });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        mobile390: true,
        preview: true,
        browserSendBlockedBeforePrepare: true,
        ineligibleRecordsVisible: true,
        pendingRetryStillAccessible: true,
        originalsRetained: true,
        separateReceiptAdditionVerificationDates: true,
        alreadyMemberAdditionUnknown: true,
        manualRefreshRetainsDatesOffline: true,
        pageErrors: errors,
        screenshots: [
          "/tmp/meeple-preview-mobile.png",
          "/tmp/meeple-unknown-mobile.png",
          "/tmp/meeple-ineligible-mobile.png",
          "/tmp/meeple-ledger-dates-mobile.png",
        ],
      }),
    );
    await page.evaluate(() => localStorage.clear());
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
