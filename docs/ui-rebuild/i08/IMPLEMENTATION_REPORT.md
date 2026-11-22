# Aeris I08 — Global Polish, Vector Icons, Selection Controls & Route Scroll Governance Report

- **Branch**: `hydrogen/i08-global-polish`
- **Stacked Base**: `hydrogen/i06-module-experience` (`eef9f1c3ac45b2e184a48b695c7be4a4d7d3572a`, Draft PR #174)
- **Original Baseline Commit**: `0363e3bf` / `af58c4e1`
- **Stage A Remediation Commits (R01–R04)**:
  - `f71d34ac` — `fix(ui-i08): resolve post-login inert lock, unify password copy, exact route scroll restore, and preview QA`
  - `9c30f5fd` — `chore(qa-i08): extend pages deploy timeout for initial preview upload`
  - `99224900` — `fix(qa-i08): avoid scrollIntoView shifting scrollY on already-visible sticky sidebar links`
  - `ac9bf53d` — `fix(ui-i08): preserve WCAG AA contrast on busy sidebar nav items`
  - `76f2f441` — `fix(qa-i08): await authTransitionScreen exit before reading noPromptState`
- **Isolated Hosted Preview**: `thewyj-i08-preview` (`https://i08-global-polish.thewyj-i08-preview.pages.dev`, deployment `130b118c-8f88-4cfe-a28e-36a0cbccbacd` -> `https://130b118c.thewyj-i08-preview.pages.dev`) + isolated D1 `aeris-i08-preview` (`db9ec9c6-daa9-4b3b-9792-a6ba8bb3a7f7`)
- **Production & I06 Isolation**: `NOT_TOUCHED` (`WYJ_DB` `11c288d8-c584-409f-bb1f-7e7af11793e5`, `thewyj-uk` Production, `thewyj-i06-preview`, Production R2, feature flags, real accounts, and Android Stable pointers untouched)

---

## 1. Stage A Remediation Root Causes & Fixes (R01–R04)

1. **R01｜Post-Login `#v3AppFrame` Inert Lock (`app.js`)**
   - **Root Cause**: `showAuthTransition()` set `v3AppFrame.inert = true`; `login()` invoked `applyAccount()` -> `schedulePendingSiteMessages()` before `completeStartupSplash()` finished. When `#siteMessageModal` (`"完善账户安全"`) opened mid-transition, `finishAuthTransition()` set `v3AppFrame.inert = Boolean(document.querySelector(".modal-layer:not(.hidden)"))` (preserving `inert = true`), while `closeModal()` only cleared `#appShell.inert = false` — leaving `#v3AppFrame` (`#v3Sidebar` + `#v3MainCanvas`) permanently non-interactive after closing the security prompt.
   - **Fix**: Unified shell interactivity via `activeBlockingModals()`, `syncShellInteractivity()`, and `focusWorkspaceFallback()`. Deferred `showNextSiteMessage()` while `auth-transition-active` is active and invoked it in `finishAuthTransition()`. Guarded repeat closes during `is-closing`, wired `#siteMessageModal` mobile swipe close (`onRequestClose`) to `dismissActiveSiteMessage()`, and added `{ preventScroll: true }` on confirm-only Escape focus.
2. **R02｜Password Copy Unification (`index.html`, `app.js`, `js/admin/formatters.js`, `functions/_lib/task12-*.mjs`, `functions/_lib/task27-login-guard.mjs`, `local-backend/*`, `qa/*`)**
   - Unified user-facing authentication labels, placeholders, buttons, and validation messages to `登录密码` / `当前密码` / `新密码` / `再次输入新密码` / `安全密码` while preserving technical key terms (API keys, TOTP setup keys `手动密钥`/`设置密钥`, WebCrypto `加密密钥`, WiFi hex keys, backup passphrases `备份口令`), DOM IDs, API payload keys, `autocomplete` attributes, and auth logic.
3. **R03｜Accurate Route Scroll Restoration (`js/core/router.js`, `app.js`)**
   - **Root Cause**: Route handlers (`showFinance`, `showTools`, etc.) called `hidePrimaryScreens()` before `pushRoute()`, shrinking `scrollHeight` and clamping `window.scrollY` (`420 -> 246`) before state save; async hydration then ran after `applyWorkspaceRouteScroll()` cleared `pendingPopScroll`; forward `popstate` (`history.forward()`) without saved scroll failed to reset to `0`; and `scrollIntoView` on already-visible sticky sidebar links shifted `scrollY` before popstate restoration.
   - **Fix**: Captured `pendingOutgoingScroll` at the entry of `hidePrimaryScreens()` and passed `getScrollPosition` into `createRouter()`. Returned `reapplyPopScroll()` callbacks from `applyWorkspaceRouteScroll` / `applyPublicRouteScroll` guarded by `isRouteGenerationCurrent(generation)` after async hydration. Added `pendingPopReset` for forward `popstate`, set `history.scrollRestoration = "manual"`, and avoided `scrollIntoView` when the sidebar nav link is already within viewport bounds. Verified exact `min(savedScrollY, maxScrollY)` restoration (`420 -> 0 -> 420 -> 0`, `maxScrollY: 996` local / `1074` hosted).
4. **Sidebar Busy WCAG AA Contrast Fix (`spatial-experience.css`)**
   - Hosted Preview `axe-core` audit caught `[aria-busy="true"] { opacity: 0.76; }` in `design-system.css` temporarily dropping `.v3-sidebar-nav a` contrast below `4.5:1` during async navigation. Added explicit I08 rule (`opacity: 1; color: var(--ds-text); background: var(--ds-surface-subtle);`, `0` `!important`) for `html[data-p07-ui="enabled"] .v3-sidebar-nav a[aria-busy="true"]`.

---

## 2. Verification Summary (Local & Isolated Hosted Preview Distinct)

| Check & Environment | Scope / Commit | Result | Observed Details |
| :--- | :--- | :--- | :--- |
| `node qa/i08/verify-preview.mjs` (**Isolated Hosted Preview**) | Clean commit `76f2f441` on `https://i08-global-polish.thewyj-i08-preview.pages.dev` | **PASS** | `10/10` core asset SHA-256 parity (`design-system.css`, `spatial-experience.css`, `app.js`, `tools.js`, `js/core/*`, `js/finance/app.js`, `js/transfer/app.js`, `js/admin/formatters.js`); R01 with-prompt (`完善账户安全` -> close -> `/language`, `appShellInert: false`, `frameInert: false`) & no-prompt (`modalHidden: true`); R02 copy (`修改登录密码`, `当前密码`, `再次输入新密码`, `hasLegacy: false`); R03 scroll (`420 -> 0 -> 420`, `scrollHeight: 2208 -> 1974`, `clientHeight: 900`, `expectedY: 420`); Kill Switch (`killActive: "true"`, `capsule: "kill"`, `warnVisible: true`, `20×20` checkboxes); `P07 OFF` (`display: none`, no overflow); Reduced Motion; 3 `axe-core` scans (`1440-light`, `375-dark`, `admin-kill-switch`) `0` violations; `0` runtimeErrors; 5 screenshots |
| `node qa/i08/browser-acceptance.mjs` (**Local Miniflare**) | Clean commit `ac9bf53d` (`worktreeDirty: false`, run `run-LMooTC`) | **PASS** (5/5) | R01 `完善账户安全` + mobile nav; R03 `420 -> 0 -> 420 -> 0` (`maxScrollY: 996`); `10` sidebar SVGs (`>=16px`) & `3` account icons/chevrons; `20×20` checkboxes + Kill Switch warning; `a.primary` vs secondary (`44px`, `topDiff: 0`); `2` axe scans `0` violations (`46`, `49` passes); 3 screenshots |
| `npm run build`, `npm run cf:check`, `node scripts/check_js_module_graph.mjs` (**Local**) | Workspace after Stage A edits (`fiery_signal_warps_01h58`) | **PASS** | `205` staged Pages files, Worker compiled cleanly, `67 files, 114 imports`, 0 cycles |
| `node --test local-backend/test_i0*.mjs` (**Local**) | `test_i02..i08` after `ac9bf53d` | **PASS** (34/34) | All I02–I08 CSS, public/workspace/module/motion/polish & `0` `!important` checks passed |
| `python -m unittest local-backend/test_static.py` (**Local**) | Static contracts after `ac9bf53d` | **PASS** (31/31) | Static HTML/CSS/JS/SW contracts passed |
| `python -m unittest discover -s local-backend -p "test_accounts.py"` (**Local**) | Prior to doc-only update (after code edits) | **PASS** (57/57) | Account validation & R02 password copy contracts |
| `npm run test:task27:login-guard`, `npm run test:task27`, `node local-backend/test_task12_d1_js.mjs` (**Local Isolated D1**) | After code edits | **PASS** (9/9, 33/33, 15/15) | Task 12 & Task 27 isolated D1/API/login-guard tests |
| `node qa/i04/browser-acceptance.mjs`, `node qa/i06/browser-acceptance.mjs` (**Local Miniflare**) | Regression checks after code edits | **PASS** (11/11, 6/6) | I04 (`7` axe scans, `10` viewports) and I06 (`6` scenarios, `12` screenshots) passed |
| `node qa/task27/web-notification-browser.mjs` (**Local Miniflare**) | Pre-existing Task 27 vs I07 interaction (not in `.github/workflows/ci.yml`) | **FAIL** (line 116) | `v3AppFrame` `background_width_ranges: 24.318px` when desktop Task 27 Security/Inbox sheet opens (`body.ds-sheet-scaling #v3AppFrame { transform: scale(0.982) }` from I07); `appShell: 0`, `accountBar: 0`; left untouched in I08 to avoid overturning I07 sheet scaling outside scope |

---

## 3. Archived Evidence & Boundaries

- **Local Clean-HEAD Evidence**: [`evidence/i08-acceptance-report.json`](evidence/i08-acceptance-report.json), `1440-i08-account-icons-light.png`, `390-i08-account-icons-light.png`, `1440-i08-admin-kill-switch-light.png`
- **Isolated Hosted Preview Evidence**: [`evidence/i08-preview-provision.json`](evidence/i08-preview-provision.json), [`evidence/i08-preview-stage.json`](evidence/i08-preview-stage.json), [`evidence/hosted/i08-preview-source-check.json`](evidence/hosted/i08-preview-source-check.json), [`evidence/hosted/i08-preview-verification.json`](evidence/hosted/i08-preview-verification.json), `hosted-i08-account-1440-light.png`, `hosted-i08-account-390-light.png`, `hosted-i08-account-375-dark.png`, `hosted-i08-admin-kill-switch-1440-light.png`, `hosted-i08-admin-kill-switch-1440-dark.png`
- **Untouched / Not Executed**: Physical Android device (`NOT_TESTED`), Production deployment (`NOT_TOUCHED`). PR `#175` remains **Draft**.
- **Handover to Stage B (`hydrogen/i09-system-feedback`)**: `#versionNotice` vs `.ds-toast-region` positioning, toast queue/lifecycle semantics, Kill Switch server-persistence state linkage, and modal/sheet notification layering.
