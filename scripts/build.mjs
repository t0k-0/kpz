import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(root, "_site");

if (dirname(output) !== root || output === root) {
  throw new Error(`Refusing to clean unsafe build path: ${output}`);
}

const entries = [
  "index.html",
  "404.html",
  ".nojekyll",
  "manifest.webmanifest",
  "robots.txt",
  "sw.js",
  "assets",
  "data",
  "worksheets",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of entries) {
  await cp(join(root, entry), join(output, entry), { recursive: true });
}

console.log(`Built ${entries.length} site entries in ${output}`);
