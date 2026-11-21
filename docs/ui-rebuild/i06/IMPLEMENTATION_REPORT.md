# Aeris I06 — Module-Specific Experiences Implementation & Acceptance Report

- **Branch**: `hydrogen/i06-module-experience`
- **Stacked Base**: `hydrogen/i05-workspace-admin-density` (`3c2e8a829533d1a5625a3c59929846bd0c04c872`, PR #172)
- **Product & Core QA Commit**: `6592f0df8c21ae458a1aa5153595ffd138b14106`
- **Preview Scripts Commits**: `5a337a28989db29c7cf290d36d518d17cb60963f`, `3b6f261edfde05d4cf371503ef30ccc540794211`
- **Isolated Hosted Preview**: `https://ff39eb68.thewyj-i06-preview.pages.dev` (Alias: `https://i06-module-experience.thewyj-i06-preview.pages.dev`, Project: `thewyj-i06-preview`, D1: `aeris-i06-preview` / `949eb48b-4662-4f63-98d8-043c7afc17b6`, `r2_buckets: []`, `ai_bindings: []`, `WORKERS_AI_ENABLED: "false"`)
- **Production Status**: `NOT_TOUCHED` (`WYJ_DB` `11c288d8-c584-409f-bb1f-7e7af11793e5`, Production R2, feature flags, accounts, and Stable pointers untouched)

---

## 1. Five Scoped I06 Module Upgrades

1. **`/language` (Quiz Focus Canvas, Progress Bar & FSRS Wrong-Review Hairline List)**
   - [`index.html`](../../../index.html), [`app.js`](../../../app.js), [`js/core/design-system.js`](../../../js/core/design-system.js), [`spatial-experience.css`](../../../spatial-experience.css):
     - Added optional `languageSection` in `workspaceRouteMeta()` and wired `refreshWorkspaceShell()` inside `setView()` so the top breadcrumb dynamically tracks the active language tab (e.g., `Aeris / 语言学习 / 英语 / 答题`).
     - Added top-edge live progress fill `#quizProgressFill` and `#quizReviewContext` inside `#quizView`, centering `#quizView` cleanly within `<= 760px` focus width (`760px` measured at 1440px).
     - Upgraded `#wrongList` via `#wrongItemTemplate` into continuous hairline-divided rows (`borderLeftWidth: 0px`) with semantic `.wrong-review-pill` and `data-review-status` states (`scheduled`, etc.).

2. **`/finance` (Borderless Hairline Ledger & Slide-Over Transaction Drawer)**
   - [`index.html`](../../../index.html), [`js/finance/app.js`](../../../js/finance/app.js), [`spatial-experience.css`](../../../spatial-experience.css):
     - Removed outer heavy card boxes around `#financeTransactionList` into a hairline-divided ledger while preserving `#financeIncomeTotal` `tabular-nums` alignment and existing disclosure controls.
     - Made clicking any `.finance-transaction .finance-transaction-main` row open `#financeTransactionModal` with drawer metadata (`#financeTransactionDrawerMeta`, direction/source/sync/revision pills) and direct `#financeTransactionDrawerDeleteBtn`.
     - Styled `#financeTransactionModal` as a full-height right-docked slide-over drawer at `>= 761px` (`width: 480px`, `height: 900px`, flushed to viewport edge) and a native bottom sheet at `<= 760px` (`390x844` dark verified), restoring focus to `#financeAddTransactionBtn` on close.

3. **`/tools` (Two-Pane Instant Search Index & Split Input/Output Workbench)**
   - [`index.html`](../../../index.html), [`tools.js`](../../../tools.js), [`spatial-experience.css`](../../../spatial-experience.css):
     - Structured `.tools-two-pane` with sticky `.tools-index-rail` (`#toolSearchInput` + vertical `#toolCategoryList`) alongside `.tools-index-main` (`#workflowLauncher` + `#toolCatalog`), preserving `#toolSearchInput` focus during instant typing (`railRight: 504`, `mainLeft: 528`).
     - Wrapped `renderTextTool()` in `.tool-split-pane` (`.tool-pane-input` / `.tool-pane-output`, `inRight: 806.5`, `outLeft: 826.5` on 1440px) and applied consistent primary / secondary / ghost button hierarchy + semantic `#toolWorkbenchMessage.error.success` status tinting without disturbing `/tools/:tool_id` or `/tools/workflows` routing.

4. **`/transfer` (Collapsible Transfer Parameters Disclosure & Live Progress Queue)**
   - [`index.html`](../../../index.html), [`js/transfer/app.js`](../../../js/transfer/app.js), [`spatial-experience.css`](../../../spatial-experience.css):
     - Placed sharing configuration inside `#transferConfigDisclosure` (collapsed by default with live summary `#transferConfigSummary`, updating `1 天 · 最多 5 次` -> `3 天 · 最多 5 次` cleanly on change) above full-width `#transferDropZone`.
     - Added semantic `.transfer-item-state[data-status]` status pills and live `tabular-nums` `.transfer-item-percent` updates inside `patchQueueProgress()` while preserving Task 24/28 multipart upload, hash verification, and ownership invariants.

5. **`/admin` Feature Flags (Flagsmith-Style Capsule Strip, Summary List & Audit Timeline)**
   - [`index.html`](../../../index.html), [`js/core/feature-console.js`](../../../js/core/feature-console.js), [`spatial-experience.css`](../../../spatial-experience.css):
     - Added `#featureFlagCapsuleStrip` (`all`, `on`, `partial`, `off`, `kill`, `new` interactive capsules), structured `#featureFlagSummaryList` pills, and structured `#featureFlagAuditTimeline` while preserving exact DOM node identity for `#featureFlagForm` and `#featureFlagEnabled` across saves (`sameForm: true`, `sameCb: true`, `removedCount: 0`), checkboxes strictly `<= 24px` (`20x20`), and intact `#featureFlagAudit.textContent` + Task 27 step-up enforcement.
     - Fixed timeline `.feature-audit-dot` left margin (`margin: 12px 0 0 6px`) so timeline nodes render unclipped at all widths.

---

## 2. Verification Matrix

### A. I06 Clean-HEAD Browser & Unit Acceptance (Commit `6592f0df8c21ae458a1aa5153595ffd138b14106`)

| Check | Result | Scope & Observed Details |
| :--- | :--- | :--- |
| `node qa/i06/browser-acceptance.mjs` | **PASS** (6/6) | Isolated Miniflare D1/R2 + Chrome `158.0.8127.36`; `worktreeDirty: false`, `sourceMatchesCommit: true`; `apiErrors: []`, `runtimeErrors: []`; 8 screenshots captured; 5 axe scans (`/language` 41 passes, `/finance` 47, `/tools` 46, `/transfer` 47, `/admin` 50 -> **0 serious/critical violations**) + `P07 OFF` clean fallback |
| `node --test local-backend/test_i06_module_experience.mjs` | **PASS** (2/2) | `workspaceRouteMeta` optional `languageSection`, I06 CSS layer `0` `!important`, `P07 OFF` suppression, 12 HTML markers, SW shell counts (`81/89/89`) |
| `node scripts/check_js_module_graph.mjs` | **PASS** | `67 files, 114 imports`, 0 cycles or reversed core dependencies |
| `npm run task27:publication` | **PASS** | Publication hash `8e7d20d25345dc9bc9fe253b142f9485d2757ba90bb6d6a143bae99db67f5ef8`, 20 entries, `prior_core_shell_preserved: true` |
| `npm run build` & `npm run cf:check` | **PASS** | Staged `.wrangler/pages-output` & compiled Cloudflare Pages Worker cleanly |

### B. Regression & Security Suites (Post Final Code Edit)

| Suite | Result | Observed Count / Notes |
| :--- | :--- | :--- |
| `qa/i05/browser-acceptance.mjs` | **PASS** | `13/13` scenarios, `90` viewport/theme cells, `22` screenshots |
| `qa/i04/browser-acceptance.mjs` | **PASS** | `11/11` scenarios, `10` viewports, `7` axeScans (`docs/ui-rebuild/i04` restored) |
| `qa/i03/browser-acceptance.mjs` | **PASS** | `4/4` scenarios, `4` viewports, `11` axeScans, `21` screenshots (`docs/ui-rebuild/i03` restored) |
| `local-backend/test_i02..i05` + module unit suites (`test_finance_js`, `test_finance_disclosure_js`, `test_tools_js`, `test_language_js`, `test_task26_feature_refresh`) | **PASS** | `37/37` tests passed across 11 files |
| `npm run test:task27` | **PASS** | `33/33` isolated D1/API security groups passed |
| `npm run test:task28` | **PASS** | `31/31` secure file / R2 / grant checks passed |
| `local-backend/test_transfer_*` | **4/5 PASS** | `test_transfer_integrity_js`, `test_transfer_isolation_js`, `test_transfer_session_plan_js`, `test_transfer_updates_js` PASS; `test_transfer_responsive.mjs` requires a pre-started external Python backend (`fetch failed`, standalone harness untouched; responsive `/transfer` at `1440` & `390` verified directly in `qa/i05` + `qa/i06`) |

### C. Isolated Hosted Preview Verification (`thewyj-i06-preview`)

- **Provision**: `node qa/i06/provision-preview.mjs` -> D1 `aeris-i06-preview` (`949eb48b-4662-4f63-98d8-043c7afc17b6`), `r2_buckets: []`, `ai_bindings: []`, `p07_accessibility=1` seeded.
- **Deploy**: `node qa/i06/stage-preview.mjs --deploy` -> Deployment `ff39eb68-361d-481a-91dc-0c859bfc15c1`, `file_count: 205`, `artifact_tree_sha256: 9545e9e479ed154e6a3629d64aa2d09516a9e01cdb72cf4efaad49ca0d47dc69`.
- **`node qa/i06/verify-preview.mjs --source-only`**: **PASS** — `/api/status` `ok: true`, unauthenticated `/api/health` fail-closed `authentication_required`, `/api/ui/features` `public_ui.enabled: true`, and exact SHA-256 byte parity across all 8 verified assets (`design-system.css`, `spatial-experience.css`, `app.js`, `tools.js`, `js/core/design-system.js`, `js/core/feature-console.js`, `js/finance/app.js`, `js/transfer/app.js`).
- **`node qa/i06/verify-preview.mjs`**: **PASS** — Dark-mode `.owner-preview-banner` locked (`strongColor: "rgb(67, 20, 7)"`, `bg: "rgb(255, 247, 237)"`), ephemeral synthetic registration `i06p_mwqssprc`, fail-closed unpaid `/tools` -> `/recharge` gate, `/transfer` collapsible config expansion, `/trial` reachability, and `4/4` axe scans with `0` serious/critical violations and `0` runtime errors.

---

## 3. Evidence Artifacts

- **Local Clean-HEAD Screenshots & Report**: [`evidence/i06-acceptance-report.json`](evidence/i06-acceptance-report.json)
  - `1440-i06-language-quiz-light.png`
  - `1440-i06-finance-drawer-light.png` & `390-i06-finance-sheet-dark.png`
  - `1440-i06-tools-twopane-light.png` & `1440-i06-tools-workbench-light.png`
  - `1440-i06-transfer-light.png`
  - `1440-i06-admin-flags-timeline-light.png` & `390-i06-admin-flags-dark.png`
- **Hosted Preview Evidence**:
  - [`evidence/i06-preview-provision.json`](evidence/i06-preview-provision.json)
  - [`evidence/i06-preview-stage.json`](evidence/i06-preview-stage.json)
  - [`evidence/hosted/i06-preview-source-check.json`](evidence/hosted/i06-preview-source-check.json)
  - [`evidence/hosted/i06-preview-verification.json`](evidence/hosted/i06-preview-verification.json)
  - [`evidence/hosted/hosted-i06-guest-light.png`](evidence/hosted/hosted-i06-guest-light.png), [`evidence/hosted/hosted-i06-guest-dark.png`](evidence/hosted/hosted-i06-guest-dark.png), [`evidence/hosted/hosted-i06-recharge.png`](evidence/hosted/hosted-i06-recharge.png), [`evidence/hosted/hosted-i06-transfer.png`](evidence/hosted/hosted-i06-transfer.png)

---

## 4. Non-Tested / Scope Boundaries

- **Android Physical Device (`Android真机`)**: `NOT_TESTED` (Web/desktop & responsive emulation only).
- **Production & PR Merge**: Production D1/R2, flags, Stable pointers, and release secrets were untouched; Draft PR left unmerged for owner review.
- **Tasks 53–61 / Historical Regressions**: Out-of-scope backend/AI tasks remain cleanly separate, and pre-existing historical I02/I07 boundaries remain faithfully preserved without falsifying waived/historical statuses.
