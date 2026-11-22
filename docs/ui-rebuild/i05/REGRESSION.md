# Cross-Stage Regression Report (`I05`)

All regression checks ran against the I05 codebase on branch `hydrogen/i05-workspace-admin-density`. Results are reported verbatim without masking failures or skipped tests. Original upstream evidence folders under `docs/ui-rebuild/i02`..`i07` were left untouched; raw regression observations from this run are archived under [`evidence/regression/`](./evidence/regression/).

## 1. Static, Unit & Build Suites
- `node --check app.js` + all `js/**/*.js`: **PASS**
- `local-backend/check_js_module_graph.mjs`: **PASS** (`67` files, `114` imports)
- `local-backend/check_storage_contract.mjs`: **PASS** (`31` key families)
- `local-backend/test_i02_css_contracts.mjs`: **PASS** (`6 / 6`)
- `local-backend/test_i03_public_pages.mjs`, `test_i04_workspace.mjs`, `test_i05_workspace_shell.mjs`: **PASS** (`17` tests in combined I02–I05 run)
- `local-backend/test_motion_js.mjs`, `test_core_js.mjs`, `test_home_widgets_js.mjs`: **PASS**
- `test_stage_pages_deploy.mjs`: **PASS** (`28 / 28`)
- `npm run test:task27`: **PASS** (`33 / 33`)
- `npm run test:task28`: **PASS** (`31 / 31`)
- `npm run test:task29`: **PASS** (`7 / 7`)
- `npm run test:task30`: **PASS** (`10 / 10`)
- `npm run cf:check` & `npm run build`: **PASS**

## 2. Browser Regression Suites (`qa/i02`, `qa/i03`, `qa/i04`, `qa/i07`)

| Suite | Outcome | Observed Details & Classification | Archived Evidence |
|---|---|---|---|
| `qa/i03/browser-acceptance.mjs` | **PASS** (exit `0`) | All `4` scenarios passed (`11` axe scans with `0` serious/critical violations, `4` viewports `overflowX === 0`, `21` screenshots). Confirms I03 public pages Hero/Bento/3D preview & P07 OFF remain intact. | [`evidence/regression/i03-acceptance-report.json`](./evidence/regression/i03-acceptance-report.json) |
| `qa/i04/browser-acceptance.mjs` | **PASS** (exit `0`) | All `11` scenarios passed (`7` axe scans `0` violations, `10` viewports, `0` console/page/API errors). Confirms I04 personal workspace drag, bidirectional FLIP, hide/restore, & storage isolation remain intact. | [`evidence/regression/i04-browser-acceptance.json`](./evidence/regression/i04-browser-acceptance.json) |
| `qa/i02/browser-acceptance.mjs` | **FAIL** (exit `1` at touch-target assertion) | Scenarios `1–6` passed (`theme-switch`, `buttons`, `forms`, `selection-controls`, `modal-focus-trap`, `routing-and-history-back`). Failed at `1440px light` touch-target assertion on `/` public homepage `#publicLearningReset`: measured height `43.323974609375px < 44px`. Root cause is pre-existing `.scroll-preview-wrap` transform (`scale(var(--ds-scroll-scale, 1))` ~`0.985` at `scrollY=0` introduced by I07/I03); public `/` & motion CSS were untouched by I05. | [`evidence/regression/i02-regression-observed.json`](./evidence/regression/i02-regression-observed.json) |
| `qa/i07/browser-acceptance.mjs` | **FAIL** (exit `1` at scenario `11`) | Scenarios `1–10` passed (`controls`, `tabs`, `flip`, `drag`, `keyed-table`, `toast`, `scroll-3d`, `modal-drawer`, `dark-telemetry`, `real-app-routes`). Scenario `11` timed out in `openFixture()` (`qa/i07/browser-acceptance.mjs:735`) due to known Service Worker (`sw.js`) navigation interception registered during scenario `10` on localhost without SW bypass. | [`evidence/regression/i07-regression-observed.json`](./evidence/regression/i07-regression-observed.json) |

## 3. Unverified / Pending Scopes
- **Android Physical Device**: `NOT_TESTED`
- **Production Release**: `NOT_TOUCHED`
- **Owner Visual Acceptance**: `PENDING`
