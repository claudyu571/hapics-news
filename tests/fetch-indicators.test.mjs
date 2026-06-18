import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  enrichIndicators,
  fetchRobor,
  parseBnrRoborCsv,
} from "../scripts/fetch-indicators.mjs";

const fixture = (name) => fs.readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const response = (body, { ok = true, status = 200 } = {}) => ({ ok, status, text: async () => body });

test("BNR ROBOR parser validates the series and selects the latest observation", async () => {
  assert.deepEqual(parseBnrRoborCsv(await fixture("bnr-robor.csv")), {
    referenceDate: "2026-06-17",
    value: 5.84,
  });
  assert.throws(() => parseBnrRoborCsv('"Data";"Alta serie"\n"2026-06-17";"5.84"'), /BBZ_BOR3M/);
  assert.throws(() => parseBnrRoborCsv('"";"BBZ_BOR3M"\n'), /no valid/);
  assert.throws(() => parseBnrRoborCsv('"";"BBZ_BOR3M"\n"2026-02-30";"5.84"'), /no valid/);
});

test("ROBOR fetch accepts the previous business day and requests a bounded BNR export", async () => {
  const calls = [];
  const result = await fetchRobor({
    now: new Date("2026-06-18T04:30:00Z"),
    fetchImpl: async (url) => {
      calls.push(String(url));
      return response(await fixture("bnr-robor.csv"));
    },
  });

  assert.equal(result.value, 5.84);
  assert.equal(result.referenceDate, "2026-06-17");
  const url = new URL(calls[0]);
  assert.equal(url.origin + url.pathname, "https://www.bnr.ro/idbfiles");
  assert.equal(url.searchParams.get("dfrom"), "04-06-2026");
  assert.equal(url.searchParams.get("dto"), "18-06-2026");
  assert.equal(url.searchParams.get("format"), "CSV");
});

test("ROBOR fetch rejects observations older than seven calendar days", async () => {
  await assert.rejects(
    fetchRobor({
      now: new Date("2026-06-25T09:00:00Z"),
      fetchImpl: async () => response(await fixture("bnr-robor.csv")),
    }),
    /8 days old/,
  );
});

test("a failed ROBOR refresh preserves the value and marks it stale", async () => {
  const edition = {
    metadata: { editionDate: "2026-06-18" },
    indicators: [{
      id: "robor",
      label: "ROBOR 3M",
      value: 5.84,
      unit: "%",
      referenceDate: "2026-06-17",
      sourceName: "BNR",
      sourceUrl: "https://www.bnr.ro/1074-baza-de-date-interactiva",
      freshness: "current",
    }],
  };
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("nbrfxrates.xml")) {
      return response('<Cube date="2026-06-18"><Rate currency="EUR">5.1</Rate></Cube>');
    }
    if (target.includes("IndicesProfiles.aspx")) return response("Value: 12345.67");
    if (target.includes("/idbfiles")) throw new Error("BNR offline");
    throw new Error(`unexpected URL: ${target}`);
  };

  const summary = await enrichIndicators(edition, {
    now: new Date("2026-06-18T09:00:00Z"),
    fetchImpl,
  });

  const robor = edition.indicators.find((indicator) => indicator.id === "robor");
  assert.equal(robor.value, 5.84);
  assert.equal(robor.freshness, "stale");
  assert(summary.kept.includes("robor"));
});

test("a successful refresh replaces third-party ROBOR source metadata with BNR", async () => {
  const edition = {
    metadata: { editionDate: "2026-06-18" },
    indicators: [{
      id: "robor",
      label: "ROBOR 3M",
      value: 5.54,
      unit: "%",
      referenceDate: "2026-06-17",
      sourceName: "BNR via Trading Economics",
      sourceUrl: "https://tradingeconomics.com/romania/interbank-rate",
      freshness: "current",
    }],
  };
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("nbrfxrates.xml")) {
      return response('<Cube date="2026-06-18"><Rate currency="EUR">5.1</Rate></Cube>');
    }
    if (target.includes("IndicesProfiles.aspx")) return response("Value: 12345.67");
    if (target.includes("/idbfiles")) return response(await fixture("bnr-robor.csv"));
    throw new Error(`unexpected URL: ${target}`);
  };

  await enrichIndicators(edition, { now: new Date("2026-06-18T09:00:00Z"), fetchImpl });
  const robor = edition.indicators.find((indicator) => indicator.id === "robor");
  assert.equal(robor.value, 5.84);
  assert.equal(robor.sourceName, "BNR");
  assert.equal(robor.sourceUrl, "https://www.bnr.ro/1074-baza-de-date-interactiva");
  assert.equal(robor.freshness, "current");
});

test("a failed first ROBOR refresh remains unavailable", async () => {
  const edition = { metadata: { editionDate: "2026-06-18" }, indicators: [] };
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("nbrfxrates.xml")) {
      return response('<Cube date="2026-06-18"><Rate currency="EUR">5.1</Rate></Cube>');
    }
    if (target.includes("IndicesProfiles.aspx")) return response("Value: 12345.67");
    if (target.includes("/idbfiles")) return response("", { ok: false, status: 503 });
    throw new Error(`unexpected URL: ${target}`);
  };

  await enrichIndicators(edition, { now: new Date("2026-06-18T09:00:00Z"), fetchImpl });
  const robor = edition.indicators.find((indicator) => indicator.id === "robor");
  assert.equal(robor.value, null);
  assert.equal(robor.freshness, "unavailable");
});
