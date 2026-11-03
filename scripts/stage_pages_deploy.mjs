import { copyFile, lstat, mkdir, readdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT_FILES = Object.freeze([
  "_headers",
  "app.js",
  "changelog.js",
  "design-system.css",
  "favicon.ico",
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
export const ROOT_DIRECTORIES = Object.freeze(["assets", "functions", "js", "vendor"]);
const ASSET_FILES = new Set([
  "assets/logo.png", "assets/splash-screen.png", "assets/brand/aeris-lockup.png",
  "assets/brand/aeris-maskable-512.png", "assets/brand/aeris-monogram.png",
  "assets/brand/aeris-og.png", "assets/brand/apple-touch-icon.png",
  "assets/brand/asset-manifest.json", "assets/brand/favicon-32.png",
  "assets/brand/favicon-64.png", "assets/brand/source-original.png",
]);
const VENDOR_FILES = new Set([
  "vendor/opencc-LICENSE.txt",
  "vendor/opencc-st-characters.txt",
  "vendor/opencc-ts-characters.txt",
  "vendor/qrcode.js",
]);
const PRIVATE_COMPONENTS = new Set([
  "private", "developer", "docs", "qa", "evidence", "migration-evidence",
  "credentials", "data", "payment", "local-backend", "node_modules",
  ".git", ".wrangler", ".codex", ".agents", ".tool-e2e", "__pycache__",
]);
const PRIVATE_FILE = /(?:^|[._-])(?:credentials?|secrets?|private|developer|evidence|debug)(?:[._-]|$)/i;
// This reviewed runtime module implements transaction evidence rules; it is
// application source, unlike private QA evidence and diagnostic files.
const REVIEWED_SOURCE_FILES = new Set([
  "functions/_lib/notification-cash-evidence.mjs",
  "functions/_lib/payment-currency-evidence.mjs",
  "functions/_lib/task21-provider-evidence.mjs",
]);
const CREDENTIAL_MATERIAL = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN|TUNNEL_TOKEN|CF_TUNNEL_TOKEN)\s*[:=]\s*['"]?[A-Za-z0-9._~-]{20,}/i,
];

export function isAllowedPagesFile(relativePath) {
  const parts = relativePath.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || PRIVATE_COMPONENTS.has(part.toLowerCase()))) return false;
  const name = parts.at(-1);
  if (name.startsWith(".") || (PRIVATE_FILE.test(name) && !REVIEWED_SOURCE_FILES.has(relativePath))) return false;
  if (ROOT_FILES.includes(relativePath)) return true;
  if (parts[0] === "assets") return ASSET_FILES.has(relativePath);
  if (parts[0] === "functions") return /\.(?:js|mjs)$/.test(name);
  if (parts[0] === "js") return name.endsWith(".js");
  return VENDOR_FILES.has(relativePath);
}

async function regularEntry(source, relativePath) {
  let entry;
  try {
    entry = await lstat(source);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Missing required Pages asset: ${relativePath}`);
    throw error;
  }
  if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
    throw new Error(`Unsafe Pages asset type: ${relativePath}`);
  }
  return entry;
}

async function collectDirectory(root, relativePath, files) {
  const directory = await regularEntry(path.join(root, relativePath), relativePath);
  if (!directory.isDirectory()) throw new Error(`Expected Pages asset directory: ${relativePath}`);
  for (const name of (await readdir(path.join(root, relativePath))).sort()) {
    const relative = `${relativePath}/${name}`;
    const entry = await regularEntry(path.join(root, relative), relative);
    if (name.startsWith(".") || PRIVATE_COMPONENTS.has(name.toLowerCase()) || (PRIVATE_FILE.test(name) && !(REVIEWED_SOURCE_FILES.has(relative) && entry.isFile()))) {
      throw new Error(`Unreviewed or private Pages asset: ${relative}`);
    }
    if (entry.isDirectory()) await collectDirectory(root, relative, files);
    else files.push(relative);
  }
}

async function assertSafeOutput(root) {
  const wranglerRoot = path.join(root, ".wrangler");
  const output = path.join(wranglerRoot, "pages-output");
  if (path.relative(root, output) !== path.join(".wrangler", "pages-output")) {
    throw new Error("Pages staging output must remain at .wrangler/pages-output");
  }
  // Check both ancestors before any recursive removal; junctions and symlinks
  // must never redirect deletion or copies outside this build directory.
  for (const candidate of [wranglerRoot, output]) {
    try {
      const entry = await lstat(candidate);
      if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(candidate) !== candidate) {
        throw new Error("Unsafe Pages staging output: symlink or non-directory");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return output;
}

export async function stagePages({ root = ROOT } = {}) {
  const sourceRoot = await realpath(root);
  const output = await assertSafeOutput(sourceRoot);
  const files = [...ROOT_FILES];
  for (const directory of ROOT_DIRECTORIES) await collectDirectory(sourceRoot, directory, files);
  // Validate the complete source set before changing an earlier build. A
  // recursive directory allowlist alone can silently publish nested secrets.
  for (const relative of files) {
    if (!isAllowedPagesFile(relative)) throw new Error(`Unreviewed or private Pages asset: ${relative}`);
    const entry = await regularEntry(path.join(sourceRoot, relative), relative);
    if (!entry.isFile()) throw new Error(`Expected Pages asset file: ${relative}`);
    const content = (await readFile(path.join(sourceRoot, relative))).toString("utf8");
    if (CREDENTIAL_MATERIAL.some((pattern) => pattern.test(content))) {
      throw new Error(`Credential material in Pages asset: ${relative}`);
    }
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const relative of files.sort()) {
    const target = path.join(output, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(sourceRoot, relative), target);
  }
  return { output, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("Pages staging accepts no path overrides");
  const { output } = await stagePages();
  console.log(path.relative(ROOT, output).replaceAll("\\", "/"));
}
