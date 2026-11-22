# Aeris I09 — System Notifications, Layering & Interaction Feedback Unification Report

- **Branch**: `hydrogen/i09-system-feedback`
- **Stacked Base**: `hydrogen/i08-global-polish` (`9d7a66ac3a2059fb43fcf90fbf0c065f4d51dfdf`, Draft PR `#175`, Core CI run `45019044465` `success`)
- **Stage B Commits**:
  - `c429fb94` — `feat(ui-i09): unify HUD notice layering, toast lifecycle, semantic feedback, and Kill Switch sync`
  - `c36b9a13` — `fix(qa-i09): scope releaseChannelSelect eval in IIFE`
  - `bc13f316` — `fix(qa-i09): make preview verifier idempotent across repeat logins`
- **Isolated Hosted Preview**: `thewyj-i09-preview` (`https://i09-system-feedback.thewyj-i09-preview.pages.dev`, immutable `https://0aa7efff.thewyj-i09-preview.pages.dev`, deployment `0aa7efff-b091-4639-8f32-9335debe2983`) + isolated D1 `aeris-i09-preview` (`f664066f-9abb-45fc-b1fa-913bc65da0af`)
- **Source Alignment Note**: Standalone external planning attachments referenced in handoff notes (`V1.1` benchmark PDF, `V1.0` micro-interaction doc, and external `.txt` log) were not present in the repository tree; requirements were fulfilled against the authoritative task specification and in-repo `docs/ui-rebuild/{i01,i04,i07,i08}/` contracts (`I03_CI_BLOCKER_CLOSEOUT.md`, `TOAST_ACCEPTANCE.md`, `I03_I04_HANDOFF.md`).
- **Isolation & Production Status**: `NOT_TOUCHED` (`WYJ_DB` `11c288d8-c584-409f-bb1f-7e7af11793e5`, `thewyj-uk` Production, `thewyj-i06-preview`, `thewyj-i08-preview`, Production R2/flags/accounts, and Android Stable pointers untouched).

---

## 1. Delivered System Feedback & Notification Changes (I09-01 to I09-05)

1. **I09-01｜Resolved `#versionNotice`, `#siteMessageSaveStatus` & `.ds-toast-region` Layering and Clipping (`index.html`, `js/core/design-system.js`, `design-system.css`, `product-ui.css`, `spatial-experience.css`)**
   - Moved `#versionNotice` inside `#appShell` outside `#v3AppFrame` so `body.ds-sheet-scaling #v3AppFrame { transform: scale(...) }` no longer creates a transform containing block or stacking clip for desktop fixed notices.
   - Added `syncSystemNoticeLayout()` in `js/core/design-system.js` (`ResizeObserver` + `MutationObserver` + `visualViewport` resize/scroll listeners) driving `:root` variables `--ds-hud-keyboard-inset`, `--ds-hud-save-offset`, `--ds-hud-version-offset`, and `data-right-drawer-open`.
   - Aligned `.site-message-save-status` (`z-index: calc(var(--ds-z-toast) + 2)`), `#versionNotice` (`var(--ds-z-toast)`), and `.ds-toast-region` (`calc(var(--ds-z-toast) + 4)`) inside the canonical Toast band (`< --ds-z-popover: 820 < --ds-z-modal: 9000`), stacking them vertically without overlap on desktop and shifting `.ds-toast-region` above `#siteMessageSaveStatus` on mobile (`<= 980px`) while `#versionNotice` flows cleanly above the footer.
   - Coordinated blocking modal & drawer coexistence (`body.modal-open`): desktop right-docked `#financeTransactionModal` shifts `.ds-toast-region` cleanly left of the `480px` drawer; mobile bottom sheets (`<= 760px`) dock `.ds-toast-region` cleanly to top safe-area above the sheet.
   - Added `--owner-preview-banner-height` offset awareness for `P07 OFF` `.version-notice` in `product-ui.css`.

2. **I09-02｜Toast Queue & Route-Scoped Lifecycle (`js/core/motion.js`, `app.js`)**
   - Removed duplicate live-region announcement: `<article class="ds-toast">` now uses `role="group"` + `aria-label`, leaving screen-reader speech solely to dedicated `.ds-sr-only` `politeLive` (`role="status"`, `aria-live="polite"`) and `assertiveLive` (`role="alert"`, `aria-live="assertive"`).
   - Added `getContextToken()`, `invalidateContext({ includeErrors })`, and `dismissByKey(dedupeKey)` cleanly hooked into `pushRoute` and `popstate` so stale async non-error toasts from superseded routes cannot pop after navigation, while network-recovery events cleanly replace `"network:connectivity"` notices after `bootState === "ready"`.
   - Protected interactive/focused toasts from preemption by incoming errors when idle candidates exist, added `Escape` dismissal inside focused toasts without stealing external input focus, and replaced entrance `scale(0.96)` with pure translation so `.ds-toast-close` hit targets stay `>= 44px` from frame 0.

3. **I09-03｜Unified Async Feedback Semantics (`js/core/feature-flags.js`, `app.js`)**
   - Added `setInlineFeedback()` + semantic `data-feedback-state` styling (`pending`, `success`, `info`, `error`) across `#accountMessage`, `#adminEditMessage`, `#adminError`, `#siteMessageError`, `#releaseChannelStatus`, `#featureConsoleStatus`, `#adminMessageFormStatus`, `#adminRoleStatus`, and `#siteMessageSaveStatus`.
   - Fixed `saveReleaseChannelBtn` failure handling in `js/core/feature-flags.js` so transient API errors keep valid `snapshot`, user selection, and retry ability intact instead of wiping state and locking the save button.
   - Wired `changeOwnSecret`, `acknowledgeActiveSiteMessage`, `saveSiteMessageDismissal`, `saveAdminMembership`, `updateAdminToolsOverride`, `saveAdminSecret`, `adminUserAction`, `sendAdminMessage`, and `askConfirmation`/`runConfirmedAction` so pending states precede awaits, success waits for API confirmation, cancellation (`"操作已取消"`) is reported honestly as unchanged `info`, and confirmation errors route to `#adminError` when `#adminEditModal` is closed.

4. **I09-04｜Kill Switch Persisted vs Draft/Error State Linkage (`js/core/feature-console.js`)**
   - Distinguished persisted server state (`persistedForForm()`) from local dirty edits (`isDraftDirty()`) using `data-server-kill-active`, `data-dirty`, `data-kill-mode="active | pending-enable | pending-clear"`, and explicit capsule labels (`紧急关闭 · 已生效` / `紧急关闭 · 未保存` / `紧急关闭生效中 · 待保存`).
   - Preserved `#featureFlagKillWarning` visibility when a persisted server Kill Switch is active even if unchecked locally before save succeeds, and prevented `403` / network refresh failures or cancelled step-up prompts from clearing active warnings or discarding edits.

5. **I09-05｜Layering, Focus, A11y & Theme Verification**
   - Verified zero `!important` in the I09 CSS layer, WCAG AA contrast (`>= 4.5:1` / `0` serious+critical `axe-core` violations), `>= 44px` close/retry targets (desktop & mobile), `0px` horizontal overflow across `375 / 390 / 768 / 1024 / 1440px`, Light/Dark themes, Reduced Motion, and `P07 OFF` fallback.

---

## 2. Verification Summary (Local & Isolated Hosted Preview Distinct)

| Check & Environment | Scope / Commit | Result | Observed Details |
| :--- | :--- | :--- | :--- |
| `node qa/i09/verify-preview.mjs` (**Isolated Hosted Preview**) | Clean commit `bc13f316` on `https://i09-system-feedback.thewyj-i09-preview.pages.dev` | **PASS** | `10/10` core asset SHA-256 parity; HUD non-overlap (`1440`, `390`, `375px`, `#versionNotice` outside `#v3AppFrame`, `44px` close target, `0px` overflow); Dark `#financeTransactionModal` right drawer left-shifted Toast (`overlap: false`, `toastLeftOfDrawer: true`); Release Channel save + restore; Kill Switch persisted -> `pending-clear` -> restored; Reduced Motion; `P07 OFF`; `3` `axe-core` scans (`45`, `38`, `46` passes, `0` violations); `5` hosted screenshots; `0` runtimeErrors |
| `node qa/i09/browser-acceptance.mjs` (**Local Miniflare**) | Clean commit `c429fb94` (`worktreeDirty: false`, run `run-Tql5TM`) | **PASS** (4/4) | `#versionNotice` + `503` `#siteMessageSaveStatus` + error/success Toasts zero overlap across `1440 / 1024 / 768 / 390 / 375px` (`>= 44px` close/retry); Retry persistence clears `#siteMessageSaveStatus`; Dark `#financeTransactionModal` desktop drawer & `375px` mobile bottom sheet non-occlusion; stale-route token suppression & non-stealing input focus; `i09user` password mismatch preservation; `503` release-channel retry recovery; Kill Switch `pending-enable` -> step-up cancel -> persisted -> `pending-clear`; Reduced Motion & `P07 OFF`; `3` `axe-core` scans `0` violations; `5` screenshots |
| `npm run task27:publication`, `npm run build`, `npm run cf:check`, `node scripts/check_js_module_graph.mjs` (**Local**) | Clean commit `c429fb94` | **PASS** | Publication hash `c189592401dc4a52fca3742bd1d7383004015a58290a8344adf456f2b833b8d4`; `205` staged Pages files; Worker compiled; `67 files, 116 imports`, `0` cycles |
| `node --test local-backend/test_i0*.mjs local-backend/test_aeris_state_consistency.mjs` (**Local**) | `test_i02..i09` + Aeris state consistency | **PASS** (51/51) | Includes `test_i09_system_feedback.mjs` (4/4) + zero `!important` + `81/89/89` SW shell counts |
| `python -m unittest local-backend/test_static.py` & `test_accounts.py` (**Local**) | Static & account suites | **PASS** (31/31, 57/57) | All static & account password rules passed |
| `npm run test:task25`, `npm run test:task27:login-guard`, `node local-backend/test_task27_web_notification_js.mjs`, `test_interaction_feedback_js.mjs`, `test_motion_js.mjs`, `test_task11..18` (**Local Isolated D1**) | After code changes | **PASS** | Task 25 (`12` D1 + `19` Web/native), Task 27 login-guard (`9/9`) & web notifications (`8/8`), Motion (`1`), Task 11 (`27`), Task 12 (`15`), Task 13 (`17`), Task 16 (`11`), Task 18 (`8`), Core/Membership/Language/Task26 (`32+17`) passed |
| `node qa/i08/browser-acceptance.mjs` & `node qa/i06/browser-acceptance.mjs` (**Local Miniflare**) | Regression after Stage B edits | **PASS** (5/5, 6/6) | I08 R01–R03 & I06 V01–V03 zero regressions (`3` + `12` screenshots verified) |
| `node qa/i07/browser-acceptance.mjs` (**Local Miniflare**) | Cross-stage I07 check | **FAIL** (9/9 fixture scenarios PASS; `axe` on `real-app-admin-flags` flagged `2` pre-existing I06 rules) | All I07 toast-burst, FLIP, drag, modal/drawer scenarios passed; `real-app-admin-flags` hit pre-existing I06 `button[role="listitem"]` (`minor`) & I06 muted directory text contrast (`#6c7788` `4.22`, distinct from `#featureConsoleStatus` updated to `--ds-text-secondary` in Stage B) |

---

## 3. Archived Evidence & Boundaries

- **Local Clean-HEAD Evidence**: [`evidence/i09-acceptance-report.json`](evidence/i09-acceptance-report.json), `1440-i09-hud-stack-light.png`, `390-i09-hud-stack-light.png`, `1440-i09-finance-drawer-toast-dark.png`, `375-i09-mobile-sheet-toast-dark.png`, `1440-i09-admin-kill-switch-warning-light.png`
- **Isolated Hosted Preview Evidence**: [`evidence/i09-preview-provision.json`](evidence/i09-preview-provision.json), [`evidence/i09-preview-stage.json`](evidence/i09-preview-stage.json), [`evidence/hosted/i09-preview-source-check.json`](evidence/hosted/i09-preview-source-check.json), [`evidence/hosted/i09-preview-verification.json`](evidence/hosted/i09-preview-verification.json), `hosted-i09-hud-stack-1440-light.png`, `hosted-i09-hud-stack-390-light.png`, `hosted-i09-finance-drawer-1440-dark.png`, `hosted-i09-account-375-dark.png`, `hosted-i09-admin-kill-switch-pending-clear.png`
- **Not Executed / Untouched**: Physical Android device (`NOT_TESTED`), `qa/task27/web-notification-browser.mjs` (noted in I08 as pre-existing `ds-sheet-scaling` width-range interaction), Production (`NOT_TOUCHED`), PR merges (`NOT_MERGED`).
