import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Fetch indicator values from official sources and merge them into an edition
 * (matched by indicator id). Used both as a CLI and as a library by
 * publish-edition.mjs.
 *
 * CLI:
 *   node scripts/fetch-indicators.mjs data/drafts/YYYY-MM-DD.json          # dry run
 *   node scripts/fetch-indicators.mjs data/drafts/YYYY-MM-DD.json --write  # update the file
 *
 * Principles:
 *   - Enrich, never destroy. A successful fetch overwrites the value; a failed
 *     fetch leaves the indicator exactly as it was (manual values survive).
 *   - Never fabricate. Sources that can't be read simply don't update.
 *   - Only the current day's edition is enriched, so re-publishing an archived
 *     draft never stamps today's live prices onto a past date.
 */

const TIMEOUT_MS = 15000;
const USER_AGENT = "hapics-news-indicators/1.0 (+https://news.hapics.uk)";

// BNR redesigned their site; set this to the current daily ROBOR endpoint to
// enable automatic ROBOR updates. Until then ROBOR is left as the draft has it.
const BNR_ROBOR_URL = process.env.BNR_ROBOR_URL || null;

// IRCC is quarterly — recalculated once per quarter. Add each quarter's
// official value here (keyed "YYYY-Qn"); ~4 edits per year.
const IRCC_BY_QUARTER = {
  "2026-Q2": 5.58, // valabil 1 apr – 30 iun 2026 (publicat 31 mar 2026)
  "2026-Q3": 5.56, // valabil de la 1 iul 2026
};

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

export function todayInBucharest() {
  // en-CA renders YYYY-MM-DD; the explicit timeZone keeps it stable anywhere.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest" }).format(new Date());
}

function currentQuarter() {
  const now = new Date();
  const fmt = (opts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", ...opts }).format(now);
  const month = Number(fmt({ month: "numeric" }));
  const year = fmt({ year: "numeric" });
  const q = Math.ceil(month / 3);
  return { year, q, label: `${year}-Q${q}`, start: `${year}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01` };
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
  // near a value marker. Tolerant of ro/en number formats.
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

async function fetchEurRon() {
  const xml = await getText("https://www.bnr.ro/nbrfxrates.xml");
  const referenceDate = xml.match(/<Cube date="([^"]+)"/)?.[1];
  const eur = xml.match(/<Rate currency="EUR"[^>]*>([\d.]+)<\/Rate>/)?.[1];
  if (!eur || !referenceDate) throw new Error("EUR rate not found in BNR XML");
  return { value: Number(eur), unit: "lei", referenceDate, freshness: "current",
    note: "Curs de referință BNR, preluat automat din nbrfxrates.xml." };
}

function bvbIndexFetcher(symbol) {
  return async () => {
    const html = await getText(
      `https://www.bvb.ro/FinancialInstruments/Indices/IndicesProfiles.aspx?i=${symbol}`,
    );
    const value = parseBvbIndexValue(html);
    if (value == null) throw new Error(`could not parse ${symbol} level from BVB page`);
    return { value, unit: "puncte", referenceDate: todayInBucharest(), freshness: "current",
      note: `Captură automată BVB pentru indicele ${symbol}.` };
  };
}

async function fetchRobor() {
  // ROBOR is a daily BNR fixing, but BNR's redesigned site has no clean
  // machine-readable endpoint. Configure BNR_ROBOR_URL to enable this.
  if (!BNR_ROBOR_URL) throw new Error("BNR_ROBOR_URL not configured");
  const text = await getText(BNR_ROBOR_URL);
  const value = parseLocaleNumber(text.match(/ROBOR[^0-9]{0,40}([0-9]+[.,][0-9]+)/i)?.[1]);
  if (value == null) throw new Error("could not parse ROBOR from BNR source");
  return { value, unit: "%", referenceDate: todayInBucharest(), freshness: "current",
    note: "Fixing ROBOR 3M publicat de BNR, preluat automat." };
}

async function fetchIrcc() {
  const { label, start } = currentQuarter();
  const value = IRCC_BY_QUARTER[label];
  if (value == null) throw new Error(`IRCC value for ${label} not set in IRCC_BY_QUARTER`);
  return { value, unit: "%", referenceDate: start, freshness: "current",
    note: `IRCC valabil pentru ${label}, publicat de BNR (recalculat trimestrial).` };
}

// Indicators kept current automatically. Each row is ensured to exist before
// fetching, so the standard set (incl. ROTX and the ROBOR/IRCC split) persists
// across editions even if the upstream draft omits it.
const MANAGED = [
  { id: "eur-ron", label: "EUR/RON", unit: "lei",
    sourceName: "BNR", sourceUrl: "https://www.bnr.ro/nbrfxrates.xml", fetch: fetchEurRon },
  { id: "bet", label: "Indice BET", unit: "puncte",
    sourceName: "BVB", sourceUrl: "https://www.bvb.ro/FinancialInstruments/Indices/IndicesProfiles.aspx?i=BET", fetch: bvbIndexFetcher("BET") },
  { id: "rotx", label: "Indice ROTX", unit: "puncte",
    sourceName: "BVB / Wiener Börse", sourceUrl: "https://www.bvb.ro/FinancialInstruments/Indices/IndicesProfiles.aspx?i=ROTX", fetch: bvbIndexFetcher("ROTX") },
  { id: "robor", label: "ROBOR 3M", unit: "%",
    sourceName: "BNR", sourceUrl: "https://www.bnr.ro/", fetch: fetchRobor },
  { id: "ircc", label: "IRCC", unit: "%",
    sourceName: "BNR", sourceUrl: "https://www.bnr.ro/", fetch: fetchIrcc },
];

function ensureIndicator(edition, managed) {
  let indicator = edition.indicators.find((i) => i.id === managed.id);
  if (!indicator) {
    indicator = {
      id: managed.id,
      label: managed.label,
      value: null,
      unit: managed.unit,
      referenceDate: edition.metadata.editionDate,
      sourceName: managed.sourceName,
      sourceUrl: managed.sourceUrl,
      freshness: "unavailable",
    };
    edition.indicators.push(indicator);
  }
  return indicator;
}

/**
 * Enrich an edition's indicators in place. Returns a summary.
 * Only runs for the current day's edition; failures leave values untouched.
 */
export async function enrichIndicators(edition, { log = () => {} } = {}) {
  const summary = { updated: [], kept: [], skipped: false };
  if (edition.metadata.editionDate !== todayInBucharest()) {
    summary.skipped = true;
    log(`· indicatori: ediție non-curentă (${edition.metadata.editionDate}) — fără preluare automată`);
    return summary;
  }
  for (const managed of MANAGED) {
    const indicator = ensureIndicator(edition, managed);
    try {
      const result = await managed.fetch();
      indicator.value = result.value;
      if (result.unit) indicator.unit = result.unit;
      if (result.referenceDate) indicator.referenceDate = result.referenceDate;
      if (result.freshness) indicator.freshness = result.freshness;
      if (result.note) indicator.note = result.note;
      summary.updated.push(managed.id);
      log(`✓ ${managed.id}: ${indicator.value} ${indicator.unit} (${indicator.referenceDate})`);
    } catch (error) {
      summary.kept.push(managed.id);
      log(`· ${managed.id}: ${error.message} → păstrez valoarea existentă (${indicator.value ?? "indisponibil"})`);
    }
  }
  return summary;
}

async function main() {
  const input = process.argv[2];
  const write = process.argv.includes("--write");
  if (!input) {
    console.error("Utilizare: node scripts/fetch-indicators.mjs <edition.json> [--write]");
    process.exit(1);
  }
  const filePath = path.resolve(process.cwd(), input);
  const edition = JSON.parse(fs.readFileSync(filePath, "utf8"));

  await enrichIndicators(edition, { log: (m) => console.log(m) });

  if (write) {
    fs.writeFileSync(filePath, `${JSON.stringify(edition, null, 2)}\n`);
    console.log(`\nActualizat ${path.relative(process.cwd(), filePath)}`);
  } else {
    console.log("\n(dry run — folosește --write pentru a actualiza fișierul)");
  }
  process.exit(0);
}

// Run only when invoked directly, so the exports can be imported elsewhere.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
