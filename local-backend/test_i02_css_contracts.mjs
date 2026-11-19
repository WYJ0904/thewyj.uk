import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const CSS_FILES = [
  "styles.css",
  "product-ui.css",
  "design-system.css",
  "public-experience.css",
  "workspace-experience.css",
  "spatial-experience.css",
];

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function readCss(name) {
  return fs.readFileSync(path.join(ROOT, name), "utf8");
}

test("all CSS custom property references resolve to a declared token", () => {
  const defined = new Set();
  const cleanByFile = new Map();
  for (const file of CSS_FILES) {
    const clean = stripComments(readCss(file));
    cleanByFile.set(file, clean);
    for (const match of clean.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) {
      defined.add(match[1]);
    }
  }
  const missingByFile = {};
  for (const [file, clean] of cleanByFile) {
    const missing = new Set();
    for (const match of clean.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      if (!defined.has(match[1])) missing.add(match[1]);
    }
    if (missing.size > 0) missingByFile[file] = [...missing].sort();
  }
  assert.deepEqual(missingByFile, {}, `Undefined CSS tokens detected: ${JSON.stringify(missingByFile)}`);
});

test("design-system.css defines V1.1 primary action, polarity, density, and switch tokens", () => {
  const ds = readCss("design-system.css");
  for (const token of [
    "--ds-action-primary: #111113;",
    "--ds-on-action-primary: #ffffff;",
    "--ds-dark-action-primary: #f8fafc;",
    "--ds-dark-on-action-primary: #111113;",
    "--ds-density-radius:",
    "--site-nav-height:",
    "--ds-overlay-top:",
    "--ds-overlay-height:",
    "--ds-menu-height:",
    "--ds-card-learning-accent:",
    "--ds-card-finance-accent:",
    "--ds-card-tools-accent:",
    "--ds-success-border:",
    "--ds-warning-border:",
    "--ds-error-border:",
    "--ds-info-border:",
  ]) {
    assert.ok(ds.includes(token), `Missing required token contract in design-system.css: ${token}`);
  }
});

test("shared component rules unify a.primary, protect checkbox/radio, and define switch skin", () => {
  const ds = readCss("design-system.css");
  const product = readCss("product-ui.css");
  assert.match(ds, /button\.primary,\s*a\.primary,\s*\.button-primary/);
  assert.match(product, /button\.primary,\s*a\.primary,\s*\.button-primary/);
  assert.match(ds, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
  assert.match(product, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
  assert.match(ds, /input\[type="checkbox"\],\s*input\[type="radio"\]\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
  assert.match(ds, /\.ds-switch,\s*\.switch\s*\{/);
  assert.match(ds, /font-variant-numeric:\s*tabular-nums;/);
  assert.match(ds, /font-family:\s*var\(--ds-font-mono\);/);
});

test("!important usage stays strictly bounded across CSS layers", () => {
  const counts = {};
  for (const file of CSS_FILES) {
    const clean = stripComments(readCss(file));
    counts[file] = (clean.match(/!important/g) || []).length;
  }
  assert.ok(counts["spatial-experience.css"] <= 30, `spatial-experience.css !important regression: ${counts["spatial-experience.css"]}`);
  assert.ok(counts["product-ui.css"] <= 2, `product-ui.css !important regression: ${counts["product-ui.css"]}`);
  assert.ok(counts["styles.css"] <= 6, `styles.css !important regression: ${counts["styles.css"]}`);
  assert.ok(counts["workspace-experience.css"] <= 5, `workspace-experience.css !important regression: ${counts["workspace-experience.css"]}`);
  assert.ok(counts["design-system.css"] <= 12, `design-system.css !important regression: ${counts["design-system.css"]}`);
});

test("achievement-tier uses semantic tokens cleanly without legacy !important overrides", () => {
  const styles = stripComments(readCss("styles.css"));
  const product = stripComments(readCss("product-ui.css"));
  assert.doesNotMatch(styles, /\.achievement-tier\s*\{[^}]*!important/s);
  assert.doesNotMatch(styles, /\.achievement-tier\s*\{[^}]*(?:#8bbdd3|#7fe8b0)/s);
  assert.doesNotMatch(product, /\.achievement-tier\s*\{[^}]*!important/s);
  assert.match(product, /\.project-app\s+\.achievement-tier\s*\{[^}]*color:\s*var\(--color-text-secondary\)/s);
  assert.match(product, /\.achievement-item\.unlocked\s+\.achievement-tier\s*\{[^}]*color:\s*var\(--color-success\)/s);
});

test("index.html loads stylesheets in deterministic layered cascade order", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const links = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="\/([^"?]+)\?release=[^"]+"\s*\/>/g)].map((m) => m[1]);
  assert.deepEqual(links, [
    "styles.css",
    "product-ui.css",
    "design-system.css",
    "public-experience.css",
    "workspace-experience.css",
    "spatial-experience.css",
  ]);
});
