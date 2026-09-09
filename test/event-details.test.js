// SYNTHETIC public calendar fixtures — no real event/contact data.
import test from "node:test";
import assert from "node:assert/strict";
import { parseCalendarEvents } from "../src/luma.js";

const page = (items) =>
  `<script id="__NEXT_DATA__">${JSON.stringify({
    props: { pageProps: { initialData: { data: { featured_items: items } } } },
  })}</script>`;
const entry = (event = {}, platform = "luma") => ({
  platform,
  event: {
    api_id: "evt-Synthetic",
    name: "SYNTHETIC night",
    url: "synthetic-night",
    ...event,
  },
});
const parse = (event, platform) =>
  parseCalendarEvents(page([entry(event, platform)]))?.[0];

test("calendar retains full postal address independently of venue and public text description", () => {
  const e = parse({
    description: "  SYNTHETIC public details\nBring games.  ",
    geo_address_visibility: "public",
    geo_address_info: {
      mode: "shown",
      address: "SYNTHETIC Hall",
      full_address: "  123 Example St, Testville, MA 00000, USA  ",
    },
  });
  assert.equal(e.fullAddress, "123 Example St, Testville, MA 00000, USA");
  assert.equal(e.venue, "SYNTHETIC Hall");
  assert.equal(e.description, "SYNTHETIC public details\nBring games.");
  assert.equal(e.url, "https://luma.com/synthetic-night");
});

test("missing or nonpublic addresses never fall back to venue/city or leak hidden full address", () => {
  for (const event of [
    {},
    {
      geo_address_info: {
        mode: "shown",
        address: "SYNTHETIC Hall",
        city_state: "Testville, MA",
      },
    },
    ...["obfuscated", "hidden", "registration", "unknown"].map((mode) => ({
      geo_address_info: {
        mode,
        full_address: "DO NOT EXPOSE",
        address: "DO NOT EXPOSE",
        city_state: "Testville, MA",
      },
    })),
    ...["private", "guests", "registered"].map((geo_address_visibility) => ({
      geo_address_visibility,
      geo_address_info: {
        mode: "shown",
        full_address: "DO NOT EXPOSE",
        address: "DO NOT EXPOSE",
        city_state: "Testville, MA",
      },
    })),
  ]) {
    const e = parse(event);
    assert.equal(e.fullAddress, null);
    assert.doesNotMatch(e.venue || "", /DO NOT EXPOSE/);
    assert.equal(e.description, null);
  }
  assert.equal(
    parse({
      description: { html: "not text" },
      geo_address_info: { mode: "shown", full_address: {} },
    }).fullAddress,
    null,
  );
  assert.equal(parse({ description: { html: "not text" } }).description, null);
});

test("external entries retain original URLs and survive without a Luma id or slug", () => {
  const e = parse(
    { api_id: undefined, url: "https://example.org/event/123?source=calendar" },
    "external",
  );
  assert.ok(e, "external event must not disappear");
  assert.equal(e.url, "https://example.org/event/123?source=calendar");
  assert.equal(e.slug, null);
});

test("external event without usable URL or Luma id survives for calendar fallback", () => {
  for (const url of ["external-slug", undefined]) {
    const e = parse({ api_id: undefined, url }, "external");
    assert.ok(e, "recognized external event remains visible");
    assert.equal(e.url, null);
    assert.equal(e.slug, null);
  }
});

test("calendar URLs reject unsafe schemes, credentials and invented external slugs", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "//evil.test/path",
    "https://user:pass@example.org/x",
    "bad slug",
    "https://luma.com/../evil",
    "https://luma.com\\@evil.test/x",
  ]) {
    const e = parse({ url });
    assert.equal(e.url, null, url);
    assert.equal(e.slug, null, url);
  }
  assert.equal(parse({ url: "external-slug" }, "external").url, null);
  assert.equal(
    parse({ url: "https://lu.ma/synthetic?utm_source=test" }).url,
    "https://luma.com/synthetic",
  );
});
