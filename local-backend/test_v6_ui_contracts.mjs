import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatLocalTimeGreeting } from "../js/core/dashboard.js";
import { createAssetPrefetcher, DEFAULT_PREFETCH_ROUTES } from "../js/core/motion.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("V6 local-time greeting covers all time windows without leaking guest identity", () => {
  const mkDate = (hour, min = 0) => ({ getHours: () => hour, getMinutes: () => min });
  assert.deepEqual(formatLocalTimeGreeting(null, mkDate(9)), { greeting: "", prompt: "", isLateNight: false });
  assert.deepEqual(formatLocalTimeGreeting({ username: "" }, mkDate(9)), { greeting: "", prompt: "", isLateNight: false });

  assert.equal(formatLocalTimeGreeting({ username: "alice", display_name: "Alice" }, mkDate(5, 0)).greeting, "Alice，早上好。");
  assert.equal(formatLocalTimeGreeting({ username: "alice" }, mkDate(10, 59)).greeting, "alice，早上好。");
  assert.equal(formatLocalTimeGreeting({ username: "alice" }, mkDate(11, 0)).greeting, "alice，中午好。");
  assert.equal(formatLocalTimeGreeting({ username: "alice" }, mkDate(13, 59)).greeting, "alice，中午好。");
  assert.equal(formatLocalTimeGreeting({ username: "alice" }, mkDate(14, 0)).greeting, "alice，下午好。");
  assert.equal(formatLocalTimeGreeting({ username: "alice" }, mkDate(17, 59)).greeting, "alice，下午好。");
  assert.equal(formatLocalTimeGreeting({ username: "alice" }, mkDate(18, 0)).greeting, "alice，晚上好。");
  assert.equal(formatLocalTimeGreeting({ username: "alice" }, mkDate(23, 59)).greeting, "alice，晚上好。");

  for (const hr of [0, 2, 4]) {
    const late = formatLocalTimeGreeting({ username: "bob" }, mkDate(hr, 30));
    assert.equal(late.greeting, "这么晚不睡，bob，请多注意身体。");
    assert.equal(late.prompt, "");
    assert.equal(late.isLateNight, true);
  }
});

test("V6 global shell, command palette, privacy toggle, and zero-!important contracts hold", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(html.includes('id="v3CmdTrigger"'));
  assert.ok(html.includes('id="v3SidebarIndicator"'));
  assert.ok(html.includes('id="commandPaletteModal"'));
  assert.ok(html.includes('id="dashboardGreetingPrompt"'));
  assert.ok(html.includes('id="financePrivacyBtn"'));

  const mainEnd = html.indexOf("</main>");
  const cmdStart = html.indexOf('id="commandPaletteModal"');
  assert.ok(mainEnd > 0 && cmdStart > mainEnd, "#commandPaletteModal must live outside <main> so modal inert never blocks it");
  assert.ok(html.includes('class="tools-search-bar"'), "Tools search bar must span outside the narrow left category rail");
  assert.ok(html.includes('class="finance-register-head"'), "Finance ledger must include Actual-style column register header");
  assert.ok(html.includes('class="workflow-runner-grid"'), "Workflow runner must preserve split Input/Output inspector panes");

  const css = fs.readFileSync(path.join(root, "spatial-experience.css"), "utf8");
  const v6Idx = css.indexOf("V6.3 Phase 1B:");
  assert.ok(v6Idx > 0);
  const v6Slice = css.slice(v6Idx);
  assert.equal(v6Slice.includes("!important"), false, "V6 CSS layer must contain zero !important overrides");
});

test("V6 asset prefetcher respects saveData, 2g, offline, and deduplicates routes", () => {
  for (const [routeKey, urls] of Object.entries(DEFAULT_PREFETCH_ROUTES)) {
    for (const raw of urls) {
      const cleanRel = raw.split("?")[0].replace(/^\/+/, "");
      assert.equal(fs.existsSync(path.join(root, cleanRel)), true, `Prefetch asset for ${routeKey} missing: ${cleanRel}`);
    }
  }
  const appended = [];
  const fakeDoc = {
    head: { append(node) { appended.push(node); } },
    createElement(tag) { return { tagName: tag.toUpperCase() }; },
  };

  const prefetcherSaveData = createAssetPrefetcher({
    doc: fakeDoc,
    view: { navigator: { onLine: true, connection: { saveData: true, effectiveType: "4g" } } },
  });
  assert.equal(prefetcherSaveData.prefetchRoute("tools"), 0);

  const prefetcher2g = createAssetPrefetcher({
    doc: fakeDoc,
    view: { navigator: { onLine: true, connection: { saveData: false, effectiveType: "2g" } } },
  });
  assert.equal(prefetcher2g.prefetchRoute("finance"), 0);

  const prefetcherOffline = createAssetPrefetcher({
    doc: fakeDoc,
    view: { navigator: { onLine: false } },
  });
  assert.equal(prefetcherOffline.prefetchRoute("workflows"), 0);
  assert.equal(appended.length, 0);

  const prefetcherOnline = createAssetPrefetcher({
    doc: fakeDoc,
    view: { navigator: { onLine: true, connection: { saveData: false, effectiveType: "4g" } } },
  });
  assert.equal(prefetcherOnline.prefetchRoute("tools"), 1);
  assert.equal(prefetcherOnline.prefetchRoute("tools"), 0);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].rel, "prefetch");
});
