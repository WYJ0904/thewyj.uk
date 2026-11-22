# Aeris I08 — Global Polish, Vector Icons, Selection Controls & Route Scroll Governance Report

- **Branch**: `hydrogen/i08-global-polish`
- **Stacked Base**: `hydrogen/i06-module-experience` (`eef9f1c3ac45b2e184a48b695c7be4a4d7d3572a`, Draft PR #174)
- **Product & Core QA Commit**: `0363e3bf` (`feat(ui-i08): route scroll governance, vector icons, kill switch warning, and control polish`)
- **Production Status**: `NOT_TOUCHED` (`WYJ_DB` `11c288d8-c584-409f-bb1f-7e7af11793e5`, Production R2, feature flags, accounts, and Stable pointers untouched)

---

## 1. Scoped I08 Deliverables

1. **Authenticated Route Scroll Governance (`app.js`)**
   - Added `applyWorkspaceRouteScroll(pushHistory)` reusing the `pendingPopScroll` history state contract established for public routes: forward workspace navigation resets scroll cleanly to `(0, 0)`, while `popstate` back/forward restores the saved `scrollX` / `scrollY`.
   - Wired `applyWorkspaceRouteScroll(pushHistory)` across all 8 authenticated route transitions (`showProjectPicker`, `enterProject`, `showTools`, `showMembership`, `showAccount`, `showFinance`, `showTransfer`, `showAdminPanel`), and updated `showAdminPanel` from raw `history.pushState` to `pushRoute("/admin")` so leaving `/admin` preserves scroll state cleanly.

2. **Global Vector Icons & Sidebar Contrast/Transition Fix (`index.html`, `spatial-experience.css`)**
   - Replaced all 10 `#v3Sidebar` navigation dots (`.v3-nav-dot`) with crisp `16×16` stroke inline SVG icons (`.v3-nav-icon`), replaced `.home-quick-access` text arrows (`→`) with `16×16` SVG arrows (`.home-quick-arrow`), and upgraded `#accountModal .account-settings-list` rows with leading `.account-setting-icon` SVGs and trailing `.account-setting-chevron` SVGs (removing the CSS rotated-border `::after` pseudo-chevron).
   - Removed the transient color transition lag on `.v3-sidebar-nav a` (`transition: background-color var(--ds-duration-fast) var(--ds-ease-standard);`) to prevent mid-transition contrast dips across route switches.

3. **Selection Controls, Kill Switch Warning & Primary Link/Button Alignment (`index.html`, `js/core/feature-console.js`, `spatial-experience.css`)**
   - Styled `#featureFlagEnabled` / `#featureFlagKillSwitch` and `#transferPage .transfer-check` (`#transferOneTime`, `#transferPrivate`) as `44px`-tall semantic toggle rows with `:has(:checked)` state tinting while strictly preserving native `<input type="checkbox">` geometry at `20×20px` (`<= 24px`).
   - Added live `#featureFlagKillWarning` and `data-kill-active` state synchronization in `js/core/feature-console.js` when `#featureFlagKillSwitch` is enabled, without altering `#featureFlagForm` or `#featureFlagEnabled` DOM node identity.
   - Aligned `a.primary` / `a.button-link.primary` and `button.primary` height and baseline parity (`min-height: var(--ds-touch-min)`, `line-height: 1.25`) inside `.public-actions` and `.action-row`.

---

## 2. Clean-HEAD Verification (Commit `0363e3bf`)

| Check | Result | Scope & Observed Details |
| :--- | :--- | :--- |
| `node qa/i08/browser-acceptance.mjs` | **PASS** (4/4) | Isolated Miniflare D1/R2 + headless Chrome; `worktreeDirty: false`; route scroll reset (`420 -> 0`) and `popstate` restore (`246`); 10 sidebar SVGs & 3 account icons/chevrons; `20×20` checkbox invariants + Kill Switch warning (`killActive: "true"`); `a.primary` vs secondary link (`44px`, `topDiff: 0`); `2` axe scans `0` violations; `P07 OFF` hiding; `0` runtime/5xx errors; 3 screenshots |
| `node qa/i06/browser-acceptance.mjs` | **PASS** (6/6) | Verified prior to final commit with all 12 I06 screenshots & `0` regressions |
| `node --test local-backend/test_i02..i08` | **PASS** (20/20) | All I02–I08 CSS, public pages, workspace layout, shell, module, and polish contracts passed (`81/89/89` SW shell counts, `0` `!important` in I06/I08 layers) |
| `python -m unittest local-backend/test_static.py` | **PASS** (31/31) | Static HTML/CSS/JS contracts passed |
| `node scripts/check_js_module_graph.mjs` | **PASS** | `67 files, 114 imports`, 0 cycles |
| `npm run task27:publication`, `npm run build`, `npm run cf:check` | **PASS** | Publication hash `d78dc57a91e88b00fbad60aea6190a6d08acb3030aac94b32a7348a603ed154e`, Pages staging & Worker compile passed |

---

## 3. Evidence & Boundaries

- **Local Clean-HEAD Evidence**: [`evidence/i08-acceptance-report.json`](evidence/i08-acceptance-report.json), `1440-i08-account-icons-light.png`, `390-i08-account-icons-light.png`, `1440-i08-admin-kill-switch-light.png`
- **Deferred to I09**: `#versionNotice` toast repositioning & toast stacking polish.
- **Not Tested / Untouched**: Hosted Preview deployment for `I08` (local Miniflare + Chrome verified; isolated I06 Hosted Preview remains pinned to verified `I06` commit `2550b14a`), Android physical device, and Production. PRs remain Draft.
