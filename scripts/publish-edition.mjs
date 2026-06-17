import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const input = process.argv[2];
if (!input) {
  console.error("Utilizare: npm run publish:edition -- data/drafts/YYYY-MM-DD.json");
  process.exit(1);
}

const root = process.cwd();
const inputPath = path.resolve(root, input);
const schema = JSON.parse(fs.readFileSync(path.join(root, "schema", "edition.schema.json"), "utf8"));
const edition = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

if (!validate(edition)) {
  console.error(validate.errors);
  process.exit(1);
}

const date = edition.metadata.editionDate;
if (path.basename(inputPath) !== `${date}.json`) {
  console.error(`Fișierul draft trebuie să se numească ${date}.json`);
  process.exit(1);
}

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
