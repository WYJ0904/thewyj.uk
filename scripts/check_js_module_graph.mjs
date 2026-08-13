import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(process.env.WYJ_MODULE_GRAPH_ROOT || DEFAULT_ROOT);
const ENTRY_FILES = ["app.js", "tools.js"];
const MODULE_ROOT = path.join(ROOT, "js");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : entry.name.endsWith(".js") ? [fullPath] : [];
  });
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, "/");
}

function importsFor(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const specifiers = [];
  const staticImport = /(?:^|\n)\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImport = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const pattern of [staticImport, dynamicImport]) {
    let match;
    while ((match = pattern.exec(source))) specifiers.push(match[1]);
  }
  return specifiers;
}

function domainOf(filePath) {
  const name = relative(filePath);
  if (!name.startsWith("js/")) return "entry";
  return name.split("/")[1] || "unknown";
}

const files = [...ENTRY_FILES.map((name) => path.join(ROOT, name)), ...walk(MODULE_ROOT)]
  .map((filePath) => path.resolve(filePath));
const fileSet = new Set(files);
const graph = new Map(files.map((filePath) => [filePath, []]));
const errors = [];

for (const filePath of files) {
  for (const specifier of importsFor(filePath)) {
    if (!specifier.startsWith(".")) {
      errors.push(`${relative(filePath)} imports unsupported bare module ${specifier}`);
      continue;
    }
    const target = path.resolve(path.dirname(filePath), specifier.split(/[?#]/, 1)[0]);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      errors.push(`${relative(filePath)} imports missing module ${specifier}`);
      continue;
    }
    if (!fileSet.has(target)) {
      errors.push(`${relative(filePath)} imports module outside the audited frontend graph: ${relative(target)}`);
      continue;
    }
    graph.get(filePath).push(target);

    const sourceDomain = domainOf(filePath);
    const targetDomain = domainOf(target);
    if (sourceDomain === "core" && targetDomain !== "core") {
      errors.push(`core dependency points outward: ${relative(filePath)} -> ${relative(target)}`);
    }
    if (sourceDomain !== "entry" && sourceDomain !== "core" && targetDomain !== "core" && targetDomain !== sourceDomain) {
      errors.push(`cross-domain dependency is not allowed: ${relative(filePath)} -> ${relative(target)}`);
    }
  }
}

const visiting = new Set();
const visited = new Set();
const stack = [];

function visit(filePath) {
  if (visited.has(filePath)) return;
  if (visiting.has(filePath)) {
    const start = stack.indexOf(filePath);
    errors.push(`circular dependency: ${[...stack.slice(start), filePath].map(relative).join(" -> ")}`);
    return;
  }
  visiting.add(filePath);
  stack.push(filePath);
  graph.get(filePath).forEach(visit);
  stack.pop();
  visiting.delete(filePath);
  visited.add(filePath);
}

files.forEach(visit);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const edgeCount = [...graph.values()].reduce((total, dependencies) => total + dependencies.length, 0);
console.log(`ES module graph passed: ${files.length} files, ${edgeCount} imports, no cycles or reversed core dependencies.`);
