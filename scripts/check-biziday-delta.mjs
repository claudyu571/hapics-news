import fs from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const RSS_URL = "https://www.biziday.ro/feed/";
export const HOME_URL = "https://www.biziday.ro/";

const DEFAULT_OVERLAP_MINUTES = 30;
const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT = "hapics-news-delta/1.0 (+https://news.hapics.uk)";

function decodeEntities(value) {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&(?:amp|#038);/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#039;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function cleanText(value) {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toIsoDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function readTag(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"))?.[1] ?? "";
}

function readAttribute(block, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2] ?? "";
}

export function canonicalizeBizidayUrl(rawUrl) {
  try {
    const parsed = new URL(decodeEntities(rawUrl), HOME_URL);
    if (!/^(?:www\.)?biziday\.ro$/i.test(parsed.hostname)) return null;
    parsed.protocol = "https:";
    parsed.hostname = "www.biziday.ro";
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/`;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function parseRss(xml) {
  const items = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const url = canonicalizeBizidayUrl(readTag(block, "link"));
    const title = cleanText(readTag(block, "title"));
    const publishedAt = toIsoDate(cleanText(readTag(block, "pubDate")));
    if (url && title && publishedAt) {
      items.push({ title, url, publishedAt });
    }
  }
  return items;
}

export function parseHomepage(html) {
  const items = [];
  const anchorPattern = /<a\b[^>]*class=(["'])[^"']*\bpost-url\b[^"']*\1[^>]*>[\s\S]*?<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const block = match[0];
    const url = canonicalizeBizidayUrl(readAttribute(block, "href"));
    const title = cleanText(readAttribute(block, "title"));
    const rawDate = readAttribute(block.match(/<time\b[^>]*>/i)?.[0] ?? "", "datetime");
    const publishedAt = toIsoDate(rawDate);
    if (url && title && publishedAt) {
      items.push({ title, url, publishedAt });
    }
  }
  return items;
}

function knownSourceUrls(edition) {
  return new Set([
    ...(edition.importantNews ?? []).map((item) => item.sourceUrl),
    ...(edition.sources ?? []).map((item) => item.url),
  ].map(canonicalizeBizidayUrl).filter(Boolean));
}

export function selectCandidates(items, edition, { overlapMinutes = DEFAULT_OVERLAP_MINUTES } = {}) {
  const updatedAt = Date.parse(edition?.metadata?.updatedAt);
  if (!Number.isFinite(updatedAt)) {
    throw new Error("data ediției nu conține metadata.updatedAt valid");
  }

  const cutoff = updatedAt - overlapMinutes * 60_000;
  const known = knownSourceUrls(edition);
  const unique = new Map();

  for (const item of items) {
    const url = canonicalizeBizidayUrl(item.url);
    const publishedAt = Date.parse(item.publishedAt);
    if (!url || known.has(url) || !Number.isFinite(publishedAt) || publishedAt < cutoff) continue;

    const current = unique.get(url);
    if (!current || Date.parse(current.publishedAt) < publishedAt) {
      unique.set(url, {
        title: cleanText(item.title),
        url,
        publishedAt: new Date(publishedAt).toISOString(),
      });
    }
  }

  return [...unique.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

async function fetchText(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { "user-agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function detectBizidayDelta(edition, { fetchImpl = fetch, now = new Date() } = {}) {
  const errors = [];
  const sources = [
    { name: "rss", url: RSS_URL, parse: parseRss },
    { name: "homepage", url: HOME_URL, parse: parseHomepage },
  ];

  for (const source of sources) {
    try {
      const body = await fetchText(source.url, fetchImpl);
      const items = source.parse(body);
      if (items.length === 0) throw new Error("niciun articol detectat");
      const candidates = selectCandidates(items, edition);
      return {
        checkedAt: now.toISOString(),
        source: source.name,
        candidateCount: candidates.length,
        candidates,
      };
    } catch (error) {
      errors.push(`${source.name}: ${error.message}`);
    }
  }

  throw new Error(`Biziday indisponibil (${errors.join("; ")})`);
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Utilizare: npm run news:delta -- data/latest.json");
    process.exitCode = 1;
    return;
  }

  try {
    const edition = JSON.parse(await fs.readFile(inputPath, "utf8"));
    const result = await detectBizidayDelta(edition);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(`news:delta: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
