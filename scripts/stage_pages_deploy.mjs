import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER_ROOT = path.join(ROOT, ".wrangler");
const OUTPUT = path.join(WRANGLER_ROOT, "pages-output");
const ROOT_FILES = Object.freeze([
  "_headers",
  "app.js",
  "changelog.js",
  "design-system.css",
  "icon-192.png",
  "icon-512.png",
  "index.html",
  "learning-sync.js",
  "manifest.webmanifest",
  "product-ui.css",
  "public-experience.css",
  "styles.css",
  "sw.js",
  "THIRD_PARTY_NOTICES.md",
  "tools.js",
  "workspace-experience.css",
  "workflows.js",
]);
const ROOT_DIRECTORIES = Object.freeze(["assets", "functions", "js", "vendor"]);

function assertSafeOutput() {
  const relative = path.relative(WRANGLER_ROOT, OUTPUT);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Pages staging output must remain inside .wrangler");
  }
}

async function copyRequired(relativePath) {
  const source = path.join(ROOT, relativePath);
  try {
    await stat(source);
  } catch {
    throw new Error(`Missing required Pages asset: ${relativePath}`);
  }
  await cp(source, path.join(OUTPUT, relativePath), { recursive: true, force: true });
}

assertSafeOutput();
await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });
for (const relativePath of [...ROOT_FILES, ...ROOT_DIRECTORIES]) {
  await copyRequired(relativePath);
}

console.log(path.relative(ROOT, OUTPUT).replaceAll("\\", "/"));
