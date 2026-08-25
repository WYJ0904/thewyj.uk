import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(process.env.WYJ_TASK15_AUDIT_ROOT || DEFAULT_ROOT);
const API_ENTRIES = [
  path.join(ROOT, "functions", "api", "[[path]].js"),
  path.join(ROOT, "functions", "api", "status.js"),
  path.join(ROOT, "functions", "_middleware.js"),
];
const FRONTEND_ENTRIES = ["app.js", "tools.js", "workflows.js", "learning-sync.js"];
const errors = [];

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, "/");
}

function source(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function importsFor(filePath) {
  const text = source(filePath);
  const values = [];
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/gu,
    /\bimport\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) values.push(match[1]);
  }
  return values;
}

function productionGraph(entry) {
  const visited = new Set();
  function visit(filePath) {
    const resolved = path.resolve(filePath);
    if (visited.has(resolved)) return;
    if (!fs.existsSync(resolved)) {
      errors.push(`production entry imports missing file: ${relative(resolved)}`);
      return;
    }
    visited.add(resolved);
    for (const specifier of importsFor(resolved)) {
      if (!specifier.startsWith(".")) {
        errors.push(`${relative(resolved)} imports unsupported runtime package ${specifier}`);
        continue;
      }
      visit(path.resolve(path.dirname(resolved), specifier.split(/[?#]/u, 1)[0]));
    }
  }
  visit(entry);
  return visited;
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function normalizedApiPath(value) {
  return String(value || "").split(/[?#]/u, 1)[0];
}

const graph = new Set();
for (const entry of API_ENTRIES.filter(fs.existsSync)) {
  for (const filePath of productionGraph(entry)) graph.add(filePath);
}
const forbiddenRuntime = [
  ["LOCAL_API_BASE", /\b(?:VOCAB_)?LOCAL_API_BASE\b/u],
  ["legacy Pages proxy", /\bproxyToLegacy\b|legacy-api\.mjs/u],
  ["legacy identity bridge", /task12-bridge\.mjs|\bbridgeConfigured\b/u],
  ["Tunnel hostname", /api\.thewyj\.uk/iu],
  ["local Python endpoint", /(?:127\.0\.0\.1|localhost):8765/iu],
  ["Ollama endpoint", /(?:127\.0\.0\.1|localhost):11434|\bOllama\b/iu],
];
for (const filePath of graph) {
  const text = source(filePath);
  for (const [label, pattern] of forbiddenRuntime) {
    if (pattern.test(text)) errors.push(`${relative(filePath)} contains forbidden Production dependency: ${label}`);
  }
}

const serverRoutes = new Set(["/api/status"]);
for (const filePath of graph) {
  const text = source(filePath);
  const pattern = /["'](?:GET|POST|PUT|DELETE|PATCH|HEAD)\s+(\/api\/[^"']+)["']/gu;
  let match;
  while ((match = pattern.exec(text))) serverRoutes.add(normalizedApiPath(match[1]));
}

const frontendFiles = [
  ...FRONTEND_ENTRIES.map((name) => path.join(ROOT, name)).filter(fs.existsSync),
  ...walk(path.join(ROOT, "js")).filter((name) => name.endsWith(".js")),
];
const frontendRoutes = new Set();
const forbiddenFrontend = [
  ["legacy Base64 temporary upload", /["']\/api\/temporary\/file["']/u],
  ["legacy Base64 temporary download", /["']\/api\/share\/file\/read["']/u],
  ["legacy PDF API", /["']\/api\/export-pdf["']/u],
  ["local/Tunnel endpoint", /\bLOCAL_API_BASE\b|api\.thewyj\.uk|(?:127\.0\.0\.1|localhost):(?:8765|11434)/iu],
];
for (const filePath of frontendFiles) {
  const text = source(filePath);
  const routePattern = /["'](\/api\/[A-Za-z0-9_?=&./:-]+)["']/gu;
  let match;
  while ((match = routePattern.exec(text))) frontendRoutes.add(normalizedApiPath(match[1]));
  for (const [label, pattern] of forbiddenFrontend) {
    if (pattern.test(text)) errors.push(`${relative(filePath)} contains forbidden frontend path: ${label}`);
  }
  if (/status\s*===\s*401[\s\S]{0,240}(?:clearSession|handleSessionExpired)/u.test(text)) {
    errors.push(`${relative(filePath)} clears canonical Session from a generic HTTP 401`);
  }
}

for (const route of frontendRoutes) {
  if (!serverRoutes.has(route)) errors.push(`frontend API route has no Cloudflare handler: ${route}`);
}

const wranglerPath = path.join(ROOT, "wrangler.jsonc");
if (fs.existsSync(wranglerPath)) {
  const text = source(wranglerPath);
  if (/LOCAL_API_BASE|api\.thewyj\.uk|LEGACY_API_FALLBACK_ENABLED"\s*:\s*"true"/iu.test(text)) {
    errors.push("wrangler.jsonc enables or configures a legacy Production dependency");
  }
  let config = null;
  try { config = JSON.parse(text); }
  catch (error) { errors.push(`wrangler.jsonc is not valid JSON: ${error.message}`); }
  const requiredTrue = [
    "CLOUD_READS_ENABLED",
    "CLOUD_WRITES_ENABLED",
    "TASK11_CLOUD_READS_ENABLED",
    "TASK11_CLOUD_WRITES_ENABLED",
    "TASK12_CLOUD_ACCOUNTS_ENABLED",
    "TASK13_CLOUD_READS_ENABLED",
    "TASK13_CLOUD_WRITES_ENABLED",
    "TASK13_PAYMENT_PRIMARY_ENABLED",
    "TASK14_CLOUD_READS_ENABLED",
    "TASK14_CLOUD_WRITES_ENABLED",
    "TASK14_TEMPORARY_PRIMARY_ENABLED",
    "TASK14_LEGACY_WRITES_FROZEN",
    "TASK15_CLOUD_ONLY_ENABLED",
    "WORKERS_AI_ENABLED",
  ];
  for (const environment of ["preview", "production"]) {
    const vars = config?.env?.[environment]?.vars || {};
    for (const key of requiredTrue) {
      if (vars[key] !== "true") errors.push(`wrangler.jsonc ${environment}.${key} must be true`);
    }
    if (vars.LEGACY_API_FALLBACK_ENABLED !== "false") {
      errors.push(`wrangler.jsonc ${environment}.LEGACY_API_FALLBACK_ENABLED must be false`);
    }
    if (environment === "production") {
      for (const key of [
        "TASK11_IMPORT_ENABLED", "TASK11_PRODUCTION_IMPORT_ENABLED",
        "TASK12_IMPORT_ENABLED", "TASK12_PRODUCTION_IMPORT_ENABLED",
        "TASK13_IMPORT_ENABLED", "TASK13_PRODUCTION_IMPORT_ENABLED",
        "TASK14_IMPORT_ENABLED", "TASK14_PRODUCTION_IMPORT_ENABLED",
        "TASK15_IMPORT_ENABLED", "TASK15_PRODUCTION_IMPORT_ENABLED",
      ]) {
        if (vars[key] !== "false") errors.push(`wrangler.jsonc production.${key} must be false`);
      }
    }
  }
}

if (errors.length) {
  console.error([...new Set(errors)].join("\n"));
  process.exit(1);
}

console.log(
  `Task 15 cloud-only gate passed: ${graph.size} Production modules, ${serverRoutes.size} Cloudflare routes, ${frontendRoutes.size} frontend routes.`,
);
