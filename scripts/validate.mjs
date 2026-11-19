import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const required = [
  "index.html",
  "404.html",
  "assets/app.js",
  "assets/styles.css",
  "data/config.json",
  "data/sets/index.json",
  "worksheets/index.json",
  "manifest.webmanifest",
  "robots.txt",
  "sw.js",
];

for (const file of required) await access(join(root, file));

const readJson = async (file) => JSON.parse(await readFile(join(root, file), "utf8"));
const config = await readJson("data/config.json");
const setIndex = await readJson("data/sets/index.json");
const worksheetIndex = await readJson("worksheets/index.json");
await readJson("manifest.webmanifest");

if (!/^[a-f0-9]{64}$/.test(config.access?.studentHash || "") || !/^[a-f0-9]{64}$/.test(config.access?.adminHash || "")) {
  throw new Error("Access-code hashes must be 64-character SHA-256 values.");
}
if (!Array.isArray(setIndex.sets) || setIndex.sets.length === 0) throw new Error("At least one study set is required.");
if (!Array.isArray(worksheetIndex.worksheets)) throw new Error("worksheets/index.json must contain a worksheets array.");

const ids = new Set();
for (const entry of setIndex.sets) {
  if (!entry.id || !entry.file || ids.has(entry.id)) throw new Error(`Invalid or duplicate study-set entry: ${JSON.stringify(entry)}`);
  ids.add(entry.id);
  const sql = await readFile(join(root, "data", "sets", entry.file), "utf8");
  if (!sql.includes(`-- id: ${entry.id}`)) throw new Error(`${entry.file} must declare matching metadata: -- id: ${entry.id}`);
  if (!/INSERT\s+INTO\s+cards\s*\([^)]+\)\s*VALUES/i.test(sql)) throw new Error(`${entry.file} has no cards INSERT statement.`);
  const tupleCount = (sql.match(/^\s*\('/gm) || []).length;
  if (tupleCount < 2) throw new Error(`${entry.file} must contain at least two complete cards.`);
}

for (const worksheet of worksheetIndex.worksheets) {
  if (!worksheet.title || !worksheet.category || !worksheet.file) throw new Error(`Invalid worksheet entry: ${JSON.stringify(worksheet)}`);
  await access(join(root, "worksheets", worksheet.file));
  if (worksheet.thumbnail) await access(join(root, "worksheets", worksheet.thumbnail));
}

console.log(`Validated ${setIndex.sets.length} study sets and ${worksheetIndex.worksheets.length} worksheets.`);
