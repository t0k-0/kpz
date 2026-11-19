import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const required = [
  "index.html",
  "404.html",
  "assets/app.js",
  "assets/styles.css",
  "assets/map-trainer.js",
  "assets/map-trainer.css",
  "data/config.json",
  "data/sets/index.json",
  "data/maps/world-assignment.json",
  "data/maps/ne_110m_land.geojson",
  "worksheets/index.json",
  "manifest.webmanifest",
  "robots.txt",
  "sw.js",
];

for (const file of required) await access(join(root, file));

const readJson = async (file) => JSON.parse(await readFile(join(root, file), "utf8"));
const config = await readJson("data/config.json");
const setIndex = await readJson("data/sets/index.json");
const mapAssignment = await readJson("data/maps/world-assignment.json");
const mapLand = await readJson("data/maps/ne_110m_land.geojson");
const worksheetIndex = await readJson("worksheets/index.json");
await readJson("manifest.webmanifest");

const studentHashes = config.access?.studentHashes || [config.access?.studentHash].filter(Boolean);
if (!studentHashes.length || studentHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash)) || !/^[a-f0-9]{64}$/.test(config.access?.adminHash || "")) {
  throw new Error("Access-code hashes must be 64-character SHA-256 values.");
}
if (!Array.isArray(setIndex.sets) || setIndex.sets.length === 0) throw new Error("At least one study set is required.");
if (!Array.isArray(worksheetIndex.worksheets)) throw new Error("worksheets/index.json must contain a worksheets array.");
if (!Array.isArray(mapLand.features) || mapLand.features.length === 0) throw new Error("Natural Earth land data is empty.");

const mapCategories = new Set((mapAssignment.categories || []).map((category) => category.id));
const mapIds = new Set();
if (!Array.isArray(mapAssignment.items) || mapAssignment.items.length < 180) throw new Error("Blind-map assignment must contain all assignment terms.");
for (const item of mapAssignment.items) {
  if (!item.id || !item.title || !mapCategories.has(item.category) || mapIds.has(item.id)) throw new Error(`Invalid or duplicate map item: ${JSON.stringify(item)}`);
  mapIds.add(item.id);
  const target = item.target;
  if (!target || !["point", "line", "polygon"].includes(target.type)) throw new Error(`Map item ${item.id} has no valid target.`);
  const coordinates = target.type === "point" ? [target.coordinates] : target.coordinates;
  const minimum = target.type === "point" ? 1 : target.type === "line" ? 2 : 3;
  if (!Array.isArray(coordinates) || coordinates.length < minimum || coordinates.some((coordinate) => !Array.isArray(coordinate) || coordinate.length !== 2 || !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1]) || Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > 90)) {
    throw new Error(`Map item ${item.id} has invalid coordinates.`);
  }
  if (!Number.isFinite(target.radiusKm) || target.radiusKm < 0) throw new Error(`Map item ${item.id} has invalid tolerance.`);
}

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

console.log(`Validated ${setIndex.sets.length} study sets, ${worksheetIndex.worksheets.length} worksheets and ${mapAssignment.items.length} map targets.`);
