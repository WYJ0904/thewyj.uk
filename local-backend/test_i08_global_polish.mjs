import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "..");

test("I08 CSS layer, vector icon markup, Kill Switch warning, and SW invariants", () => {
  const spatial = fs.readFileSync(path.join(ROOT, "spatial-experience.css"), "utf8");
  const idx = spatial.indexOf("I08 Global Polish & Control Refinement Layer");
  assert.ok(idx >= 0, "Missing I08 Global Polish & Control Refinement Layer in spatial-experience.css");
  const commentEnd = spatial.indexOf("*/", idx);
  const i08Layer = spatial.slice(commentEnd >= 0 ? commentEnd + 2 : idx).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(i08Layer.includes("!important"), false, "I08 layer must have 0 !important declarations");
  assert.match(i08Layer, /html:not\(\[data-p07-ui="enabled"\]\)\s*:is\(\.v3-nav-icon/);

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.equal((html.match(/class="v3-nav-icon"/g) || []).length, 10, "All 10 sidebar nav items must have SVG .v3-nav-icon");
  assert.equal((html.match(/class="account-setting-chevron"/g) || []).length, 3, "All 3 account setting rows must have SVG chevron");
  assert.equal((html.match(/class="home-quick-arrow"/g) || []).length, 4, "All 4 quick access links must have SVG arrow");
  assert.ok(html.includes('id="featureFlagKillWarning"'), "Missing #featureFlagKillWarning");

  const appJs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.match(appJs, /function applyWorkspaceRouteScroll\(pushHistory\)/);
  assert.ok(appJs.includes('pushRoute("/admin")'), "showAdminPanel must use pushRoute('/admin')");
  assert.ok((appJs.match(/applyWorkspaceRouteScroll\(pushHistory\)/g) || []).length >= 8, "All workspace routes must apply scroll governance");

  const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const context = {
    URL,
    Response,
    AbortController,
    crypto,
    TextEncoder,
    setTimeout,
    clearTimeout,
    caches: {},
    fetch: async () => new Response(""),
    self: { location: { origin: "https://isolated.example" }, addEventListener() {} },
  };
  vm.runInNewContext(`${swSource}\n;globalThis.__I08_SHELL={core:CORE_SHELL.length,required:REQUIRED_SHELL.length,install:INSTALL_SHELL.length};`, context);
  assert.equal(context.__I08_SHELL.core, 81);
  assert.equal(context.__I08_SHELL.required, 89);
  assert.equal(context.__I08_SHELL.install, 89);
});
