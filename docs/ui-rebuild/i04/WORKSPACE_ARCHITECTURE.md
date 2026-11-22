# I04 Authenticated Workspace Architecture

## 1. Route & Entry Semantics (`/`, `/select`, `#publicHome`)
1. **Unauthenticated (`/`)**: `#publicHome[data-session-mode="guest"]` keeps every `[data-home-personal]` section (including `#authWorkspaceSection`) `hidden` (`display: none`). The I03 editorial homepage, interactive preview window (`#publicCapabilityGallery`), 5-tile Bento wall (`#publicBentoWall`), privacy section, plan catalog, and final CTA remain completely intact.
2. **Authenticated (`/` and `/select`)**:
   - `#publicHome[data-session-mode="authenticated"]` retains the exact `#publicHome` and `[data-public-section], .bento-tile, [role=tabpanel]` DOM skeletons required by P3.3 continuity checks (`qa/aeris/p33-shared-home-browser.mjs`).
   - Direct `/select` navigation in `app.js` `renderCurrentRoute()` now preserves the `/select` URL cleanly (no forced rewrite to `/`), keeping Android WebView bottom-tab deep links and browser Back/Forward history (`/select` <-> `/tools`) consistent while normalizing signed-in `/login` and `/register` visits to `/`.
   - `#authWorkspaceSection` sits right below `.public-hero` as the primary signed-in personal console, pairing Cloudflare Dashboard operational density with Samsung One UI 44×44px touch ergonomics and 4–8px (`--ds-radius-sm`/`--ds-radius-md`) workspace geometry.

## 2. Six Real-Data Bento Modules
All module projections derive exclusively from `createDashboardView()` (`js/core/dashboard.js`) and `projectHomeWidgets()` (`js/core/home-widget-data.js`) using real account state:
1. `learning` (**语言学习**): `studyRecords`, `historyWrongBook`, `dashboardGoal()`, `loadProjectRuntime()`, `learningSyncStatus`.
2. `finance` (**本月账本**): `financeController.dashboardSummary()` — shows `尚未读取` / `暂时不可用` until actually fetched; never fabricates ¥ balances.
3. `tools` (**实用工具箱**): `window.WYJTools.getSummary()` — favorites, recent tool counts, and direct continue shortcut (`continuePath`).
4. `transfer` (**文件传输**): `transferController.dashboardSummary()` + `temporary_share_access` entitlement gate (`restricted` state shown honestly for unentitled accounts).
5. `activity` (**最近活动**): real chronological merge of `studyRecords` and `tools.recent`, paired with `financeCandidatesController.dashboardSummary()` pending notification count.
6. `account` (**会员与数据服务**): `accountMembershipSummary()`, `accountEntitlements()`, live online/offline status, plus quick links to `/account`, `/recharge`, `/changelog`.

## 3. Reserved Future Extension Slot (Task 37 Audit Compatibility)
- Repository inspection across `docs/` and `cloudflare/migrations/` confirmed **no Task 37 specification or migration exists yet** (`0037` is `cloudflare/migrations/0037_task27_email_template_newlines.sql`).
- `#workspaceExtensionSlot[data-workspace-extension-slot="task37"]` is placed cleanly beneath `#workspaceBentoGrid` (`hidden` by default), and `WORKSPACE_MODULE_IDS` / `sanitizeWorkspaceBento()` automatically appends newly registered canonical module IDs to any existing saved user order without invalidating stored layouts.
- Zero unauthorized Task 37 backend APIs, tables, or mock panels were added.
