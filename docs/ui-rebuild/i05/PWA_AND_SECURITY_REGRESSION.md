# PWA, Cache & Security Regression Report (`I05`)

## 1. Service Worker & Release Integrity
- **Asset Release Version**: Updated cleanly to `20261121-aeris-i05-preview` across `index.html`, `sw.js`, `app.js`, `tools.js`, and `js/**/*.js`.
- **Shell Count Lock**: Verified by `local-backend/test_i05_workspace_shell.mjs` via VM evaluation of `sw.js`:
  - `CORE_SHELL.length === 81` (unchanged)
  - `REQUIRED_SHELL.length === 89` (unchanged)
  - `INSTALL_SHELL.length === 89` (unchanged)
- **Publication & Integrity Manifest**: Regenerated (`publication_hash: 3b1eca2919cb12d31cb53d60326dbb68b830d010064e72882e870659289aa353`, `integrity_entries: 20`).
- **Deploy Staging Security Suite**: `test_stage_pages_deploy.mjs` passed `28 / 28`, confirming allowlisted staging exclusions (never bundling local configs/secrets/`访问口令.txt`/`_wyj-tools/`).

## 2. CSS Failure & P07 Policy Degradation
- **P07 OFF (`k_p07_off_fallback` + Live Preview `p07ToggleChecks`)**:
  - When `p07_accessibility.enabled = 0`, HTML enters `data-p07-ui="disabled"`.
  - `#v3Sidebar`, `#workspaceBreadcrumb`, and `#adminKpiStrip` resolve to `display: none` while `#adminUserList` remains functional and `#accountBar [data-site-nav='finance']` continues routing to `/finance`.
  - Live Preview confirmed toggling `p07_accessibility` OFF and restoring ON (`restoredOn: true`) cleanly restores desktop shell chrome.
- **Stylesheet 404 Emergency Fallback (`l_css_failure_fallback`)**:
  - Intercepting `spatial-experience.css` with HTTP `404` keeps `#accountBar` emergency bar height bounded (`103.39px < 120px`) and `#adminUsersTab` unobstructed and clickable (`elementFromPoint` hit-test `ok: true`, `44px` height).

## 3. Core Security & Auth Suite Parity
- `npm run test:task27`: `33 / 33` **PASS** (security center, TOTP/password step-up, mail center)
- `npm run test:task28`: `31 / 31` **PASS** (D1/R2 encrypted transfer layer)
- `npm run test:task29`: `7 / 7` **PASS** (structured export, encrypted backup/restore)
- `npm run test:task30`: `10 / 10` **PASS** (privacy center, erasure requests)
- `npm run cf:check` + `npm run build`: **PASS** (Worker compilation & `.wrangler/pages-output`)
