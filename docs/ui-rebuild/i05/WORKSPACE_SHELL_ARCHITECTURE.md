# Workspace Shell Architecture & Lifecycle (`I05`)

## 1. Frame Hierarchy
After authentication + P07 policy activation (`html[data-p07-ui="enabled"]`), all seven authenticated modules run inside a single persistent frame in `index.html`:
- **`#accountBar` (Global Sticky Topbar)**: Brand identity, Android/Changelog shortcuts, connectivity pill, notifications bell + search (`#globalSearchBtn`), system theme switcher, account menu + admin badge.
- **`#v3AppFrame` -> `#v3Sidebar` (Persistent Desktop Navigation Rail / Mobile Drawer)**:
  - Grouped under two explicit `.v3-sidebar-group-title` sections:
    - **`工作区`**: `首页` (`/` & `/select`), `学习` (`/language`), `免费试用`, `财务` (`/finance`), `工具箱` (`/tools`), `工作流` (`/tools/workflows`), `文件` (`/transfer`).
    - **`账户与系统`**: `会员` (`/recharge`), `账户` (`/account`), `管理后台` (`/admin`, `#v3SidebarAdminLink` strictly `[hidden]` unless authenticated role is admin/super_admin).
- **`#workspaceBreadcrumb` (`nav.workspace-breadcrumb`, sticky sub-header)**:
  - Displays dynamic route hierarchy (`Aeris / 个人工作台`, `Aeris / 工具箱 / JSON 格式化`, `Aeris / 管理后台 / 功能发布`, etc.).
  - Styled cleanly within `--ds-surface-card` + `1px` `--ds-border-default` hairline; automatically hidden via CSS (`display: none`) when `P07 OFF` (`html:not([data-p07-ui="enabled"])`) or when signed out (`[hidden]`).

## 2. Declarative Route Metadata & Node Reuse (`js/core/design-system.js`)
- `workspaceRouteMeta(pathname, { authenticated, toolTitle, adminSection })` normalizes trailing slashes and resolves:
  - `/` | `/select` -> `{ id: "home", trail: ["个人工作台"] }`
  - `/language` | `/language/english` | `/language/japanese` -> `{ id: "language", trail: ["语言学习", ...] }`
  - `/tools` | `/tools/workflows` | `/tools/:tool_id` -> `{ id: "tools", trail: ["工具箱", ...] }` (showing resolved tool display title when opened)
  - `/finance` -> `{ id: "finance", trail: ["财务账本"] }`
  - `/transfer` -> `{ id: "transfer", trail: ["文件传输"] }`
  - `/account` -> `{ id: "account", trail: ["账户与安全"] }`
  - `/recharge` -> `{ id: "recharge", trail: ["会员与充值"] }`
  - `/admin` -> `{ id: "admin", trail: ["管理后台", <activeAdminSection>] }`
- Returns `null` when unauthenticated or on public routes (`/login`, `/register`, `/trial`, `/download`, `/changelog`).
- `syncWorkspaceShell(doc, meta)` updates `document.body.dataset.workspaceRoute` and mutates `#workspaceBreadcrumb ol` **in place**, preserving existing `<li>` root/segment nodes and updating text + `aria-current="page"` only on trailing segments.

## 3. Navigation Lifecycle, History & Scroll Isolation
- **`refreshWorkspaceShell()` (`app.js`)**: Triggered by every screen transition (`showModulePicker`, `showDashboard`, `showLanguageWorkspace`, `showToolsPanel`, `showToolsRoute`, `showWorkflowsRoute`, `showFinancePage`, `showTransferPage`, `openAccountModal`, `openRechargePage`, `showAdminPanel`, `selectAdminTab`, `openPublicTool`, and `hidePrimaryScreens`).
- **DOM & Form Preservation**: Navigating between `#v3Sidebar` routes never destroys sibling route DOM containers or unmounts active forms; `#toolSearchInput`, finance filters, and feature-flag form inputs retain stable node identity.
- **Security & Auth Boundary**: `#v3SidebarAdminLink` stays `[hidden]` for non-admins; visiting `/admin` as a non-admin redirects cleanly to `/` and hides `#adminPanel`; switching accounts or logging out clears `data-workspace-route`, hides `#workspaceBreadcrumb`, and resets `#adminKpiStrip` (`resetAdminKpis()`).
- **Emergency CSS / P07 OFF Fallback**: When `spatial-experience.css` fails to load or `p07_accessibility` is disabled, `styles.css` + emergency rules hide `.workspace-breadcrumb`, `.admin-kpi-strip`, and `.admin-list-head` cleanly so `#accountBar` (`< 120px`), `#adminUsersTab`, and `/finance` remain unobstructed and interactive.
