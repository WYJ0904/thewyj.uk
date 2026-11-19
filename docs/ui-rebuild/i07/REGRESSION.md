# I07 Regression & Gate Verification Report

## 1. Local Automated Regression Ledger (Executed Post-Final Code Edits)

| Suite / Command | Scope | Result | Observed Output |
| :--- | :--- | :---: | :--- |
| `node --test local-backend/test_i02_css_contracts.mjs` | CSS tokens, V1.1 contracts, `!important` bounds, cascade order | **PASS** | `6/6` passed (`0` failures) |
| `node local-backend/test_motion_js.mjs` | Legacy motion API compatibility, cancellation, Reduced Motion | **PASS** | `PASS` |
| `node --test local-backend/test_i07_motion_engine.mjs` | Motion tokens, FLIP, drag, toast, sheet, scroll 3D, keyed rows | **PASS** | `8/8` passed (`0` failures) |
| `node scripts/check_js_module_graph.mjs` & `test_module_graph_js.mjs` | ES module dependency direction & cycle check | **PASS** | `72` files, `120` imports, `0` cycles; `5/5` self-tests |
| `node scripts/check_storage_contract.mjs` | Frontend local/session storage key registry | **PASS** | `31` stable key families audited |
| `npm run task27:publication` & `node qa/p07-release/sw-install.test.mjs` | SW RC5 shell preservation + Task27 atomic publication manifest | **PASS** | `20/20` passed (`integrity_entries: 20`, `prior_core_shell_preserved: true`) |
| `python scripts/repository_audit.py` | Repo cleanliness & secret/allowlist audit | **PASS** | `1937` tracked and candidate files checked |
| `python scripts/functional_audit_gate.py` | Routes, app flows, tools & workflow gate | **PASS** | `27` routes, `24` app flows, `104` tools, `51` tool modes |
| `python -m unittest local-backend/test_static.py` | Keyframes (`no opacity`), `button:disabled`, SW release pins | **PASS** | `31/31` passed |
| `python -m unittest discover -s local-backend -p "test_*.py"` | Full Python local-backend test discovery | **PASS** | `186/186` tests passed in `81.630s` |
| `node local-backend/test_interaction_feedback_js.mjs` | Task 24 async interaction feedback contract | **PASS** | `PASS` |
| `npm run test:task25` | Feature flags D1/API + shared contracts | **PASS** | `12` D1/API groups + `19` shared vectors |
| `npm run test:task26` | Adaptive learning engine, D1, durable outbox & wrong review | **PASS** | All checks `PASS` |
| `npm run test:task27` | Security center D1/API & policy versions | **PASS** | `33/33` isolated D1/API groups passed |
| `npm run test:task28` & `npm run test:task28:browser` | Secure files D1/R2 + Chrome transfer UI (Light/Dark/`375px`/axe) | **PASS** | Unit `31` checks + Browser `5/5` (`0` skipped) |
| `npm run test:task29` & `npm run test:task29:browser` | Backup/Restore crypto/D1 + Chrome viewports (`1440/768/390/375`/axe) | **PASS** | Unit `7` checks + Browser `5/5` |
| `npm run test:task30` & `npm run test:task30:browser` | Privacy & erasure D1/R2 + Chrome responsive checks (`1440/768/390/375`) | **PASS** | Unit `10` checks + Browser `4/4` |
| `npm run test:aeris-state` | State consistency & finance/notification ledgers | **PASS** | `13/13` + candidates + notification ledger `PASS` |
| `npm run cf:check` | Wrangler Pages Functions compilation | **PASS** | `Compiled Worker successfully` |
| Double `node scripts/stage_pages_deploy.mjs` & `test_stage_pages_deploy.mjs` | Staging allowlist safety + bit-for-bit deterministic build | **PASS** | `28/28` tests + identical SHA-256 `52037351c4da83ee0ac7aa2ef337e15319cbded657c2648c579e0788800305cf` |
| `node qa/i07/browser-acceptance.mjs` | I07 10-scenario Fixture + Live App Chrome acceptance + `axe-core` | **PASS** | `10/10` scenarios, `5/5` axe scans (`0` violations), `20` screenshots, `maxSeamDriftPx: 0.45px` (Scenario 7 & live Preview `0px`), `0` runtime/5xx errors |
| `node qa/i07/verify-preview.mjs` | Live Hosted Preview real Chrome verification (`/` & `/__preview/i07-fixture.html`) | **PASS** | `0` failed requests, `0` runtime errors, bidirectional FLIP (`matrix(1,0,0,1,-186.76,0)` / `matrix(1,0,0,1,-186.903,63.6821)`), `maxSeamDrift: 0`, `5` preview screenshots |
| `local-backend/test_app_browser.mjs` | Core CI Python-backend full app Chrome harness (`WYJ_TEST_ADMIN_SECRET` + port `8892`/`9223`) | **CI_MANAGED** | Executed on PR push in GitHub Actions `Core CI` |

## 2. Hosted Preview & Core CI Status

- **Hosted Preview (`thewyj-p07-ui-rc`)**: **PASS** (`https://i07-motion-engine.thewyj-p07-ui-rc.pages.dev` / immutable `https://ce253791.thewyj-p07-ui-rc.pages.dev`, `deploymentId: ce253791-be18-4beb-9767-2c089fdd9ebb`, source commit `e1e5057d13668c8a9434da2cd9e7cc0acf80ddf8`; note `thewyj-p07-ui-rc` project preview D1 inherited non-Production `a3e6253b-689f-49f3-998b-7c5828ea255a` from I02 without modifying Cloudflare project bindings, and Hosted Preview verification stayed strictly read-only GET).
- **Draft PR & Core CI**: Stacked Draft PR against `hydrogen/i02-css-component-foundation` triggered on push; job statuses audited explicitly below after completion (skipped optional jobs recorded as `SKIPPED`, never `PASS`).

## 3. Non-Web Targets

- **Android Physical Device**: `NOT_TESTED — NOT REQUIRED FOR I07 WEB ACCEPTANCE`
- **Production Deployment / D1 / R2**: `NOT_TOUCHED`
