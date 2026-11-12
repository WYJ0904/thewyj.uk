import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { isAllowedPagesFile } from "./stage_pages_deploy.mjs";

// Rebind the existing #146 atomic publication after a reviewed asset change.
// Never replace its 81-resource RC5 contract or Task26 required layer.
const root = path.resolve(import.meta.dirname, "..");
const workerPath = path.join(root, "sw.js");
const source = await readFile(workerPath, "utf8");
const context = { self: { addEventListener() {} } };
vm.runInNewContext(source + ";globalThis.meta={core:CORE_SHELL,required:REQUIRED_SHELL,layer:TASK26_SHELL};", context);
const meta = JSON.parse(JSON.stringify(context.meta));
const hash = (value) => createHash("sha256").update(value).digest("hex");
assert.equal(meta.core.length, 81);
assert.equal(hash(JSON.stringify(meta.core.map((asset) => asset.replace(/\d{8}-aeris-[a-z0-9-]+/g, "RELEASE")))),
  "a33d01c43f6f20a6963ab1384fb2305ee3b2447e0e68dc8c1f3015f1a2a6deae");
assert.equal(meta.layer.length, 2);
assert.equal(meta.required.length, 83);
const match = /const TASK26_INTEGRITY = Object.freeze\((\{[\s\S]*?\})\);/.exec(source);
assert.ok(match, "existing atomic publication is required");
const entries = JSON.parse(match[1]);
const include = process.argv.indexOf("--include");
if (include >= 0) {
  const asset = meta.required.find((url) => new URL(url, "https://fixture.invalid").pathname === process.argv[include + 1]);
  assert.ok(asset, "additional integrity entry must already be a required resource");
  entries[asset] = "";
}
for (const url of Object.keys(entries)) {
  const pathname = new URL(url, "https://fixture.invalid").pathname;
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  assert.ok(isAllowedPagesFile(file) && !file.startsWith("functions/"));
  entries[url] = hash((await readFile(path.join(root, file), "utf8")).replace(/\r\n?/g, "\n"));
}
const fingerprint = hash(JSON.stringify(Object.entries(entries)));
const updated = source.replace(match[0], "const TASK26_INTEGRITY = Object.freeze(" + JSON.stringify(entries, null, 2) + ");")
  .replace(/const PUBLICATION_HASH = "[a-f0-9]{64}";/, `const PUBLICATION_HASH = "${fingerprint}";`);
if (process.argv.includes("--check")) assert.equal(updated.replace(/\r\n/g, "\n"), source.replace(/\r\n/g, "\n"), "publication integrity is stale");
else await writeFile(workerPath, updated);
console.log(JSON.stringify({ core: meta.core.length, required: meta.required.length, integrity_entries: Object.keys(entries).length, publication_hash: fingerprint }));
