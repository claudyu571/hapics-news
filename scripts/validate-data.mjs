import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = process.cwd();
const schemaPath = path.join(root, "schema", "edition.schema.json");
const dataDir = path.join(root, "data");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const editionFiles = [path.join(dataDir, "latest.json")];
const archiveDir = path.join(dataDir, "archive");

for (const name of fs.readdirSync(archiveDir).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort()) {
  editionFiles.push(path.join(archiveDir, name));
}

let failed = false;
const seenDates = new Set();

for (const file of editionFiles) {
  const relative = path.relative(root, file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`✗ ${relative}: JSON invalid (${error.message})`);
    failed = true;
    continue;
  }

  if (!validate(data)) {
    console.error(`✗ ${relative}: nu respectă schema`);
    for (const error of validate.errors ?? []) {
      console.error(`  ${error.instancePath || "/"} ${error.message}`);
    }
    failed = true;
    continue;
  }

  const sourceIds = new Set(data.sources.map((source) => source.id));
  for (const item of data.importantNews) {
    if (!sourceIds.has(item.sourceId)) {
      console.error(`✗ ${relative}: știrea ${item.id} indică sursa inexistentă ${item.sourceId}`);
      failed = true;
    }
    if (!item.isSecondary && item.sourceId !== "biziday") {
      console.error(`✗ ${relative}: ${item.id} trebuie marcată ca sursă secundară`);
      failed = true;
    }
  }

  if (path.basename(file) !== "latest.json") {
    const filenameDate = path.basename(file, ".json");
    if (filenameDate !== data.metadata.editionDate) {
      console.error(`✗ ${relative}: data din numele fișierului diferă de metadata.editionDate`);
      failed = true;
    }
    if (seenDates.has(filenameDate)) {
      console.error(`✗ ${relative}: ediție duplicată pentru ${filenameDate}`);
      failed = true;
    }
    seenDates.add(filenameDate);
  }

  if (!failed) console.log(`✓ ${relative}`);
}

const indexPath = path.join(archiveDir, "index.json");
try {
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const indexedDates = new Set(index.editions.map((entry) => entry.date));
  for (const date of seenDates) {
    if (!indexedDates.has(date)) {
      console.error(`✗ data/archive/index.json nu include ${date}`);
      failed = true;
    }
  }
  console.log("✓ data/archive/index.json");
} catch (error) {
  console.error(`✗ data/archive/index.json: ${error.message}`);
  failed = true;
}

if (failed) process.exit(1);
console.log(`Date valide: ${editionFiles.length} ediție/ediții.`);
