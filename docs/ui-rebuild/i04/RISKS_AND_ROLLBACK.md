# I04 Risks, Boundaries & Rollback Plan

## 1. Boundaries Preserved
- **Zero Production Contact**: Production D1 (`wyj-cloud-production`), Production R2, live domain routes, APK signing/Stable metadata, and Production feature flags were not modified.
- **Zero Task 37 Premature Implementation**: Audited `docs/` and `cloudflare/migrations/` — no Task 37 specification exists in this repository (`0037` is `0037_task27_email_template_newlines.sql`). Only a clean hidden extension hook (`#workspaceExtensionSlot[data-workspace-extension-slot="task37"]`) and canonical ID extension guard in `sanitizeWorkspaceBento()` are provided.
- **Paused Branches Untouched**: Did not alter `codex/android-accessibility-accounting-hotfix` or financial AI features.
- **Cross-Device Sync Honesty**: Because no server-side Bento layout sync API exists in current scope, `#workspaceSaveStatus` explicitly labels workspace customization as per-account browser-local (`本账户隔离配置` / `已保存 · 仅当前账户本地生效`) rather than claiming cloud multi-device sync.

## 2. Residual Risks & Mitigations
1. **`qa/i07/browser-acceptance.mjs` Scenario 11 (`openFixture` after Scenario 10)**:
   - Scenarios 1–10 (all 9 shared-engine scenarios + real-app routes/modal/tabs/P07 OFF) passed cleanly. Scenario 11 reloads `/__preview/i07-fixture.html` after Scenario 10 installs `/sw.js` (`sw.js:285`), causing Service Worker navigation interception to serve cached `/index.html` instead of the local QA fixture route. Non-blocking for production/CI (Core CI runs `test_i07_motion_engine.mjs`), documented transparently without altering `sw.js` navigation security contracts.
2. **I09 Toast Overlap (`#versionNotice`)**:
   - Deferred to **I09** cleanly per Owner authorization; tracked in `I03_CI_BLOCKER_CLOSEOUT.md`.
3. **Mobile Physical Android Device**:
   - Real physical Android phone / WebView verification was not executed in this session (`ANDROID_PHYSICAL_DEVICE: NOT_TESTED`). Desktop & emulated mobile (`390px`, `375px` touch) plus CI Android unit/lint/APK checks cover Web & build contracts.

## 3. Clean Rollback Procedure
- **Feature-Flag Instant Fallback**: Disabling `p07_accessibility` in Task 25 admin console reverts visual enhancements cleanly (`html[data-p07-ui="disabled"]`) while preserving core workspace cards, reorder controls, density switching, hide/restore, and persisted `aerisHomeWidgets:v2:<owner>` JSON safely.
- **Git Revert**: I04 sits cleanly on `hydrogen/i04-authenticated-workspace-redesign` stacked on `hydrogen/i03-public-pages-redesign`. Closing or reverting the I04 PR leaves I01 -> I02 -> I07 -> I03 unaffected.
- **Preview Cleanup**: Isolated preview project `thewyj-i04-preview` and D1 `aeris-i04-preview` (`bd1c84a6-dc4d-4814-836e-2b6ce477a641`) can be deleted independently with zero effect on `thewyj-i03-preview` or Production.
