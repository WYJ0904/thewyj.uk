import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { workspaceRouteMeta } from "../js/core/design-system.js";

const ROOT = path.resolve(import.meta.dirname, "..");

test("I06 workspaceRouteMeta supports optional languageSection without breaking I05 defaults", () => {
  assert.deepEqual(workspaceRouteMeta("/language", { authenticated: true }), { id: "language", trail: ["语言学习"] });
  assert.deepEqual(workspaceRouteMeta("/language/english", { authenticated: true }), { id: "language", trail: ["语言学习", "英语"] });
  assert.deepEqual(workspaceRouteMeta("/language/english", { authenticated: true, languageSection: "答题" }), {
    id: "language",
    trail: ["语言学习", "英语", "答题"],
  });
  assert.deepEqual(workspaceRouteMeta("/language/japanese", { authenticated: true, languageSection: "错题" }), {
    id: "language",
    trail: ["语言学习", "日语", "错题"],
  });
});

test("I06 CSS layer, HTML markers, zero !important, and PWA shell invariants are preserved", () => {
  const spatial = fs.readFileSync(path.join(ROOT, "spatial-experience.css"), "utf8");
  const idx = spatial.indexOf("I06 Module Experience Layer");
  assert.ok(idx >= 0, "Missing I06 Module Experience Layer section in spatial-experience.css");
  const commentEnd = spatial.indexOf("*/", idx);
  const i06Layer = spatial.slice(commentEnd >= 0 ? commentEnd + 2 : idx).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(i06Layer.includes("!important"), false, "I06 Module Experience Layer must have 0 !important declarations");
  assert.match(i06Layer, /html:not\(\[data-p07-ui="enabled"\]\)\s*:is\(\.quiz-progress-track/);
  assert.match(i06Layer, /#quizView\s+#submitBtn[\s\S]*?flex-basis:\s*auto/);
  assert.match(i06Layer, /#adminFeatureFlagsView\s+\.feature-directory-list\s+\.feature-directory-item[\s\S]*?grid-template-columns:/);

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const marker of [
    'id="quizProgressFill"',
    'id="quizReviewContext"',
    'id="financeTransactionDrawerMeta"',
    'id="financeTransactionDrawerDeleteBtn"',
    'class="tools-two-pane"',
    'class="tools-index-rail"',
    'id="transferConfigDisclosure"',
    'id="transferConfigSummary"',
    'id="featureFlagCapsuleStrip"',
    'id="featureFlagStateCapsule"',
    'id="featureFlagSummaryList"',
    'id="featureFlagAuditTimeline"',
  ]) {
    assert.ok(html.includes(marker), `Missing I06 HTML marker: ${marker}`);
  }

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
  vm.runInNewContext(`${swSource}\n;globalThis.__I06_SHELL={core:CORE_SHELL.length,required:REQUIRED_SHELL.length,install:INSTALL_SHELL.length};`, context);
  assert.equal(context.__I06_SHELL.core, 81);
  assert.equal(context.__I06_SHELL.required, 89);
  assert.equal(context.__I06_SHELL.install, 89);
});
