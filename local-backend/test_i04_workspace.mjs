import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKSPACE_SCHEMA_VERSION,
  WORKSPACE_MODULE_IDS,
  defaultWorkspaceBento,
  sanitizeWorkspaceBento,
  hasFutureWorkspaceSchema,
  mergeHomeWidgetsRecord,
  visibleWorkspaceOrder,
  moveWorkspaceVisibleModule,
  applyWorkspaceVisibleOrder,
  setWorkspaceModuleHidden,
  diffWorkspaceDraftFields,
  homeWidgetStorageKey,
} from "../js/core/home-widget-layout.js";
import { projectHomeWidgets } from "../js/core/home-widget-data.js";

test("I04 layout model sanitizes corrupt inputs, duplicates, future schemas, and missing canonical modules", () => {
  const defaults = defaultWorkspaceBento();
  assert.equal(defaults.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.deepEqual(defaults.order, [...WORKSPACE_MODULE_IDS]);
  assert.deepEqual(defaults.hidden, []);
  assert.equal(defaults.density, "comfortable");
  assert.equal(defaults.customized, false);

  assert.deepEqual(sanitizeWorkspaceBento(null), defaults);
  assert.deepEqual(sanitizeWorkspaceBento({ schemaVersion: 99, density: "compact" }), defaults);
  assert.equal(hasFutureWorkspaceSchema({ version: 99 }), true);
  assert.equal(hasFutureWorkspaceSchema({ version: 2, workspace: { schemaVersion: 9 } }), true);
  assert.equal(hasFutureWorkspaceSchema({ version: 2, workspace: { schemaVersion: 1 } }), false);

  const sanitized = sanitizeWorkspaceBento({
    workspace: {
      schemaVersion: 1,
      order: ["tools", "unknown-id", "tools", "finance"],
      hidden: ["finance", "bad-key", "finance"],
      density: "compact",
    },
  });
  assert.deepEqual(sanitized.order, ["tools", "finance", "learning", "transfer", "activity", "account"]);
  assert.deepEqual(sanitized.hidden, ["finance"]);
  assert.equal(sanitized.density, "compact");
  assert.equal(sanitized.customized, true);

  const merged = mergeHomeWidgetsRecord(
    {
      version: 2,
      learning: { contentMode: "streak", layouts: { desktop: { size: "large", rotation: -4, x: 0.4, y: 0.6 }, mobile: { size: "small", rotation: 0, x: 0.2, y: 0.2 } } },
    },
    sanitized,
  );
  assert.equal(merged.version, 2);
  assert.equal(merged.learning.contentMode, "streak");
  assert.equal(merged.learning.layouts.desktop.size, "large");
  assert.deepEqual(merged.workspace, sanitized);
});

test("I04 layout reducers move across hidden slots, preserve relative order on reorder, and compute dirty diffs", () => {
  let state = defaultWorkspaceBento();
  // Hide finance so visible order skips index 1.
  state = setWorkspaceModuleHidden(state, "finance", true);
  assert.deepEqual(visibleWorkspaceOrder(state), ["learning", "tools", "transfer", "activity", "account"]);

  // Move 'tools' UP by 1 visible step -> swaps cleanly with 'learning' over hidden 'finance'.
  state = moveWorkspaceVisibleModule(state, "tools", -1);
  assert.deepEqual(visibleWorkspaceOrder(state), ["tools", "learning", "transfer", "activity", "account"]);

  // Move 'learning' DOWN by 1 visible step -> skips forward accurately.
  state = moveWorkspaceVisibleModule(state, "learning", 1);
  assert.deepEqual(visibleWorkspaceOrder(state), ["tools", "transfer", "learning", "activity", "account"]);

  // Apply arbitrary pointer/keyboard visible reorder while keeping hidden slot anchored safely.
  state = applyWorkspaceVisibleOrder(state, ["account", "tools", "learning", "transfer", "activity"]);
  assert.deepEqual(visibleWorkspaceOrder(state), ["account", "tools", "learning", "transfer", "activity"]);
  assert.ok(state.order.includes("finance"));

  const diff = diffWorkspaceDraftFields(defaultWorkspaceBento(), { ...state, density: "compact" });
  assert.deepEqual(diff, ["模块顺序", "隐藏/显示模块", "布局密度"]);
});

test("I04 storage keys isolate per account and projectHomeWidgets reports honest states", () => {
  assert.notEqual(homeWidgetStorageKey("user-alpha"), homeWidgetStorageKey("user-beta"));
  assert.notEqual(homeWidgetStorageKey(""), homeWidgetStorageKey("user-alpha"));

  const offlineProj = projectHomeWidgets({
    online: false,
    financeKnown: false,
    transfer: { count: 0, known: false, allowed: false },
    membership: { name: "基础用户" },
    account: { username: "synthA" },
  });
  assert.equal(offlineProj.finance.modes.balance.state, "error");
  assert.equal(offlineProj.transfer.state, "restricted");
  assert.equal(offlineProj.account.state, "error");

  const readyProj = projectHomeWidgets({
    online: true,
    finance: { balance_minor: 12345, income_minor: 20000, expense_minor: 7655, count: 4, last_sync_at: "2026-11-20T04:00:00Z" },
    financeKnown: true,
    transfer: { count: 3, known: true, allowed: true },
    membership: { name: "全功能月度", expiry: "永久有效", entitlements: "全部工具" },
    account: { username: "synthA" },
    notifications: { pendingCount: 2 },
    money: (v) => `¥ ${(v / 100).toFixed(2)}`,
  });
  assert.equal(readyProj.finance.modes.balance.value, "¥ 123.45");
  assert.equal(readyProj.transfer.value, "3 个文件");
  assert.equal(readyProj.account.pendingNotifications, 2);
});
