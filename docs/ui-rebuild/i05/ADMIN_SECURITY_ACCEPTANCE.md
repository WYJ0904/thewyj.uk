# Admin & Security Boundary Acceptance (`I05`)

## 1. Real Data Hydration vs Synthetic Fallback
- **Zero Hardcoded Counters**: `#adminKpiStrip` initializes to placeholder glyphs until `loadAdminUsers()`, `loadAdminRechargeRequests()`, `loadAdminSecurityLogs()`, and `loadAdminLoginEvents()` resolve from `/api/admin/*`.
- **Verified KPI Accuracy**:
  - Local Miniflare (`i05-acceptance-report.json`): `#adminKpiUsers` rendered `"2"` matching `/api/admin/users?limit=1` JSON `total: 2`.
  - Hosted Preview (`i05-preview-verify.json`): `#adminKpiUsers` rendered `"2"` matching isolated D1 `aeris-i05-preview` user count (`i05admin` + `i05user`).
- **Role Banner**: `#adminRoleContext` reflects server-verified `isSuperAdmin()` (`站点所有者` vs `管理员`) and resets via `resetAdminKpis()` when leaving admin or signing out.

## 2. DOM Identity Preservation & Step-Up Enforcement
- **No Full-Table Destruction**: Observed via `MutationObserver` on `#adminFeatureFlagsView` during live Feature Flag creation + Task 27 password step-up save (`g_admin_kpis_flags_dom_identity_and_offline`):
  - `sameForm: true` (`#featureFlagForm` node preserved)
  - `sameCb: true` (`#featureFlagEnabled` node preserved)
  - `removedCount: 0` (zero node destruction during save)
  - `auditHasKey: true` (newly created `i05_fixture_qcu9y4` appeared in `#featureFlagAudit`)
- **Checkbox Bounds**: Both `#featureFlagEnabled` and `#featureFlagKillSwitch` measured `[20, 20]` px (`<= 24px` guard enforced by assertion).
- **Failure Honesty**: Injecting HTTP `503` on `/api/admin/feature-flags` kept `#featureConsoleStatus` at `"正在保存…"`/error text and **never** rendered `"设置已保存"`.

## 3. Non-Admin & Backend Authorization Isolation
Verified in separate browser contexts both locally (`h_non_admin_isolation`) and against live Cloudflare Pages Preview (`nonAdminIsolation`):
- `#v3SidebarAdminLink` stays `hidden === true` for normal user accounts.
- Direct `GET /api/admin/users` with a non-admin session returns HTTP **`403`**.
- Direct client navigation to `/admin` redirects immediately to `/` while keeping `#adminPanel` hidden (`hidden` class preserved).
- Production backend RBAC (`requireAdmin` / `requireSuperAdmin` in `functions/_lib/`) was untouched.
