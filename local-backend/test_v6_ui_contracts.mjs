import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatLocalTimeGreeting } from "../js/core/dashboard.js";

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

  const css = fs.readFileSync(path.join(root, "spatial-experience.css"), "utf8");
  const v6Idx = css.indexOf("V6.3 Phase 1B:");
  assert.ok(v6Idx > 0);
  const v6Slice = css.slice(v6Idx);
  assert.equal(v6Slice.includes("!important"), false, "V6 CSS layer must contain zero !important overrides");
});
