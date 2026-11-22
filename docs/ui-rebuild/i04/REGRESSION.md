# I04 Regression Verification Summary

All local checks below ran directly against `hydrogen/i04-authenticated-workspace-redesign` (`ASSET_RELEASE = "20261120-aeris-i04-preview"`):

| Domain / Suite | Command Executed | Scope & Observed Result |
|---|---|---|
| Publication Integrity & SW Shell | `npm run task27:publication` + `node qa/p07-release/sw-install.test.mjs` | **PASS**: `20/20` SW install/rollback tests, `CORE_SHELL = 81`, `REQUIRED_SHELL = 89`, `prior_core_shell_preserved: true` |
| Static & Repository Contracts | `python -m unittest local-backend/test_static.py -v` + `python scripts/repository_audit.py` | **PASS**: `31/31` unit checks, `2019` repository files checked |
| JS Graph & Storage Contract | `node scripts/check_js_module_graph.mjs` + `node scripts/check_storage_contract.mjs` | **PASS**: `67` files / `114` imports (acyclic, core isolated); `31` stable key families audited |
| Cloudflare Pages Build & Staging | `npm run cf:check` + `node scripts/test_stage_pages_deploy.mjs` | **PASS**: Compiled Pages Functions successfully; `28/28` allowlist/credential staging tests |
| I04 Layout & Data Unit Suite | `node --test local-backend/test_i04_workspace.mjs` | **PASS**: `3/3` suites (schema sanitization, reducers across hidden slots, account isolation & honest projection states) |
| I02 / I03 / I07 / Home Widgets / Task25 Unit | `node --test local-backend/test_home_widgets_js.mjs local-backend/test_i02_css_contracts.mjs local-backend/test_i03_public_pages.mjs local-backend/test_i07_motion_engine.mjs local-backend/test_task25_client_js.mjs` | **PASS**: `30/30` tests across all CSS/motion/widget/public/feature-flag unit suites |
| Task 25 + Aeris Home Browser | `qa/task25/feature-flags-browser.mjs` + `qa/task25/remote-admin-ui-smoke.mjs` + `qa/aeris/home-widgets-browser.mjs` + `qa/aeris/mobile-widgets-browser.mjs` + `qa/aeris/p33-shared-home-browser.mjs` (against `wrangler pages dev` + Chrome) | **PASS**: Task 25 `390/1366px` & `9/9` admin smoke checks (`console_screenshot_unobstructed: true`), `home-widgets`, `mobile-widgets` (`6` viewports), `p33-shared-home` (`8` guest + `8` auth + `4` restores) |
| Security & Integration Suites (Tasks 25, 27–30) | `local-backend/test_task27_js.mjs` + `test_task25_d1_js.mjs` + `test_aeris_state_consistency.mjs` + `qa/task28/secure-files.mjs` + `qa/task29/backup-restore.mjs` + `qa/task30/privacy-erasure.mjs` | **PASS**: Task 27 `33/33`, Task 25 D1 `11/11`, Task 28 `31/31`, Task 29 `7/7`, Task 30 `10/10`, Aeris P5/Public/Core/State Consistency all green |
| I03 Full Public Browser Regression | `node qa/i03/browser-acceptance.mjs` | **PASS**: `4/4` scenarios, `11` axe scans, `21` screenshots, `4` viewports |
| I07 Browser Acceptance Regression | `node qa/i07/browser-acceptance.mjs` | **PASS (Scenarios 1–10)**: All `9` shared-engine scenarios + `real-app-routes-modal-tabs-p07off` passed. Scenario 11 (`openFixture()` after Scenario 10 SW install) timed out on local fixture `/__preview/i07-fixture.html` intercepted by `/sw.js` (`sw.js:285`) — documented transparently in `RISKS_AND_ROLLBACK.md` |
| Android Physical Device | Not executed | **`NOT_TESTED`** (only CI/unit/lint/APK metadata tested) |
