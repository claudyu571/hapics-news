import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Fetch indicator values from official sources and merge them into a draft
 * edition (matched by indicator id).
 *
 * Usage:
 *   node scripts/fetch-indicators.mjs data/drafts/YYYY-MM-DD.json          # dry run
 *   node scripts/fetch-indicators.mjs data/drafts/YYYY-MM-DD.json --write  # update the draft
 *
 * Principles:
 *   - Never fabricate. If a source can't be fetched or parsed, the indicator
 *     is left value:null / freshness:"unavailable" with an explanatory note.
 *   - Never block the pipeline. Exits 0 even when some sources fail (unless
 *     --strict is passed). Run this BEFORE publish:edition, not inside build.
 */

const TIMEOUT_MS = 15000;
const USER_AGENT = "hapics-news-indicators/1.0 (+https://news.hapics.uk)";

async function getText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function todayInBucharest() {
  // en-CA renders YYYY-MM-DD; the explicit timeZone keeps it stable anywhere.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest" }).format(new Date());
}

/**
 * Parse a number that may use Romanian (1.234,56) or English (1,234.56)
 * grouping. Returns null when the input isn't a finite number.
 */
export function parseLocaleNumber(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const decimalSep = lastComma > lastDot ? "," : lastDot > lastComma ? "." : "";
  if (decimalSep) {
    const groupSep = decimalSep === "," ? "." : ",";
    s = s.split(groupSep).join("").replace(decimalSep, ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Extract a BVB index level from its server-rendered profile page. */
export function parseBvbIndexValue(html) {
  // BVB has no public JSON API; the IndicesProfiles page renders the level
  // server-side. Grab the first index-scale number (>= 100, with decimals)
  // that appears near a value marker. Tolerant of ro/en number formats.
  const candidates = [
    /(?:Valoare|Value|Pret|Last)[^0-9]{0,40}([0-9][0-9.,]{3,})/i,
    /class="[^"]*(?:value|price|last)[^"]*"[^>]*>\s*([0-9][0-9.,]{3,})/i,
  ];
  for (const re of candidates) {
    const n = parseLocaleNumber(html.match(re)?.[1]);
    if (n != null && n >= 100) return n;
  }
  return null;
}

function bvbIndexSource(symbol) {
  return {
    label: `Indice ${symbol}`,
    async fetch() {
      const html = await getText(
        `https://www.bvb.ro/FinancialInstruments/Indices/IndicesProfiles.aspx?i=${symbol}`,
      );
      const value = parseBvbIndexValue(html);
      if (value == null) throw new Error(`could not parse ${symbol} level from BVB page`);
      return {
        value,
        unit: "puncte",
        referenceDate: todayInBucharest(),
        freshness: "current",
        note: `Captură automată BVB pentru indicele ${symbol}.`,
      };
    },
  };
}

// Optional environment override for BNR's ROBOR endpoint (their site was
// redesigned; set this to the current daily-fixing URL once confirmed).
const BNR_ROBOR_URL = process.env.BNR_ROBOR_URL || null;

const SOURCES = {
  "eur-ron": {
    label: "EUR/RON",
    async fetch() {
      const xml = await getText("https://www.bnr.ro/nbrfxrates.xml");
      const referenceDate = xml.match(/<Cube date="([^"]+)"/)?.[1];
      const eur = xml.match(/<Rate currency="EUR"[^>]*>([\d.]+)<\/Rate>/)?.[1];
      if (!eur || !referenceDate) throw new Error("EUR rate not found in BNR XML");
      return {
        value: Number(eur),
        unit: "lei",
        referenceDate,
        freshness: "current",
        note: "Curs de referință BNR, preluat automat din nbrfxrates.xml.",
      };
    },
  },

  bet: bvbIndexSource("BET"),
  rotx: bvbIndexSource("ROTX"),

  // ROBOR is a DAILY interbank rate published by BNR every business day.
  robor: {
    label: "ROBOR 3M",
    async fetch() {
      if (!BNR_ROBOR_URL) {
        throw new Error("BNR_ROBOR_URL not configured (BNR site redesigned; set the current endpoint)");
      }
      const text = await getText(BNR_ROBOR_URL);
      const value = parseLocaleNumber(text.match(/ROBOR[^0-9]{0,40}([0-9]+[.,][0-9]+)/i)?.[1]);
      if (value == null) throw new Error("could not parse ROBOR from BNR source");
      return { value, unit: "%", referenceDate: todayInBucharest(), freshness: "current",
        note: "Fixing ROBOR 3M publicat de BNR, preluat automat." };
    },
  },

  // IRCC is QUARTERLY: recalculated once per quarter and applied with a lag.
  // It is not a daily fetch — maintain the official value per quarter here
  // (update ~4x/year) keyed by "YYYY-Qn". freshness "stale" marks it as a
  // reference value rather than a live reading.
  ircc: {
    label: "IRCC",
    async fetch() {
      const byQuarter = {
        // "2026-Q2": 6.10,  // <- fill from BNR's published IRCC each quarter
      };
      const now = new Date();
      const month = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", month: "numeric" }).format(now));
      const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric" }).format(now);
      const quarter = `${year}-Q${Math.ceil(month / 3)}`;
      const value = byQuarter[quarter];
      if (value == null) throw new Error(`IRCC value for ${quarter} not set`);
      return { value, unit: "%", referenceDate: `${quarter}`, freshness: "stale",
        note: `IRCC valabil pentru ${quarter}, publicat de BNR (recalculat trimestrial).` };
    },
  },
};

function applyResult(indicator, result) {
  indicator.value = result.value;
  indicator.referenceDate = result.referenceDate ?? indicator.referenceDate;
  indicator.freshness = result.freshness ?? indicator.freshness;
  if (result.unit) indicator.unit = result.unit;
  if (result.note) indicator.note = result.note;
}

function markUnavailable(indicator, reason) {
  indicator.value = null;
  indicator.freshness = "unavailable";
  indicator.note = `Valoare indisponibilă la preluarea automată (${reason}).`;
}

async function main() {
  const input = process.argv[2];
  const write = process.argv.includes("--write");
  const strict = process.argv.includes("--strict");
  if (!input) {
    console.error("Utilizare: node scripts/fetch-indicators.mjs <draft.json> [--write] [--strict]");
    process.exit(1);
  }

  const draftPath = path.resolve(process.cwd(), input);
  const edition = JSON.parse(fs.readFileSync(draftPath, "utf8"));
  let failures = 0;

  for (const indicator of edition.indicators) {
    const source = SOURCES[indicator.id];
    if (!source) {
      console.log(`· ${indicator.id}: fără sursă automată (lăsat neschimbat)`);
      continue;
    }
    try {
      const result = await source.fetch();
      applyResult(indicator, result);
      console.log(`✓ ${indicator.id}: ${result.value} ${result.unit ?? indicator.unit} (${result.referenceDate})`);
    } catch (error) {
      failures += 1;
      markUnavailable(indicator, error.message);
      console.log(`✗ ${indicator.id}: ${error.message} → indisponibil`);
    }
  }

  if (write) {
    fs.writeFileSync(draftPath, `${JSON.stringify(edition, null, 2)}\n`);
    console.log(`\nActualizat ${path.relative(process.cwd(), draftPath)}`);
  } else {
    console.log("\n(dry run — folosește --write pentru a actualiza draftul)");
  }

  process.exit(strict && failures > 0 ? 1 : 0);
}

// Run only when invoked directly, so the parsers can be imported for tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
