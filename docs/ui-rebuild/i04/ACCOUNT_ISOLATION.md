# I04 Cross-Account Isolation & Persistence Verification

## 1. Per-Account Namespace Guarantee
- Layout storage key (`js/core/home-widget-layout.js`):
  `aerisHomeWidgets:v2:<encodeURIComponent(account.id)>`
- Guest state (`accountId === ""`) never persists workspace customization and `[data-home-personal]` (`#authWorkspaceSection`) stays `hidden` on `/`.
- Signing in / switching / logging out triggers `createHomeWidgets.setAccount()`, canceling active drags/FLIPs, resetting unsaved drafts/undo buffers, and hydrating strictly from the active account's key.

## 2. Verified Account Matrix
1. **Local Synthetic Fixture (`qa/i04/browser-acceptance.mjs`)**:
   - **Account A (`i04userA`, entitled)**: Customized card order, toggled `compact` density, saved (`saveState: "saved"`), reloaded page -> exact custom order & `compact` density restored; later simulated `QuotaExceededError` -> `#workspaceSaveStatus` displayed `data-save-state="failed"` (`"保存失败：浏览器存储受限，已保留上次已保存布局"`), reloading retained prior valid saved layout without corruption.
   - **Account B (`i04userB`, unentitled empty user)**: Signed out A -> signed in B -> B saw clean default order `["learning","finance","tools","transfer","activity","account"]`, `density: "comfortable"`, and honest `"会员权限受限"` on `transfer` without inheriting any A state or metrics.
2. **Unit Isolation (`local-backend/test_i04_workspace.mjs` + `local-backend/test_home_widgets_js.mjs`)**:
   - Verified `homeWidgetStorageKey('user-alpha') !== homeWidgetStorageKey('user-beta')` and `homeWidgetStorageKey('') !== homeWidgetStorageKey('user-alpha')`.
   - Verified `mergeHomeWidgetsRecord()` keeps legacy `version: 2` geometry prefs intact when upgrading `workspace`.
