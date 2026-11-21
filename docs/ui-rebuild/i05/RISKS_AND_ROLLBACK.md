# Residual Risks & Rollback Boundaries (`I05`)

## 1. Observed Minor UI & Test Observations (Honest Scope Disclosure)
1. **Inactive Sidebar Link Transition Contrast (`#v3SidebarAdminLink`)**: During an intermediate run of `verify-preview.mjs` (`task-923`), `axe-core` flagged a single `color-contrast` check on `#v3SidebarAdminLink > span:nth-child(2)` right after switching away from `/admin` to `/account` before CSS transition completion. Subsequent clean verification (`task-948`) and all 7 routes in local `browser-acceptance.mjs` passed with `0` contrast violations. Recommendation for I06/I08: evaluate strengthening inactive `.v3-sidebar-nav a` light-mode muted text contrast or tightening color transition timing.
2. **390px 功能配置动作**。旧图 `preview/preview-390-admin.png` 保留逐字换行的历史状态。本轮改为独立选择器和双列按钮，实测见 [本轮验收](IMPLEMENTATION_REPORT.md#规范核对后的修复与复验)。
3. **Pre-existing I02 / I07 Regression Suite Items (Outside I05 Diff)**:
   - `qa/i02/browser-acceptance.mjs` reports `/` homepage `#publicLearningReset` scaled height `43.32px < 44px` inside `.scroll-preview-wrap` at `scrollY=0`.
   - `qa/i07/browser-acceptance.mjs` scenario `11` times out reopening its HTML fixture after scenario `10` registers `sw.js` on localhost without SW bypass.
4. **Deferred Modules**: Module-deep UX reworks remain strictly untouched for **I06**; global vector icons, checkboxes/Burn-After-Read fixes, and scroll-to-top polish remain untouched for **I08**; toast repositioning (`#versionNotice`) remains untouched for **I09**.
5. **Untested / Pending Items**: Physical Android WebView Back/Forward + soft-keyboard behavior (`ANDROID_PHYSICAL_DEVICE: NOT_TESTED`), Owner visual review (`OWNER_VISUAL_ACCEPTANCE: PENDING`), and Production deployment (`PRODUCTION_RELEASE: NOT_TOUCHED`).

## 2. Clean Rollback Plan
1. **Runtime Kill Switch (Zero Code Deploy)**: Disabling `p07_accessibility` in D1 (`enabled = 0`) immediately hides `#v3Sidebar`, `#workspaceBreadcrumb`, `#adminKpiStrip`, and `.admin-list-head` while keeping `#adminUserList` and core `/finance`/`/account` functional (`k_p07_off_fallback` + Preview `p07ToggleChecks` verified).
2. **Git Stacked PR Revert**: I05 lives entirely on `hydrogen/i05-workspace-admin-density` stacked on `hydrogen/i04-authenticated-workspace-redesign`; abandoning or reverting the PR restores the verified I04 state (`b5ebd1dadb523e442166be6dde7518f19ef9e5ef`) with zero database schema migrations or D1/R2 side effects.
3. **Preview Infrastructure Teardown**: `thewyj-i05-preview` and `aeris-i05-preview` are wholly isolated from Production and I04 and can be deleted cleanly via Wrangler.
