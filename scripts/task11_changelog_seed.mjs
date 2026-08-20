import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateEntry(entry, index) {
  if (!entry || typeof entry !== "object") throw new Error(`Changelog entry ${index} is invalid.`);
  const output = {
    version: String(entry.version || "").trim(),
    build: String(entry.build || "").trim(),
    date: String(entry.date || "").trim(),
    title: String(entry.title || "").trim(),
    features: Array.isArray(entry.features) ? entry.features.map(String) : [],
    improvements: Array.isArray(entry.improvements) ? entry.improvements.map(String) : [],
    fixes: Array.isArray(entry.fixes) ? entry.fixes.map(String) : [],
    security: Array.isArray(entry.security) ? entry.security.map(String) : [],
    sort_order: index,
  };
  if (!output.version || !output.build || !/^\d{4}-\d{2}-\d{2}$/.test(output.date) || !output.title) {
    throw new Error(`Changelog entry ${index} is missing required fields.`);
  }
  output.source_hash = crypto.createHash("sha256").update(stableStringify(output)).digest("hex");
  return output;
}

export async function changelogSeed() {
  delete globalThis.WYJ_CHANGELOG;
  const sourceUrl = pathToFileURL(path.join(ROOT, "changelog.js"));
  sourceUrl.searchParams.set("seed", String(Date.now()));
  await import(sourceUrl.href);
  const entries = Array.isArray(globalThis.WYJ_CHANGELOG) ? globalThis.WYJ_CHANGELOG : [];
  if (!entries.length) throw new Error("changelog.js did not expose WYJ_CHANGELOG.");
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    records: entries.map(validateEntry),
  };
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";
  const payload = `${JSON.stringify(await changelogSeed(), null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(outputPath, payload, "utf8");
  } else {
    process.stdout.write(payload);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
