# Aeris I06 — Module-Specific Experiences Implementation & Acceptance Report

- **Branch**: `hydrogen/i06-module-experience`
- **Stacked Base**: `hydrogen/i05-workspace-admin-density` (`3c2e8a829533d1a5625a3c59929846bd0c04c872`, PR #172)
- **Product & Core QA Commits**: `6592f0df8c21ae458a1aa5153595ffd138b14106`, `872a70b07cb6f9cec168f94d95a2d2063b83e43e` (`class="wrong-rejudge-button"` static contract fix), `2550b14a6edf8d27922a4212233229f0ebf1f1e1` (V01 quiz button height/scroll & compactness, V02 mobile flags fixed-column alignment & multi-row timeline, V03 mobile transfer above-the-fold density, and authorized preview verification)
- **Preview Scripts Commits**: `5a337a28989db29c7cf290d36d518d17cb60963f`, `3b6f261edfde05d4cf371503ef30ccc540794211`
- **Isolated Hosted Preview**: `https://55ee200c.thewyj-i06-preview.pages.dev` (Alias: `https://i06-module-experience.thewyj-i06-preview.pages.dev`, Project: `thewyj-i06-preview`, D1: `aeris-i06-preview` / `949eb48b-4662-4f63-98d8-043c7afc17b6`, `r2_buckets: []`, `ai_bindings: []`, `WORKERS_AI_ENABLED: "false"`)
- **Isolated Preview Accounts**: See [`PREVIEW_TEST_ACCOUNTS.md`](./PREVIEW_TEST_ACCOUNTS.md) (`i06admin` `super_admin` + `all_access_lifetime` + synthetic finance fixture; `i06user` `user` + `all_access_lifetime`; passwords stored exclusively out-of-band outside git).
- **Production Status**: `NOT_TOUCHED` (`WYJ_DB` `11c288d8-c584-409f-bb1f-7e7af11793e5`, Production R2, feature flags, accounts, and Stable pointers untouched)

---

## 1. Five Scoped I06 Module Upgrades & V01–V03 Remediation

1. **`/language` (Quiz Focus Canvas, Progress Bar & FSRS Wrong-Review Hairline List — V01 Closed)**
   - [`index.html`](../../../index.html), [`app.js`](../../../app.js), [`js/core/design-system.js`](../../../js/core/design-system.js), [`spatial-experience.css`](../../../spatial-experience.css):
     - Added optional `languageSection` in `workspaceRouteMeta()` and wired `refreshWorkspaceShell()` inside `setView()` so the top breadcrumb dynamically tracks the active language tab (`Aeris / 语言学习 / 英语 / 答题`).
     - Added top-edge live progress fill `#quizProgressFill` and `#quizReviewContext` inside `#quizView`, centering `#quizView` cleanly within `<= 760px` focus width.
     - **V01 Fix**: Scoped `flex: 0 0 auto; flex-basis: auto; width: 100%; min-height: 48px;` on `html[data-p07-ui="enabled"] body[data-workspace-route] #quizView .answer-form button` / `#submitBtn` (eliminating the inherited `flex: 0 0 104px` height on desktop column forms), tightened `.quiz-card` padding/gap (`18px 24px`, `gap: 12px`) and `.word-display` (`min-height: 84px`, `margin-block: 0`), and updated `setView("quizView")` + `showWord()` to reset `window.scrollTo(0, 0)` on entering `quizView` with `focus({ preventScroll: true })` so `.word-display` is never occluded behind the sticky header.
     - Upgraded `#wrongList` via `#wrongItemTemplate` into continuous hairline-divided rows (`borderLeftWidth: 0px`) with semantic `.wrong-review-pill` and `data-review-status` states.

2. **`/finance` (Borderless Hairline Ledger & Slide-Over Transaction Drawer)**
   - [`index.html`](../../../index.html), [`js/finance/app.js`](../../../js/finance/app.js), [`spatial-experience.css`](../../../spatial-experience.css):
     - Removed outer heavy card boxes around `#financeTransactionList` into a hairline-divided ledger while preserving `#financeIncomeTotal` `tabular-nums` alignment and existing disclosure controls.
     - Made clicking any `.finance-transaction .finance-transaction-main` row open `#financeTransactionModal` with drawer metadata (`#financeTransactionDrawerMeta`, direction/source/sync/revision pills) and direct `#financeTransactionDrawerDeleteBtn`.
     - Styled `#financeTransactionModal` as a full-height right-docked slide-over drawer at `>= 761px` (`width: 480px`, `height: 900px`, flushed to viewport edge) and a native bottom sheet at `<= 760px` (`390x844` dark verified), restoring focus to `#financeAddTransactionBtn` on close.

3. **`/tools` (Two-Pane Instant Search Index & Split Input/Output Workbench)**
   - [`index.html`](../../../index.html), [`tools.js`](../../../tools.js), [`spatial-experience.css`](../../../spatial-experience.css):
     - Structured `.tools-two-pane` with sticky `.tools-index-rail` (`#toolSearchInput` + vertical `#toolCategoryList`) alongside `.tools-index-main` (`#workflowLauncher` + `#toolCatalog`), preserving `#toolSearchInput` focus during instant typing.
     - Wrapped `renderTextTool()` in `.tool-split-pane` (`.tool-pane-input` / `.tool-pane-output`) and applied consistent primary / secondary / ghost button hierarchy + semantic `#toolWorkbenchMessage.error.success` status tinting without disturbing `/tools/:tool_id` or `/tools/workflows` routing.

4. **`/transfer` (Collapsible Transfer Parameters Disclosure, Live Progress Queue & V03 Mobile Density)**
   - [`index.html`](../../../index.html), [`js/transfer/app.js`](../../../js/transfer/app.js), [`spatial-experience.css`](../../../spatial-experience.css):
     - Placed sharing configuration inside `#transferConfigDisclosure` (collapsed by default with live summary `#transferConfigSummary`) above full-width `#transferDropZone`.
     - **V03 Convergence**: On `<= 760px`, kept `.transfer-header-actions` compact inline (`width: auto` instead of full-width stacked back button), tightened `#transferQuotaBar` and disclosure margins, and ordered `#transferDropZone` mobile layout so `#transferSelectFilesBtn` ("选择文件") and `#transferSelectFolderBtn` sit immediately below the drop title above the 812px fold while preserving all quota, format, and safety hint copy.
     - Added semantic `.transfer-item-state[data-status]` status pills and live `tabular-nums` `.transfer-item-percent` updates inside `patchQueueProgress()` while preserving Task 24/28 invariants.

5. **`/admin` Feature Flags (Flagsmith-Style Capsule Strip, Aligned Directory & Audit Timeline — V02 Closed)**
   - [`index.html`](../../../index.html), [`js/core/feature-console.js`](../../../js/core/feature-console.js), [`spatial-experience.css`](../../../spatial-experience.css):
     - Added `#featureFlagCapsuleStrip`, `#featureFlagSummaryList`, and `#featureFlagAuditTimeline` while preserving exact DOM node identity for `#featureFlagForm` and `#featureFlagEnabled` across saves (`sameForm: true`, `sameCb: true`, `removedCount: 0`), checkboxes strictly `<= 24px`, and intact `#featureFlagAudit.textContent` + Task 27 step-up enforcement.
     - **V02 Fix**: Converted `#featureFlagSummaryList` items to a fixed 3-column grid (`minmax(0, 1fr) 78px 64px` desktop; `minmax(0, 1fr) 74px 64px` mobile with `min-height: 45px`, `max-height: 224px` scrollable hairline list on `<= 760px`) so all flags stay reachable with `>= 44px` touch targets, long keys wrap inside column 1 without shifting rollout/status columns (`pillRightSpread <= 1px`), and `#featureFlagForm` remains immediately visible below the directory on 375/390px viewports.

---

## 2. Verification Matrix

### A. I06 Clean-HEAD Browser & Unit Acceptance (Commit `2550b14a6edf8d27922a4212233229f0ebf1f1e1`)

| Check | Result | Scope & Observed Details |
| :--- | :--- | :--- |
| `node qa/i06/browser-acceptance.mjs` | **PASS** (6/6) | Isolated Miniflare D1/R2 + Chrome `158.0.8127.36`; `worktreeDirty: false`, `sourceMatchesCommit: true`; `apiErrors: []`, `runtimeErrors: []`; 12 screenshots captured (1440/390/375 light & dark); `#submitBtn` `48px`; 375/390 flags `minHeight >= 44.8px`, `pillRightSpread <= 0.3px`; multi-row audit timeline (`>= 2` items); 375 `/transfer` `选择文件` above fold; 5 axe scans + `P07 OFF` clean fallback |
| `node --test local-backend/test_i06_module_experience.mjs` | **PASS** (2/2) | `workspaceRouteMeta` optional `languageSection`, I06 CSS layer `0` `!important`, V01 `flex-basis: auto` & V02 fixed-grid contracts, `P07 OFF` suppression, 12 HTML markers, SW shell counts (`81/89/89`) |
| `node --test local-backend/test_i02..i05` + module unit suites | **PASS** | All I02–I05 CSS/shell/workspace/module suites (`test_finance_js`, `test_finance_disclosure_js`, `test_tools_js`, `test_language_js`, `test_task26_feature_refresh`) passed |
| `python -m unittest local-backend/test_static.py` | **PASS** (31/31) | Static HTML/CSS/JS contracts including `class="wrong-rejudge-button"` |
| `node scripts/check_js_module_graph.mjs` & `check_storage_contract.mjs` | **PASS** | `67 files, 114 imports`, 0 cycles; `31` storage key families audited |
| `npm run task27:publication` | **PASS** | Publication hash `fa8391085180b3953433d1b9fad92c33ab9efb0f624ace3fd1387a34436e4efe`, 20 entries, `prior_core_shell_preserved: true` |
| `npm run test:task27` & `npm run test:task28` | **PASS** | `33/33` Task 27 isolated D1/API security groups; `31/31` Task 28 secure file / R2 / grant checks |
| `npm run build` & `npm run cf:check` | **PASS** | Staged `.wrangler/pages-output` & compiled Cloudflare Pages Worker cleanly |

### B. Isolated Hosted Preview Verification (`thewyj-i06-preview`, Commit `2550b14a6edf8d27922a4212233229f0ebf1f1e1`)

- **Deploy**: `node qa/i06/stage-preview.mjs --deploy` -> Deployment `55ee200c-0c6e-4e78-8bbe-101119c7a865` (`https://55ee200c.thewyj-i06-preview.pages.dev`), `file_count: 205`, `artifact_tree_sha256: da9a53f4b7b1582d5a62963b14135e9fcffd6e183f42cf7bc756b65adc16925b`.
- **`node qa/i06/verify-preview.mjs --source-only`**: **PASS** — `source_commit === HEAD`, `/api/status` `ok: true`, unauthenticated `/api/health` fail-closed `authentication_required`, `/api/ui/features` `public_ui.enabled: true`, and exact SHA-256 byte parity across all 8 verified assets.
- **`I06_PREVIEW_CREDS_FILE=... node qa/i06/verify-preview.mjs`**: **PASS** — Verified both unauthenticated/unpaid synthetic user (`i06p_mwrdb3v0`: fail-closed `/tools` -> `/recharge`, 375px `/transfer` `selectFilesBottom: 731.08 <= 812`, `overflow: 0`, `/trial`) AND authorized `i06admin` (`super_admin` + `all_access_lifetime` + synthetic finance fixture):
  - `/language` quiz (`1440` light/dark, `390` light, `375` dark): `scrollY: 0`, `wordTop >= navBottom - 1`, `submitHeight: 48`, `submitBottom <= vh`, `overflow <= 0`.
  - `/finance`: 1440 hairline ledger & slide-over drawer + 390 dark bottom sheet.
  - `/tools`: 1440 two-pane search & split workbench (`hello aeris` -> `HELLO AERIS`).
  - `/admin` Feature Flags: created & updated long-key flag `i06_hosted_align_buui` with Task 27 step-up -> `>= 2` audit timeline rows visible at 1440px; 390px dark & 375px light directory `minHeight: 44.80px`, `pillRightSpread: 0.74px`, `listHeight: 224px`, `formTop: 484.84px`, `overflow: 0`.
  - `7/7` `axe-core` scans with `0` serious/critical violations and `0` runtime errors.

---

## 3. Evidence Artifacts

- **Local Clean-HEAD Screenshots & Report**: [`evidence/i06-acceptance-report.json`](evidence/i06-acceptance-report.json)
  - `1440-i06-language-quiz-light.png`, `390-i06-language-quiz-light.png`, `375-i06-language-quiz-dark.png`
  - `1440-i06-finance-drawer-light.png`, `390-i06-finance-sheet-dark.png`
  - `1440-i06-tools-twopane-light.png`, `1440-i06-tools-workbench-light.png`
  - `1440-i06-transfer-light.png`, `375-i06-transfer-light.png`
  - `1440-i06-admin-flags-timeline-light.png`, `390-i06-admin-flags-dark.png`, `375-i06-admin-flags-light.png`
- **Hosted Preview Evidence**:
  - [`evidence/i06-preview-stage.json`](evidence/i06-preview-stage.json)
  - [`evidence/hosted/i06-preview-source-check.json`](evidence/hosted/i06-preview-source-check.json)
  - [`evidence/hosted/i06-preview-verification.json`](evidence/hosted/i06-preview-verification.json)
  - [`evidence/hosted/hosted-i06-guest-light.png`](evidence/hosted/hosted-i06-guest-light.png), [`evidence/hosted/hosted-i06-guest-dark.png`](evidence/hosted/hosted-i06-guest-dark.png), [`evidence/hosted/hosted-i06-recharge.png`](evidence/hosted/hosted-i06-recharge.png), [`evidence/hosted/hosted-i06-transfer.png`](evidence/hosted/hosted-i06-transfer.png), [`evidence/hosted/hosted-i06-transfer-375.png`](evidence/hosted/hosted-i06-transfer-375.png), [`evidence/hosted/hosted-i06-language-quiz-1440.png`](evidence/hosted/hosted-i06-language-quiz-1440.png), [`evidence/hosted/hosted-i06-language-quiz-390.png`](evidence/hosted/hosted-i06-language-quiz-390.png), [`evidence/hosted/hosted-i06-language-quiz-375-dark.png`](evidence/hosted/hosted-i06-language-quiz-375-dark.png), [`evidence/hosted/hosted-i06-finance-drawer-1440.png`](evidence/hosted/hosted-i06-finance-drawer-1440.png), [`evidence/hosted/hosted-i06-finance-sheet-390-dark.png`](evidence/hosted/hosted-i06-finance-sheet-390-dark.png), [`evidence/hosted/hosted-i06-tools-twopane-1440.png`](evidence/hosted/hosted-i06-tools-twopane-1440.png), [`evidence/hosted/hosted-i06-tools-workbench-1440.png`](evidence/hosted/hosted-i06-tools-workbench-1440.png), [`evidence/hosted/hosted-i06-admin-flags-timeline-1440.png`](evidence/hosted/hosted-i06-admin-flags-timeline-1440.png), [`evidence/hosted/hosted-i06-admin-flags-390-dark.png`](evidence/hosted/hosted-i06-admin-flags-390-dark.png), [`evidence/hosted/hosted-i06-admin-flags-375-light.png`](evidence/hosted/hosted-i06-admin-flags-375-light.png)

---

## 4. Non-Tested / Scope Boundaries

- **Android Physical Device (`Android真机`) / Soft Keyboard / Live R2 Upload**: `NOT_TESTED` (Web/desktop & responsive emulation only; isolated Preview has `r2_buckets: []` and `WORKERS_AI_ENABLED: "false"`).
- **Production & PR Merge**: Production D1/R2, flags, Stable pointers, and release secrets were untouched; Draft PR #174 remains unmerged for owner review.
- **Deferred Beyond I06**: Global custom switch/checkbox styling, vector icon pass, and global route scroll governance remain scoped to **I08**; `#versionNotice` toast repositioning remains scoped to **I09**.
