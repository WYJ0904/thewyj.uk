# Regression & Verification Ledger (Phase A I07 Remediation + Phase B I03)

All checks listed below were executed in the `aeris_i03_public_pages_redesign` worktree on branch `hydrogen/i03-public-pages-redesign`. Items outside UI/Preview scope or physical hardware remain explicitly marked `NOT_TESTED`.

## 1. Phase A & Shared Engine Unit / Contract Suites

| Check Command | Scope | Result |
|---|---|---|
| `node local-backend/test_i02_css_contracts.mjs` | CSS custom property resolution, Switch geometry/contrast, `!important` bounds, cascade order | **PASS** (`6 / 6`) |
| `node local-backend/test_i07_motion_engine.mjs` | Motion scope, control feedback, 120–150ms skeleton switcher + abort guard, A2 multi-stage scroll 3D, A4 shared arrow drag sort, A5 detached tablist pruning, A6 Toast error preemption/coalescing/dispose, A8 file drop callback | **PASS** (`14 / 14`) |
| `node local-backend/test_i03_public_pages.mjs` | Legacy hero card removal, 6 public surfaces, `createHomeWidgets` safe guard, router scroll state, download badge/SHA copy guard, local helpers | **PASS** (`5 / 5`) |
| `node local-backend/test_motion_js.mjs` | Legacy motion regression compatibility | **PASS** |
| `node local-backend/test_home_widgets_js.mjs` | Home widget storage isolation & v1->v2 migration math preserved for I04 | **PASS** |

## 2. Repository Integrity, PWA, Python & Backend Security Suites

| Check Command | Scope | Result |
|---|---|---|
| `npm run task27:publication` | Manifest & integrity hash (`c56b55391395cb8089ff679cbac2b310c29a0de664d48a656508adc688a5d622`, `20` integrity entries) | **PASS** |
| `python -m unittest local-backend/test_static.py` | Static asset, HTML, CSS, SW release token & route surface contracts | **PASS** (`31 / 31`) |
| `node qa/p07-release/sw-install.test.mjs` | Service Worker atomic install (`81` CORE_SHELL, `89` total), fail-closed rollback, release pinning | **PASS** (`20 / 20`) |
| `node scripts/check_js_module_graph.mjs` | ES module import graph (`67` files, `113` imports) | **PASS** |
| `node scripts/check_storage_contract.mjs` | Storage key family ownership (`31` families) | **PASS** |
| `python scripts/functional_audit_gate.py` | End-to-end static functional contract audit | **PASS** |
| `npm run cf:check` | Wrangler Pages config & Worker bundle validation | **PASS** |
| `python scripts/repository_audit.py` | Sensitive file / hygiene audit (`1983` files) | **PASS** |
| `python -m unittest discover -s local-backend -p "test_*.py" -q` | Local Python backend API, auth, sync, finance, admin unit tests | **PASS** (`186` tests, `82.020s`) |
| `npm run test:task25` | Feature flag & release channel server/client contracts (`12` D1 groups + `19` vectors) | **PASS** |
| `npm run test:task27` | Security center, policy consent, MFA, TOTP & email verification (`33` D1/API groups) | **PASS** (`33 / 33`) |
| `npm run test:task28` | Secure file sharing & R2/D1 boundary security | **PASS** (`31` checks) |
| `npm run test:task29` | Encrypted backup/restore & privacy export | **PASS** (`7 / 7`) |
| `npm run test:task30` | Privacy dashboard, erasure lifecycle & retention worker | **PASS** (`10 / 10`) |

## 3. Real Headless Chrome & Accessibility Suites

| Suite | Environment | Result |
|---|---|---|
| `node qa/i07/browser-acceptance.mjs` | Isolated Miniflare D1/R2 + Chrome CDP (`1440` / `375`, Light/Dark, `P07 OFF`) | **PASS** (`10 / 10` scenarios, `5` axe scans `0` violations, `22` screenshots, `maxSeamDriftPx = 0.42px`) |
| `node qa/i03/browser-acceptance.mjs` | Isolated Miniflare D1/R2 + Chrome CDP (`1440` / `768` / `390` / `375`, Light/Dark, `P07 OFF`) | **PASS** (`4 / 4` scenarios, `11` axe scans `0` violations, `21` screenshots) |
| `node local-backend/test_app_browser.mjs` | Isolated `local-backend/server.py` (`P07 OFF`) + Ollama stub + Chrome CDP | **PASS** (`24 / 24` checks, `0` runtimeErrors) |
| `qa/aeris/p3-brand-public-browser.mjs` | Local `wrangler pages dev` (`P07 ON`) + D1/R2 + Chrome (`390`/`1366`/`1920`, Light/Dark) | **PASS** (`CLS = 0`, `overflow = false`) |
| `qa/aeris/p31-home-browser.mjs` | Local `wrangler pages dev` (`P07 ON`) + Chrome (`320`/`390`/`1366`/`1920`, Light/Dark) | **PASS** (`8` cases, `0` overflow) |
| `qa/aeris/p32-card-restoration-browser.mjs` | Local `wrangler pages dev` (`P07 ON`) + Chrome | **PASS** (`8` cases, `5` bento tiles/case) |
| `qa/aeris/p33-shared-home-browser.mjs` | Local `wrangler pages dev` (`P07 ON`) + Chrome | **PASS** (`8` guest, `8` auth, `4` restores) |
| `qa/aeris/p6-experience-browser.mjs` | Local `wrangler pages dev` (`P07 ON`) + Chrome (`390`/`1366`/`1920`, `60` rapid routes) | **PASS** |
| `qa/aeris/home-widgets-browser.mjs` | Local `wrangler pages dev` (`P07 ON`) + Chrome | **PASS** (`i03CleanHome: true`, `layoutMathPreserved: true`) |
| `qa/aeris/mobile-widgets-browser.mjs` | Local `wrangler pages dev` (`P07 ON`) + Chrome (`360/390/412/430/844/1040` mobile viewports) | **PASS** (`6` viewports, `zeroOverflow: true`, `layoutMathPreserved: true`) |
| `node qa/i03/verify-preview.mjs` | Live Hosted Preview `https://i03-public-pages.thewyj-i03-preview.pages.dev` (`P07 ON`) + Chrome + axe | **PASS** (`6` routes, `6` axe scans `0` violations, `0` overflow, multi-stage 3D exit `-8deg`, Switch `0` overflow, mobile `375px` `0` overflow) |
| Hosted `P07 OFF` fallback script | Live Hosted Preview w/ `p07_accessibility = 0` on isolated D1 `ee869f78` (restored to `1` immediately after) | **PASS** (`data-p07-ui="disabled"`, `overflowX = 0`, `bentoCount = 5`, `0` runtime errors) |

## 4. Explicit `NOT_TESTED` Boundaries

- **Android physical device / ADB / Emulator**: `NOT_TESTED` (out of Web I03 + I07 UI scope; paused Android Hotfix branch remains untouched).
- **Production environment (`thewyj.uk` / Production D1 & R2)**: `NOT_TESTED` (strictly isolated per owner boundary rules).
- **Real external SMTP email / live WeChat & Alipay payment callbacks**: `NOT_TESTED` (synthesized fixtures only in automated test suites).
