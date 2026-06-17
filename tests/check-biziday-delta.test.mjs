import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  HOME_URL,
  RSS_URL,
  canonicalizeBizidayUrl,
  detectBizidayDelta,
  parseHomepage,
  parseRss,
  selectCandidates,
} from "../scripts/check-biziday-delta.mjs";

const fixture = (name) => fs.readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const response = (body, { ok = true, status = 200 } = {}) => ({ ok, status, text: async () => body });

test("RSS parser extracts canonical article data", async () => {
  const items = parseRss(await fixture("biziday-feed.xml"));

  assert.equal(items.length, 3);
  assert.equal(items[0].url, "https://www.biziday.ro/333-2/");
  assert.equal(items[0].publishedAt, "2026-06-17T10:45:00.000Z");
  assert.equal(canonicalizeBizidayUrl("https://biziday.ro/333-2/?x=1#fragment"), items[0].url);
});

test("candidate selection removes known and old articles", async () => {
  const edition = JSON.parse(await fixture("biziday-latest.json"));
  const candidates = selectCandidates(parseRss(await fixture("biziday-feed.xml")), edition);

  assert.deepEqual(candidates, [{
    title: "Articol nou cu impact pentru economia României",
    url: "https://www.biziday.ro/333-2/",
    publishedAt: "2026-06-17T10:45:00.000Z",
  }]);
});

test("detector falls back to the homepage when RSS is unavailable", async () => {
  const edition = JSON.parse(await fixture("biziday-latest.json"));
  const homepage = await fixture("biziday-homepage.html");
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === RSS_URL) throw new Error("feed offline");
    if (url === HOME_URL) return response(homepage);
    throw new Error(`unexpected URL: ${url}`);
  };

  const result = await detectBizidayDelta(edition, {
    fetchImpl,
    now: new Date("2026-06-17T11:30:00Z"),
  });

  assert.deepEqual(calls, [RSS_URL, HOME_URL]);
  assert.equal(result.source, "homepage");
  assert.equal(result.candidateCount, 1);
  assert.equal(result.candidates[0].url, "https://www.biziday.ro/555-2/");
  assert.equal(parseHomepage(homepage).length, 2);
});

test("detector fails safely when both Biziday sources are unavailable", async () => {
  const edition = JSON.parse(await fixture("biziday-latest.json"));
  await assert.rejects(
    detectBizidayDelta(edition, { fetchImpl: async () => { throw new Error("offline"); } }),
    /Biziday indisponibil/,
  );
});

test("a fully known feed is a no-op", async () => {
  const edition = JSON.parse(await fixture("biziday-latest.json"));
  edition.sources.push({ url: "https://www.biziday.ro/333-2/" });

  assert.deepEqual(selectCandidates(parseRss(await fixture("biziday-feed.xml")), edition), []);
});
