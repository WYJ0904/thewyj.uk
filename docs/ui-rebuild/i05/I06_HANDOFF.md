# I05 -> I06 Handoff Contract

## 1. Delivered State on `hydrogen/i05-workspace-admin-density`
- All 7 authenticated routes (`/select`, `/language`, `/tools`, `/finance`, `/transfer`, `/account`, `/admin`) + nested subroutes share a unified Cloudflare-dense frame (`--ds-container-console: 1320px`), grouped `#v3Sidebar`, sticky live `#workspaceBreadcrumb`, `4–8px` hairline geometry, `tabular-nums` alignment, and Samsung One UI grouped settings on `/account`.
- Zero I04 workspace regressions (`qa/i04/browser-acceptance.mjs` PASS) and zero I03 public homepage regressions (`qa/i03/browser-acceptance.mjs` PASS).
- `CORE_SHELL = 81`, `REQUIRED_SHELL = 89`, `INSTALL_SHELL = 89`, `aerisHomeWidgets:v2:<owner>`, `js/core/motion.js`, and backend RBAC remain completely compatible.

## 2. Extension Hooks & Boundaries for **I06** (Module-Specific Deep Refactors)
1. **Reuse `workspaceRouteMeta()` & `syncWorkspaceShell()` (`js/core/design-system.js`)**: Pass module-specific sub-labels (active deck/lesson, selected finance account, active admin drawer tab) into `refreshWorkspaceShell()` rather than building per-page breadcrumb DOM.
2. **Scoped Module Targets for I06**:
   - `/language`: Single-question FSRS learning focus canvas without breaking `#studyView` / `#wrongView` / `#achievementsView` shell integration.
   - `/finance`: Borderless infinite-feel ledger rows & slide-over transaction detail drawer preserving `#financeIncomeTotal` `tabular-nums` and modal trigger focus restoration.
   - `/tools`: Two-pane instant search & live tool preview preserving `#toolSearchInput` focus and `/tools/:tool_id` + `/tools/workflows` URL routing.
   - `/transfer`: Drag/progress feedback and collapsible transfer options without violating Task 28 D1/R2 encryption invariants.
   - `/admin`: Flagsmith-style status capsules, clean Flag action-bar flex wrapping (`#newFeatureFlagBtn` / `#refreshFeatureFlagsBtn` on 390px mobile), and structured audit timeline while **preserving DOM node identity** (`sameForm` / `sameCb` / zero `tbody.innerHTML` wipe) and Task 27 step-up flows.
3. **Hold for Later Slices**:
   - Leave `#featureFlagEnabled` / `#featureFlagKillSwitch` global custom switch styling and SVG Lucide icon migration for **I08** (or keep checkbox hits `<= 24px` / a11y-verified if customized).
   - Leave `#versionNotice` & multi-toast stacking untouched until **I09**.
   - Strengthen inactive `.v3-sidebar-nav a` muted contrast/transition if needed to guarantee zero frame-mid-transition axe contrast warnings.
