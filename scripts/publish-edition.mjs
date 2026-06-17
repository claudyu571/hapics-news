import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { enrichIndicators } from "./fetch-indicators.mjs";

const input = process.argv[2];
if (!input) {
  console.error("Utilizare: npm run publish:edition -- data/drafts/YYYY-MM-DD.json [--no-fetch]");
  process.exit(1);
}

const root = process.cwd();
const inputPath = path.resolve(root, input);
const schema = JSON.parse(fs.readFileSync(path.join(root, "schema", "edition.schema.json"), "utf8"));
const edition = JSON.parse(fs.readFileSync(inputPath, "utf8"));

// Refresh indicator values from official sources before validating/publishing.
// Best-effort: failed sources leave their indicator untouched, and only the
// current day's edition is enriched. Skip with --no-fetch (e.g. offline).
if (!process.argv.includes("--no-fetch")) {
  await enrichIndicators(edition, { log: (m) => console.log(m) });
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatBucharestTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const lookup = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const localUtcMs = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second),
  );
  const offsetMinutes = Math.round((localUtcMs - date.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const offsetHours = pad2(Math.floor(absolute / 60));
  const offsetMins = pad2(absolute % 60);

  return `${lookup.year}-${lookup.month}-${lookup.day}T${lookup.hour}:${lookup.minute}:${lookup.second}${sign}${offsetHours}:${offsetMins}`;
}

if (!validate(edition)) {
  console.error(validate.errors);
  process.exit(1);
}

const date = edition.metadata.editionDate;
if (path.basename(inputPath) !== `${date}.json`) {
  console.error(`Fișierul draft trebuie să se numească ${date}.json`);
  process.exit(1);
}

edition.metadata.updatedAt = formatBucharestTimestamp();
edition.metadata.status = "published";
const serialized = `${JSON.stringify(edition, null, 2)}\n`;
const archivePath = path.join(root, "data", "archive", `${date}.json`);
fs.writeFileSync(archivePath, serialized);
fs.writeFileSync(path.join(root, "data", "latest.json"), serialized);

const indexPath = path.join(root, "data", "archive", "index.json");
const index = fs.existsSync(indexPath)
  ? JSON.parse(fs.readFileSync(indexPath, "utf8"))
  : { editions: [] };
const label = new Intl.DateTimeFormat("ro-RO", { dateStyle: "long", timeZone: "Europe/Bucharest" })
  .format(new Date(`${date}T12:00:00+03:00`));
index.editions = [
  { date, label },
  ...index.editions.filter((entry) => entry.date !== date),
].sort((a, b) => b.date.localeCompare(a.date));
fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);

const check = spawnSync(process.execPath, [path.join(root, "scripts", "validate-data.mjs")], { stdio: "inherit" });
process.exit(check.status ?? 1);
