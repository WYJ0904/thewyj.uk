import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_ROOT_FILES = new Set([
  "_headers", "app.js", "changelog.js", "design-system.css", "favicon.ico",
  "icon-192.png", "icon-512.png", "index.html", "learning-sync.js",
  "manifest.webmanifest", "product-ui.css", "public-experience.css", "styles.css",
  "sw.js", "THIRD_PARTY_NOTICES.md", "tools.js", "workspace-experience.css", "workflows.js",
]);
const PUBLIC_DIRECTORIES = new Set(["assets", "functions", "js", "vendor"]);
const FORBIDDEN_COMPONENT = /^(?:\..*|private|developer|docs|qa|evidence|migration-evidence|credentials?|data|payment|local-backend|node_modules|__pycache__)$/i;
const FORBIDDEN_FILE = /(?:^|[._-])(?:credentials?|secrets?|private|developer|evidence|debug)(?:[._-]|$)|\.(?:sqlite3?|db3?|log|trace|jks|keystore|pem|key|p12|pfx|map)$/i;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN|TUNNEL_TOKEN|CF_TUNNEL_TOKEN)\s*[:=]\s*['"]?[A-Za-z0-9._~-]{20,}/i,
];

async function entries(directory, prefix = "") {
  const result = [];
  for (const name of (await readdir(path.join(directory, prefix))).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = await lstat(path.join(directory, relative));
    assert.ok(!stat.isSymbolicLink(), `symlink in build: ${relative}`);
    assert.ok(stat.isFile() || stat.isDirectory(), `non-regular build entry: ${relative}`);
    if (stat.isDirectory()) result.push(...await entries(directory, relative));
    else result.push(relative);
  }
  return result;
}

export async function verifyPagesBuild() {
  const root = await realpath(ROOT);
  const config = JSON.parse(await readFile(path.join(root, "wrangler.jsonc"), "utf8"));
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(config.pages_build_output_dir, ".wrangler/pages-output");
  assert.equal(pkg.scripts.build, "node scripts/stage_pages_deploy.mjs");
  assert.equal(pkg.scripts["pages:stage"], pkg.scripts.build);
  const output = path.join(root, ".wrangler", "pages-output");
  assert.equal(await realpath(output), output);
  const files = await entries(output);
  const rows = [];
  for (const relative of files) {
    const parts = relative.split("/");
    assert.ok(PUBLIC_ROOT_FILES.has(relative) || (parts.length > 1 && PUBLIC_DIRECTORIES.has(parts[0])), `unallowlisted build entry: ${relative}`);
    assert.ok(!parts.some((part) => FORBIDDEN_COMPONENT.test(part)), `private build path: ${relative}`);
    assert.ok(!FORBIDDEN_FILE.test(parts.at(-1)) || relative === "functions/_lib/notification-cash-evidence.mjs", `private build file: ${relative}`);
    const content = await readFile(path.join(output, relative));
    assert.ok(!SECRET_PATTERNS.some((pattern) => pattern.test(content.toString("utf8"))), `credential material in build: ${relative}`);
    const source = path.join(root, relative);
    assert.ok((await lstat(source)).isFile(), `missing source file: ${relative}`);
    assert.deepEqual(content, await readFile(source), `source/build byte mismatch: ${relative}`);
    rows.push({ path: relative, bytes: content.byteLength, sha256: createHash("sha256").update(content).digest("hex") });
  }
  for (const required of PUBLIC_ROOT_FILES) assert.ok(files.includes(required), `missing required build file: ${required}`);
  for (const directory of PUBLIC_DIRECTORIES) {
    for (const relative of await entries(path.join(root, directory))) {
      assert.ok(files.includes(`${directory}/${relative}`), `source not staged: ${directory}/${relative}`);
    }
  }
  assert.ok(files.length > 100, "complete Pages output must include the application module graph");
  return {
    contract: "pages-allowlist-v2", status: "PASS", output: ".wrangler/pages-output",
    file_count: rows.length, total_bytes: rows.reduce((total, row) => total + row.bytes, 0),
    tree_sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    no_workspace_upload: true, no_private_paths_or_detected_credentials: true,
    source_bytes_identical: true, files: rows,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = process.argv[2] || "artifacts/aeris-release/pages-build.json";
  assert.ok(!path.isAbsolute(report) && !report.split(/[\\/]/).includes(".."), "report must be a workspace-relative path");
  assert.notEqual(report.replaceAll("\\", "/").split("/")[0].toLowerCase(), ".wrangler", "evidence must stay outside deploy output");
  const result = await verifyPagesBuild();
  await mkdir(path.dirname(path.join(ROOT, report)), { recursive: true });
  await writeFile(path.join(ROOT, report), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Pages build PASS: ${result.file_count} audited files, ${result.tree_sha256}`);
}
