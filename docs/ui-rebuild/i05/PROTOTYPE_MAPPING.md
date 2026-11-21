# V1.1 & Gemini Prototype Mapping (`I05`)

Source documents audited before coding:
- `Aeris_I_series_UI_refactor_execution_baseline_v1.1_2026-11-17.txt` (107 lines)
- `Aeris_I_series_UI_interactive_prototype_2026-11-17.html` (2072 lines) + `proto_1440.png` + `proto_390.png`

## 1. Visual & Structural Pattern Mapping

| Prototype Anchor (Lines) | Prototype Role | Real Aeris DOM / Module Target | Reusable Base | I05 Decision & Acceptance Evidence |
|---|---|---|---|---|
| `.console-shell` (`623–628`, `966`) | Desktop 2-col frame + mobile 1-col collapse | `#v3AppFrame` + `.v3-workspace-shell` (`spatial-experience.css`) | Existing `#v3AppFrame` / `--ds-container-console` (`1320px`) | Retained `#v3AppFrame`, aligned content container & breakpoint collapse without DOM wrapper rebuild (`a_seven_route_sidebar_shell`, `i_responsive_theme_matrix`). |
| `.sidebar`, `.sidebar-group-title`, `.nav-item` (`629–669`, `1108–1204`) | Grouped navigation links + active left bar | `#v3Sidebar`, `.v3-sidebar-group-title`, `.v3-sidebar-nav a` (`index.html`, `spatial-experience.css`) | Existing `#v3Sidebar` nav buttons + `.v3-nav-dot` | Added `工作区` / `账户与系统` section titles; preserved `aria-current="page"` and server-gated `#v3SidebarAdminLink[hidden]` (`a_seven_route_sidebar_shell`, `h_non_admin_isolation`). |
| `.console-topbar`, `.breadcrumb`, `.console-header` (`676–718`, `1144–1227`) | Sticky location header & action strip | `#workspaceBreadcrumb` (`index.html`), `workspaceRouteMeta()` + `syncWorkspaceShell()` (`js/core/design-system.js`), `refreshWorkspaceShell()` (`app.js`) | Existing top header `#accountBar` + `--ds-*` tokens | Added sticky live breadcrumb reusing `<li>` nodes across all 7 routes + subroutes without wiping form state (`a`, `b_history_back_forward`, `c_tools_search_and_workbench`). |
| `.kpi-strip`, `.kpi-cell`, `updateAdminMeta()` (`721–760`, `970`, `1230–1247`, `1775–1798`) | Cloudflare-dense KPI summary row | `#adminKpiStrip` (`#adminKpiUsers`, `#adminKpiRecharge`, `#adminKpiAudit`, `#adminKpiLoginFailed`), `#adminRoleContext`, `setAdminKpi()` (`index.html`, `app.js`) | Real admin fetches (`loadAdminUsers`, `loadAdminRechargeRequests`, `loadAdminSecurityLogs`, `loadAdminLoginEvents`) | Wired to live `/api/admin/*` responses (`kpiCheck.kpiText == apiTotal` in both Miniflare & Hosted Preview), zero fake numbers (`g`, `verify-preview`). |
| `.cf-table-wrap`, `.cf-table`, `.switch`, `.slider`, `.kill-banner` (`472`, `1263–1290`, `1801–1863`) | High-density admin table & controls | `#adminPanel`, `.admin-list-head`, `#featureFlagForm`, `#featureFlagEnabled` / `#featureFlagKillSwitch`, `#featureFlagAudit` | Existing `js/core/feature-console.js` + `styles.css` (non-P07 fallback) | Added `.admin-list-head` structural headers (hidden when P07 OFF), preserved `20×20` native checkboxes (`<= 24px`), verified existing form/checkbox node identity (`removedCount === 0`) during live step-up save (`g_admin`). |
| `#view-workspace` (`1106–1168`) | Unified shell around personal workspace | `#authWorkspaceSection` on `/` & `/select` (`index.html`, `workspace-experience.css`, `spatial-experience.css`) | I04 `home-widgets.js` + `aerisHomeWidgets:v2:<owner>` | Harmonized margins, `tabular-nums`, button height/radius inside unified shell while leaving I04 card interactions untouched (`i04-browser-acceptance`). |

## 2. Rejected Prototype Anti-Patterns (Never Copied)
Per V1.1 §10 rules 1–5 and I05 authorization boundaries:
- **Mock admin state / demo flags / hardcoded KPI counts** (`5`, `3`, `2`, `OFF` in `1233–1245`, `1785–1788`): Rejected. Every KPI displays `—` until real `/api/admin/*` data arrives (`kpiText === "2"` matches `apiTotal === 2` on test fixtures & preview).
- **`tbody.innerHTML` / full-list destruction** (`renderAdmin()` line `1814`): Rejected. Preserved `js/core/feature-console.js` direct DOM node updates (`assert.equal(sameForm, true)`, `sameCb: true`, `removedCount: 0`).
- **Toast-faked API success** (`data-toast-msg`, `showToast("已更新...")` lines `1188–1199`, `1854`): Rejected. Real 503 network interception in `g_admin` proves `#featureConsoleStatus` never falsely displays `'设置已保存'`.
- **Single-direction `renderWorkspace()` rebuild** (V1.1 §10.1): Already resolved in I04 (`js/core/home-widgets.js`); untouched in I05.
- **Unified `.sheet-backdrop` centered sheet for mobile** (V1.1 §10.3): Rejected. Preserved I04/I07 mobile bottom drawer physics & `attachSheetAdapter()`.
- **Prototype Feature Flag toggle pills & audit timeline visual overhaul**: Deferred strictly to **I06** (`renderAdmin` Flagsmith-style status pills / timeline deferred out of I05 scope).
