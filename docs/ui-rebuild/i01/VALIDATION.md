# Aeris V6.3 — I01 Validation Ledger

## 1. Environment & Baseline Separation
- **Source Branch**: `hydrogen/i01-design-foundation-shell` (branched from verified `origin/main` `7c111ae4452d8eef493bca6fab71c613e380761c`)
- **Implementation Commit (Deployed to Hosted Preview)**: `35c54e4ce29d688eedc2a9565c4a1ba43aa7fbf0`
- **Production Untouched**: Zero deployments, migrations, or secret changes on `thewyj-uk` / `thewyj.uk` or Production D1/R2, Android Stable, or Task 28/29/30 previews.

## 2. Isolated Hosted Preview Verification (Live HTTPS)
- **Project**: `thewyj-p07-ui-rc` (isolated Preview D1 `ee869f78-b54a-4018-bc99-871089ecb8cd`, `r2_buckets`: none, `ai_bindings`: none, `WORKERS_AI_ENABLED=false`, `LEGACY_API_FALLBACK_ENABLED=false`, `production_branch: release-held`)
- **Deploy Input**: Allowlisted Git blobs only (`203` files staged via `scripts/stage_pages_deploy.mjs` -> `wrangler pages deploy --branch i01-design-foundation --commit-dirty=false`)
- **Branch Alias Preview URL**: https://i01-design-foundation.thewyj-p07-ui-rc.pages.dev
- **Immutable Deployment URL**: https://f74085a1.thewyj-p07-ui-rc.pages.dev
- **Live Chrome Verification** ([preview-verify.json](evidence/preview/preview-verify.json)):
  - `desktop-1440` Light & Dark (`/`): `p07="enabled"`, `previewHidden=false`, `sidebarVisible=true`, `overflowX=0`, `navHeight=61`, `cardsCount=3`, `runtimeErrors=[]`.
  - `mobile-390` Light & Dark (`/`): `p07="enabled"`, `previewHidden=false`, `sidebarVisible=false`, `overflowX=0`, `navHeight=108`, `cardsCount=3`, `runtimeErrors=[]`.
  - `/login` Dark rendered cleanly; screenshots captured in [evidence/preview/](evidence/preview/).

## 3. Local Build, Static, Unit, Contract & Browser Suites

| Suite / Command | Scope | Result |
|---|---|---|
| `python -m unittest local-backend/test_static.py` | Design System 2.0 & asset release static contracts (31 tests) | **PASS** (31/31) |
| `python -m unittest discover -s local-backend -p "test_*.py" -v` | Full local Python backend/static suite | **PASS** |
| `python scripts/repository_audit.py` | Repository structure & file hygiene audit (1,862 files incl. `docs/ui-rebuild/i01/`) | **PASS** |
| `python scripts/functional_audit_gate.py` | Routes (27), app flows (24), tools (104), workflows (27 flows) | **PASS** |
| `node scripts/check_js_module_graph.mjs` & `node local-backend/test_module_graph_js.mjs` | 67 ES modules, 110 imports, zero cycles | **PASS** |
| `node scripts/check_storage_contract.mjs` | 31 stable frontend storage key families | **PASS** |
| `node local-backend/test_motion_js.mjs` & `test_core_js.mjs` & `test_home_widgets_js.mjs` & `test_aeris_public_js.mjs` | Motion interruption, router/storage/API, home widgets, public preview | **PASS** |
| `node qa/p07-release/sw-install.test.mjs` & `publication-checks.mjs` | Service Worker 81-entry `CORE_SHELL` + Task26/Finance/Task27 integrity (20 tests) + changelog check | **PASS** (20/20) |
| `node qa/p07-release/sw-install-browser.mjs` | Chrome SW installation under normal/slow/failure/warm/stale-task26 conditions | **PASS** (7/7 cases) |
| `npm run cf:check` & deterministic `npm run build` × 2 | Worker bundle compilation & bit-identical 203 staged files | **PASS** |
| `npm run test:task25` & `npm run test:task26` & `npm run test:aeris-state` | Feature flags (12 + 19), Adaptive learning + Wrong-review, Finance/Notification state consistency (13 tests) | **PASS** |
| `npm run test:task27` / `test:task28` / `test:task29` / `test:task30` | Security Center (33 groups), Secure Files (31 checks), Encrypted Backup (7 checks), Privacy Erasure (10 checks) | **PASS** |
| `npm run test:task30:browser` / `test:task29:browser` / `test:task28:browser` | Real Chrome E2E on Privacy Center (4), Backup/Restore + axe (5), Secure Files + a11y (5) | **PASS** (all checks) |
| `qa/aeris/p33-shared-home-browser.mjs` | Public/Auth shared home parity & 50% zoom reflow (`8` guest + `8` auth + `4` restores) | **PASS** |
| `qa/aeris/home-widgets-browser.mjs` & `mobile-widgets-browser.mjs` | 3 floating cards desktop drag/bounds (`nav`/`reduced-motion`) & mobile (`27` bounds cases, orientation isolation) | **PASS** |
| `qa/p07-release/publication-browser.mjs` | Guest (`3`), workspace (`7`), and footer themes (`6`) live browser checks | **PASS** |
| `qa/p07-f/a11y-closeout.mjs` | 51 whole-document `axe-core` scans (0 violations), `>= 4.5:1` contrast, keyboard/tab-trap checks (7/8 PASS; `visual-typography-remains-equivalent` differs intentionally from frozen historical P07 `BASELINE-GEOMETRY.json` due to updated typography clamp & `180px` compact rail) | **51/51 axe PASS (0 violations)** |

*Note*: `npm run test:task27:browser` requires external `.wrangler/task27-reference/otpauth-lab/node_modules/jsqr` not present in the isolated worktree; server/API security suite (`npm run test:task27`) and `security-modal` light/dark captures passed.
