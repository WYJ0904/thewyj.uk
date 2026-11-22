# I04 Widget Layout Model & Account-Isolated Storage

## 1. Backward-Compatible Schema Upgrade (`js/core/home-widget-layout.js`)
- Canonical storage key preserved and registered in `qa/frontend-storage-contract.json`:
  - `homeWidgetStorageKey(id)` -> `'aerisHomeWidgets:v2:' + encodeURIComponent(String(id || 'guest'))`
  - Reads fallback `legacyHomeWidgetStorageKey(id)` (`aerisHomeWidgets:v1:<id>`) read-only when `v2` is absent, never clearing prior preferences.
- `defaultHomeWidgets()` and `sanitizeHomeWidgets()` retain exact `version: 2` shape (`learning`, `finance`, `tools`) so all existing P07/I03/Aeris contracts continue passing without breaking existing preferences.
- New Bento Workspace configuration lives inside the `workspace` sub-object merged cleanly via `mergeHomeWidgetsRecord(existingRaw, workspaceConfig)`:
  ```json
  {
    "version": 2,
    "learning": { "...": "preserved" },
    "finance": { "...": "preserved" },
    "tools": { "...": "preserved" },
    "workspace": {
      "schemaVersion": 1,
      "order": ["learning", "finance", "tools", "transfer", "activity", "account"],
      "hidden": [],
      "density": "comfortable",
      "customized": false
    }
  }
  ```
- Future schema guard (`hasFutureWorkspaceSchema(raw)`): refuses to overwrite records where `raw.version > 2` or `raw.workspace.schemaVersion > 1`, preventing silent data loss on rollback/upgrade.

## 2. Persistence State Machine & Failure Handling (`js/core/home-widgets.js`)
The workspace controller separates all 6 required states explicitly via `#workspaceSaveStatus` (`data-save-state`, `data-tone`) and toolbar controls:
- **`saved` (existing saved / default)**: `"默认布局（本地按账户隔离）"` or `"已保存 · 仅当前账户本地生效"` (honestly states local per-account storage; never claims cross-device cloud sync when no server layout sync API exists).
- **`dirty` (draft during Edit Mode)**: Lists exact modified fields (`diffWorkspaceDraftFields`: `模块顺序`, `隐藏/显示模块`, `布局密度`); enables `#workspaceSaveBtn` (`保存布局`) and `#workspaceDiscardBtn` (`放弃草稿`).
- **`reset` + Undo**: `#workspaceResetBtn` restores `defaultWorkspaceBento()` and retains `undoResetSnapshot` so `#workspaceResetUndoBar` (`#workspaceUndoResetBtn` `"撤销重置"`) can restore custom layouts cleanly in 1 click without touching learning/finance/file data.
- **`failed` (save error / quota / offline storage failure)**: When `safeStorageSet()` throws or returns `false`, `savedConfig` is **NOT cleared or overwritten**, `persistState` transitions to `'failed'` (`error` red tone: `"保存失败：浏览器存储受限，已保留上次已保存布局"`), Edit Mode remains open with `重试保存` / `放弃草稿` available, and reloading cleanly recovers the last valid persisted layout.

## 3. Account Switch & Guest Isolation
- When `accountId()` changes (`setAccount()`), `createHomeWidgets()` immediately cancels active drags/FLIP animations, resets `draftConfig` and `undoResetSnapshot`, clears UI state, and loads `homeWidgetStorageKey(newOwner)`.
- Signing out (`owner === ""`) hides `[data-home-personal]` and refuses to persist workspace mutations under guest keys.
