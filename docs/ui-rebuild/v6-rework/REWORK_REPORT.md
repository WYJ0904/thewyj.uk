# Aeris V6.3 UI/UX Quality Rework Report

- **Base Branch / Commit**: `hydrogen/i-v6-final-ui-integration` (`9243796c7ad83ca4a868bc65839fd7c957f15673`)
- **Rework Branch**: `hydrogen/i-v6-ui-ux-quality-rework`
- **Previous Baseline Draft PR / Preview (Untouched Comparison)**: Draft PR `#177` / `https://thewyj-v6-preview.pages.dev` (`aeris-v6-preview`)
- **New Isolated Rework Preview**: `https://thewyj-v6-rework-preview.pages.dev` (D1 `aeris-v6-rework-preview` `08e9e646-1059-43bd-adcb-e32c61eee5b8`, R2 `aeris-v6-rework-storage`; `p07_accessibility` enabled, `TASK16_CLOUD_READS_ENABLED="true"`, `TASK16_CLOUD_WRITES_ENABLED="true"`)

> **Production Safety**: Production (`thewyj-uk`), `wyj-cloud-production`, `wyj-cloud-preview`, `aeris-v6-preview`, `thewyj-v6-preview.pages.dev`, `main`, Email Routing, and Android Stable were **not modified**. No passwords or secrets are stored in this repository.

---

## 1. Root Defects Resolved (P0-A through P0-E + Motion & Preload)

1. **P0-A (Authenticated Home Hierarchy & Density)**: Flattened nested boxed sections inside `#authWorkspaceSection`, removed verbose `"（本地按账户隔离）"` copy in favor of `"标准视图"` / `"已保存"`, grouped sidebar footer shortcut pills (`.v3-shortcut-item`) to prevent orphaned wrapping, and tuned `compact` density strip row height (`#workspaceDensityBtn`).
2. **P0-B (Preview Tab Auto-Scroll Fix)**: Guarded `[data-public-open]` `scrollIntoView` in `js/core/public-experience.js` to scroll only when the capability gallery is outside the viewport, added `{ preventScroll: true }` on tab and trial focus helpers (`js/core/public-experience.js`, `app.js`), and locked `.aeris-window-content` height during `createTabSkeletonSwitcher.switchTab` (`js/core/motion.js`). Measured `scrollY` delta across all 4 preview tabs at `1440px` and `390px`: **0 px**.
3. **P0-C (Finance Native Currency `<select>` & Cloud Bindings Fix)**:
   - Fixed `.modal-panel` and `.finance-editor-modal` entry animation `animation-fill-mode` from `both` to `backwards` (`design-system.css`, `spatial-experience.css`) so `transform` settles to `none` and native `<select>` popups are no longer trapped in a transform containing block.
   - Added `.finance-currency-grid` (`index.html`, `spatial-experience.css`) placing `展示币种`, `账户基准币种`, and `未标明币种时` into a single 3-column bar on desktop.
   - Deployed the new isolated preview with `env.preview.vars` (`TASK16_CLOUD_READS_ENABLED="true"`, `TASK16_CLOUD_WRITES_ENABLED="true"`) and dedicated D1/R2 bindings so `/api/finance/currencies` and `/api/finance/bootstrap` return `200` with all currency `<select>` controls unlocked.
4. **P0-D (Finance Register, Focus Ring & Honest Empty States)**:
   - Suppressed persistent mouse-click focus outlines on `<details.finance-fold> > summary` via `:focus:not(:focus-visible)` (`spatial-experience.css`).
   - Replaced generic empty message in `js/finance/app.js` with 5 explicit diagnostic states (`last_error` sync failure, not yet synced + `立即同步`, active filter mismatch + `清空筛选条件`, other months hold `N` records + `查看全部月份`, genuinely empty ledger).
   - Aligned `.finance-register-head` with `.finance-transaction` row layout.
5. **P0-E (IT-Tools Search/Rail & n8n Split Workflows)**:
   - Relocated `#toolSearchInput` + `.tool-search-kbd` to full width above `.tools-two-pane` (`820px` input width at `1440px`), widened the category rail to `272px` with single-line ellipsis names (`tools.js`, `spatial-experience.css`), and added hover tooltips.
   - Reworked `/tools/workflows` with a dot-grid node workspace and 2-column `.workflow-runner-grid` (`INPUT · 运行输入` | `OUTPUT · 执行结果`).
6. **Motion & Safe Preload**: Added compositor-only `animateRouteViewEntrance` and `createAssetPrefetcher` in `js/core/motion.js` / `app.js` for non-private static modules, guarded by `navigator.onLine`, `saveData`, and `2g`/`slow-2g` checks plus route deduplication.

---

## 2. Functional QA Results (Post-Final-Edit Verification)

All checks below ran cleanly after the final code edit (`exit code 0`):

- **Build & Publication**: `npm run task27:publication` (`publication_hash: 274bbce216a645178c90eb00218ef623df64a6f498ce9893b084d59afcf4f950`), `npm run build`, `npm run cf:check` — PASS.
- **Static & Contract Gates**: `scripts/check_js_module_graph.mjs` (67 files / 116 imports), `scripts/check_storage_contract.mjs` (31 key families), `scripts/functional_audit_gate.py` (27 routes, 24 flows, 104 tools, 51 modes, 7 checkboxes, 12 workflow capabilities, 27 workflow flows), `local-backend/test_static.py` (31 tests OK), `scripts/repository_audit.py` (2278 files checked) — ALL PASS.
- **Unit & D1 Suites**:
  - `node --test local-backend/test_i0*.mjs local-backend/test_v6_ui_contracts.mjs`: **41 / 41 PASS** (includes static route existence and offline/`saveData`/`2g` prefetch guards).
  - `npm run test:ds-sso`: **23 / 23 PASS**.
  - `npm run test:task25`, `npm run test:task27:login-guard`, `npm run test:task26` (all 12 subtests), `local-backend/test_task16_d1_js.mjs` (11 checks), `npm run test:task17` — ALL PASS.
- **Serial Browser Suites (`run_ci_browser_suite.mjs` / Miniflare + Headless Chrome)**:
  - `qa/i03/browser-acceptance.mjs`: **4 / 4 scenarios PASS**, 11 axe scans, 4 viewports.
  - `qa/i04/browser-acceptance.mjs`: **11 / 11 scenarios PASS**, 7 axe scans, 10 viewports.
  - `qa/i07/browser-acceptance.mjs`: **10 / 10 scenarios PASS**, 5 axe scans (`maxSeamDriftPx: 0`).
  - `qa/i08/browser-acceptance.mjs`: **5 / 5 scenarios PASS**.
  - `qa/i09/browser-acceptance.mjs`: **4 / 4 scenarios PASS**.
  - `qa/task25/feature-flags-browser.mjs`, `qa/aeris/p3-brand-public-browser.mjs` (CLS=0 across 390/1366/1920), `qa/aeris/p31-home-browser.mjs` (8 matrix cases), `qa/aeris/p33-shared-home-browser.mjs` (8 guest + 8 auth + 4 restores) — ALL PASS.
  - `qa/task27/browser.mjs` (11/11), `qa/task27/web-notification-browser.mjs`, `qa/task28/browser.mjs` (5/5), `qa/task29/browser.mjs` (5/5), `qa/task30/browser.mjs` (4/4) — ALL PASS.
  - `verify_v6_rework.mjs`: **PASS** across 10 viewport/theme combinations (`375/390/768/1024/1440 × light/dark`, zero horizontal overflow, 0 runtime errors), all 6 currencies (`CNY`, `USD`, `EUR`, `HKD`, `GBP`, `JPY`), reload persistence, empty filter recovery, keyboard native select navigation, IT-Tools search + Enter launch, 3-step CSV workflow execution, and CDP screencast capture (`429` frames, 9 keyframes saved under `evidence/recording-step-01.jpg`..`09.jpg`).
- **Live Hosted Preview (`https://thewyj-v6-rework-preview.pages.dev`)**: Deployed from the post-final-edit staged `.wrangler/pages-output`; verified real API & Chrome logins for both `v6_rework_admin` (`super_admin`, `/api/admin/*` 200, `/api/finance/currencies` 200, `/api/finance/bootstrap` 200) and `v6_rework_user` (`user`, `/api/admin/*` 403, admin sidebar link hidden), zero console/runtime errors.

---

## 3. Visual & UX Self-Critique (Separate from Functional QA — Pending Owner Sign-Off)

Functional and browser regression passes **do not constitute visual approval**. Final visual satisfaction is reserved strictly for the Owner.

**Observable Improvements**:
- Eliminated the 3-column-to-2-row orphan in `.finance-currency-grid` and aligned the hairline ledger register (`rework-finance-1440-light.png`, `rework-finance-register-loaded-1440.png`).
- Restored a full-width IT-Tools search bar (`820px`) with single-line 272px category items and clean 3-column hairline cards (`rework-tools-1440-light.png`).
- Flattened authenticated `/` cards, removed redundant `"（本地按账户隔离）"` text, and provided clean 1-line compact strip rows (`rework-auth-home-1440-light.png`, `rework-auth-home-compact-1440.png`).
- Separated `/tools/workflows` into a dot-grid node flow + split `INPUT | OUTPUT` inspector (`rework-workflows-1440-light.png`, `rework-workflows-runner-1440.png`).

**Remaining Nuances Observed in Screenshots**:
- On initial login before dismissal, the bottom-right `#versionNotice` card (`"已更新至 v2026.11.18.2"`) slightly overlaps bottom-right card copy at `1440×900`, and when `TASK27_SECURITY_ENABLED=true` is active for a new test user without 2FA enrolled, the optional `"完善账户安全"` modal appears once on first login until dismissed.
- Interactive screencast capture fell back cleanly to 9 sampled CDP keyframes (`recording-step-01.jpg`..`09.jpg`) because `ffmpeg` was not installed in this Windows environment.

---

## 4. Rollback Plan

1. Revert or close the stacked Draft PR against `hydrogen/i-v6-final-ui-integration` (`git revert <commit-range>` cleanly restores `9243796c7ad83ca4a868bc65839fd7c957f15673` without affecting PR `#177` or `main`).
2. Delete the isolated rework preview resources (`npx wrangler pages project delete thewyj-v6-rework-preview`, `npx wrangler d1 delete aeris-v6-rework-preview`, `npx wrangler r2 bucket delete aeris-v6-rework-storage`); `thewyj-v6-preview.pages.dev` and `thewyj-uk` Production remain unaffected.
