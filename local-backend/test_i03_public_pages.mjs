import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRouter, nativeAppRoute } from "../js/core/router.js";
import { createHomeWidgets } from "../js/core/home-widgets.js";
import { createAndroidDownloadController } from "../js/core/download.js";
import {
  publicTextMetrics,
  publicBudgetBalance,
  publicLearningResult,
  publicPlanCatalog,
} from "../js/core/public-experience.js";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("I03/V6.3 index.html removes legacy tilted cards & bento wall while shipping clean guest/auth home and public surfaces", () => {
  assert.equal((html.match(/class="hero-scene-card/g) || []).length, 0);
  assert.equal(html.includes('id="homeWidgetEditor"'), false);
  assert.equal(html.includes('id="publicBentoWall"'), false);
  assert.equal((html.match(/class="bento-tile/g) || []).length, 0);
  assert.ok(html.includes('id="authHomeLauncher"'));
  assert.ok(html.includes('id="guestHomeLauncher"'));
  assert.ok(html.includes('id="publicCapabilityGallery"'));
  assert.ok(html.includes('id="publicPlansSection"'));
  assert.ok(html.includes('id="downloadStatusBadge"'));
  assert.ok(html.includes('class="trial-tool-tabs ds-segmented"'));
  for (const id of [
    "publicHome",
    "trialPage",
    "downloadPage",
    "changelogPage",
    "loginForm",
    "registerForm",
    "usernameInput",
    "secretInput",
    "registerUsernameInput",
    "registerSecretInput",
    "registerConfirmInput",
    "registerTermsConsent",
  ]) {
    assert.ok(html.includes(`id="${id}"`), `Missing preserved DOM id #${id}`);
  }
});

test("createHomeWidgets guards missing legacy 3-card hero DOM cleanly for I03 while preserving snapshot", () => {
  const fakeRoot = { querySelector: () => null };
  const ctrl = createHomeWidgets({ root: fakeRoot, accountId: () => "u1", navigate: () => {} });
  ctrl.render({});
  ctrl.setAccount();
  assert.equal(ctrl.snapshot().version, 2);
  ctrl.hide();
  ctrl.dispose();
});

test("createRouter nativeAppRoute validates all 6 public routes and saves scroll state on pushRoute", () => {
  const origin = "https://thewyj.uk";
  for (const route of ["/", "/trial", "/download", "/changelog", "/login", "/register"]) {
    assert.equal(nativeAppRoute(route, origin), route);
  }
  assert.equal(nativeAppRoute("//evil.example", origin), null);

  const states = [];
  globalThis.location = { pathname: "/", href: "https://thewyj.uk/" };
  globalThis.window = { scrollX: 12, scrollY: 640 };
  globalThis.history = {
    state: { marker: "prev" },
    replaceState(s) { states.push({ kind: "replace", s }); },
    pushState(s, _t, url) { states.push({ kind: "push", s, url }); globalThis.location.pathname = url; },
  };
  let changedTo = "";
  const router = createRouter({ onRouteChange: (to) => { changedTo = to; } });
  router.pushRoute("/trial");
  assert.equal(changedTo, "/trial");
  assert.equal(states[0].kind, "replace");
  assert.equal(states[0].s.scrollY, 640);
  assert.equal(states[1].kind, "push");
  assert.equal(states[1].url, "/trial");
});

test("createAndroidDownloadController reports honest available/pending/error states and disables copy without SHA-256", async () => {
  const els = new Map([
    ["downloadVersion", { textContent: "" }],
    ["downloadReleaseDate", { textContent: "" }],
    ["downloadApkSize", { textContent: "" }],
    ["downloadApkName", { textContent: "" }],
    ["downloadSha", { textContent: "" }],
    ["downloadMainBtn", { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }],
    ["downloadSecondaryBtn", { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }],
    ["downloadStatusBadge", { dataset: {}, textContent: "" }],
    ["downloadCopyShaBtn", { disabled: false }],
    ["downloadNotice", { textContent: "" }],
  ]);
  const doc = { getElementById: (id) => els.get(id) || null };
  const ctrl = createAndroidDownloadController({
    document: doc,
    apiGet: async () => ({
      app: {
        latest_version_name: "6.3.1",
        latest_version_code: 631,
        apk_size_bytes: 18 * 1024 * 1024,
        apk_file_name: "aeris-6.3.1.apk",
        release_date: "2026-11-18",
        apk_sha256: "a".repeat(64),
      },
    }),
  });
  await ctrl.reload();
  assert.equal(els.get("downloadStatusBadge").dataset.tone, "success");
  assert.equal(els.get("downloadCopyShaBtn").disabled, false);

  ctrl.render({ latest_version_name: "1.0.0" });
  assert.equal(els.get("downloadStatusBadge").dataset.tone, "warning");
  assert.equal(els.get("downloadCopyShaBtn").disabled, true);

  const errCtrl = createAndroidDownloadController({
    document: doc,
    apiGet: async () => { throw new Error("network down"); },
  });
  await errCtrl.reload();
  assert.equal(els.get("downloadStatusBadge").dataset.tone, "error");
});

test("public experience local helpers compute exact metrics without network writes", () => {
  assert.deepEqual(publicTextMetrics("你好\nAeris"), { characters: 8, lines: 2 });
  assert.equal(publicBudgetBalance("100.10", "40.05"), 60.05);
  assert.match(publicLearningResult("phone"), /^正确/);
  const catalog = publicPlanCatalog([
    { code: "p1", name: "月卡", purchasable: true, price_cents: 1200, currency: "CNY", duration_months: 1 },
    { code: "p2", name: "非卖品", purchasable: false, price_cents: 999, currency: "CNY", lifetime: true },
  ]);
  assert.equal(catalog.modules.length, 1);
  assert.equal(catalog.permanent.length, 0);
});
