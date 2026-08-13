import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contractPath = path.join(ROOT, "qa", "frontend-storage-contract.json");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const errors = [];
const families = new Set();

if (contract.schema_version !== 1 || !Array.isArray(contract.keys)) {
  errors.push("frontend storage contract must use schema_version 1 and a keys array");
} else {
  for (const item of contract.keys) {
    if (!item || typeof item !== "object" || !item.family || !item.source || !item.fragment || !item.storage) {
      errors.push(`invalid storage contract entry: ${JSON.stringify(item)}`);
      continue;
    }
    if (families.has(item.family)) errors.push(`duplicate storage family: ${item.family}`);
    families.add(item.family);
    const sourcePath = path.join(ROOT, item.source);
    if (!fs.existsSync(sourcePath)) {
      errors.push(`${item.family}: missing source file ${item.source}`);
      continue;
    }
    if (!fs.readFileSync(sourcePath, "utf8").includes(item.fragment)) {
      errors.push(`${item.family}: key fragment changed or missing in ${item.source}: ${item.fragment}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Frontend storage contract passed: ${contract.keys.length} stable key families audited.`);
