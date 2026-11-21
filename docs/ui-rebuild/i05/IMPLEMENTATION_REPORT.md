# Aeris V6.3 — I05 Workspace & Admin High-Density Unification: Implementation Report

## 1. Executive Summary
- **Stage**: `I05` — Authenticated Workspace & Admin High-Density Unification (`Cloudflare Dashboard` information density + `Samsung One UI` grouped list logic + Aeris brand identity).
- **Branch & Worktree**: `hydrogen/i05-workspace-admin-density` in `workspace_admin_density` (derived cleanly from verified I04 baseline `origin/hydrogen/i04-authenticated-workspace-redesign` at `b5ebd1dadb523e442166be6dde7518f19ef9e5ef`).
- **Stacked Draft PR Base**: `hydrogen/i04-authenticated-workspace-redesign`.
- **Commits**:
  - `b8c2731c19fcbbf26d19c7d8e4898a03267dc200` — `feat(ui-i05): unify workspace shell HTML, breadcrumb sync, and admin KPIs`
  - `d95c938038f33b3ec70c7488b3f3209dc4a704ea` — `style(ui-i05): apply Cloudflare-dense console and One UI account grouping`
  - `e4e781f2ad5e4cc791f70a2880952d683c041368` — `chore(ui-i05): update asset release manifest, CI, tests, and browser evidence`
  - Docs & live preview verification follow-up commit adding `qa/i05/verify-preview.mjs` race fix and `docs/ui-rebuild/i05/` reports.
- **Boundary Compliance**:
  - Strictly excluded I06 module reworks (FSRS study UI, borderless finance ledger/drawer edit, two-pane instant tool search, transfer drag-progress rewrite, Flagsmith pills/audit timeline), I08 icon replacement / global checkbox/toast/scroll fixes, I09 `#versionNotice` & toast stacking, and Task 53–61 new backend features.
  - Preserved PWA shell counts (`CORE_SHELL = 81`, `REQUIRED_SHELL = 89`, `INSTALL_SHELL = 89`), `aerisHomeWidgets:v2:<owner>` storage contract, and `P07 OFF` graceful degradation.
  - Added zero third-party npm packages, zero React/framework bundles, and zero `!important` declarations in the I05 stylesheet layer.

## 2. Code & Asset Changes
- **`index.html`**:
  - Added `#v3Sidebar` grouped labels (`.v3-sidebar-group-title`: `工作区`, `账户与系统`), sticky `#workspaceBreadcrumb` bar (`nav[aria-label="面包屑导航"]`), `#adminRoleContext` role summary, 4-cell `#adminKpiStrip` (`#adminKpiUsers`, `#adminKpiRecharge`, `#adminKpiAudit`, `#adminKpiLoginFailed`), `.admin-list-head` structural table column headers across Users/Recharge/Audit/Login tabs, and One UI grouped `#accountModal` summary/settings wrappers (`.account-settings-list`).
- **`js/core/design-system.js`**:
  - Implemented `workspaceRouteMeta(pathname, options)` mapping `/`, `/select`, `/language`, `/language/english`, `/language/japanese`, `/tools`, `/tools/workflows`, `/tools/:tool_id`, `/finance`, `/transfer`, `/account`, `/recharge`, and `/admin` (+ section trail).
  - Implemented `syncWorkspaceShell(doc, meta)` setting `document.body.dataset.workspaceRoute` and updating `#workspaceBreadcrumb` with `<li>` node reuse (no full DOM destruction) and `aria-current="page"`.
- **`app.js`**:
  - Added `refreshWorkspaceShell()` hooked into route/view transitions (`showModulePicker`, `showDashboard`, `showLanguageWorkspace`, `showToolsPanel`, `showToolsRoute`, `showWorkflowsRoute`, `showFinancePage`, `showTransferPage`, `openAccountModal`, `openRechargePage`, `showAdminPanel`, `selectAdminTab`, `openPublicTool`, and `hidePrimaryScreens`).
  - Added `setAdminKpi(id, value)` (keyed numeric update with `kpi-bump` micro-feedback without rebuilding container nodes) and `resetAdminKpis()` integrated cleanly into `loadAdminUsers()`, `loadAdminRechargeRequests()`, `loadAdminSecurityLogs()`, `loadAdminLoginEvents()`, and logout/non-admin cleanup.
- **`design-system.css`, `styles.css`, `workspace-experience.css`, `spatial-experience.css`**:
  - Added `--ds-container-console: 1320px` and expanded `tabular-nums` coverage (`account-detail-grid`, admin KPI values, audit/log rows, quotas, SHA-256).
  - Replaced 25 literal `border-radius` values on existing workspace/card selectors with `--ds-radius-lg` / `--ds-radius-md` / `--ds-radius-sm` (4–8px scale).
  - Appended the `I05 Workspace Console Layer` in `spatial-experience.css` (0 `!important` declarations), unifying authenticated module density, page header/filter/action bar rhythm, One UI grouped `/account` settings rows, `/admin` Cloudflare-dense KPI strip + `.admin-list-head` table rhythm, dark mode token contrast, and P07 OFF hiding rules (`html:not([data-p07-ui="enabled"]) :is(.workspace-breadcrumb, .admin-kpi-strip, .admin-list-head) { display: none; }`).
  - Preserved native `20×20` sizing for `#featureFlagEnabled` and `#featureFlagKillSwitch` (`<= 24px`).
- **Release Manifest & QA/CI**:
  - Updated `?release=20261121-aeris-i05-preview` across `index.html`, `sw.js`, `app.js`, `tools.js`, `js/**/*.js`, and regenerated `task27:publication` integrity manifest (`publication_hash: 3b1eca2919cb12d31cb53d60326dbb68b830d010064e72882e870659289aa353`, `integrity_entries: 20`).
  - Added `local-backend/test_i05_workspace_shell.mjs`, `qa/i05/browser-acceptance.mjs`, `qa/i05/provision-preview.mjs`, `qa/i05/stage-preview.mjs`, and `qa/i05/verify-preview.mjs`; integrated `test_i05_workspace_shell.mjs` into `.github/workflows/ci.yml`.

## 3. Verification Summary
- **Unit / Static / Build**: All static & unit suites PASS (`test_i02_css_contracts.mjs` 6/6, `test_i03_public_pages.mjs`, `test_i04_workspace.mjs`, `test_i05_workspace_shell.mjs`, `test_motion_js.mjs`, `test_core_js.mjs`, `test_home_widgets_js.mjs`, `test_stage_pages_deploy.mjs` 28/28, `check_js_module_graph.mjs`, `check_storage_contract.mjs`, `test:task27` 33/33, `test:task28` 31/31, `test:task29` 7/7, `test:task30` 10/10, `npm run cf:check`, `npm run build`).
- **Local Browser Acceptance (`qa/i05/browser-acceptance.mjs`)**: **PASS** (`13/13` scenarios, `70` viewport×theme×route cells `overflow <= 1`, `0` axe-core violations across all 7 routes, `0` runtime errors, `0` 5xx API errors, `16` PNG screenshots).
- **Regression Browsers**: `qa/i03/browser-acceptance.mjs` **PASS**, `qa/i04/browser-acceptance.mjs` **PASS**; `qa/i02` observed pre-existing `/` homepage `#publicLearningReset` `43.32px` scaled rect (`exit 1`); `qa/i07` observed known scenario-11 SW fixture navigation timeout (`exit 1`). See [`REGRESSION.md`](./REGRESSION.md).
- **Isolated Hosted Preview (`thewyj-i05-preview`)**: Provisioned (`aeris-i05-preview`), deployed (`deploymentId: f3304762-c50d-4ead-a52b-fa079838e0ee`, `https://i05-workspace-density.thewyj-i05-preview.pages.dev`), and verified via `node qa/i05/verify-preview.mjs` (**PASS**, `6` axeScans with `0` violations, `5` clean screenshots, `nonAdminApiStatus === 403`, `p07ToggleChecks.restoredOn === true`).

## 4. Gate Status Overview
- `OWNER_VISUAL_ACCEPTANCE`: `PENDING`
- `ANDROID_PHYSICAL_DEVICE`: `NOT_TESTED`
- `PRODUCTION_RELEASE`: `NOT_TOUCHED`
- `PR_MERGE`: `NOT_MERGED` (Stacked Draft PR against `hydrogen/i04-authenticated-workspace-redesign`)
