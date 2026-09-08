# Task 20 overlay and authenticated-startup audit

Status: physical acceptance IN PROGRESS. PR #42 stays Draft. Production stays off.

## Reproduced root causes

- On Samsung SM-S9360 / Android 16 / WebView 151, the old AndroidView WebView
  had no explicit MATCH_PARENT layout parameters. Its visible/client height was
  703 CSS pixels while probes of 100vh/100dvh/100svh/100lvh all resolved to zero.
  An actual tap expanded navigation (`aria-expanded=true`), but computed
  max-height stayed zero and only its 1.6px border was visible. The same viewport
  units constrain every modal. After explicit MATCH_PARENT and layout-ready
  navigation, the SAME old Preview page resolves 100dvh to 703.2px and the menu
  opens and receives input. No per-control height constants or reload delays.
- Three finance dialogs were inside appShell and used a separate opening path
  without the shared background-inert/focus/scroll contract. All modal layers
  now mount under body; finance uses the same dialog functions as other pages.
- Keyboard/visual viewport height and offset are shared overlay variables.
  Menus have available-height scrolling; nested dialogs keep only the top layer
  interactive. Closing returns focus without scrolling the underlying page.
- Web boot explicitly displayed the login form while awaiting health, even with
  an existing account. Restoring is now a separate state; Native owns login.
  A real delayed-health browser test records every painted frame, not just the
  final account state or document-load count.

## Inventory and acceptance boundaries

Scanned index.html, app.js, all five stylesheets, tools.js, workflows.js,
js/core, js/finance and the Android WebView host. The 12 `.modal-layer` IDs below
are checked automatically in both themes for body mounting, viewport bounds,
hit-testing, background inertness and unlock. This geometry audit is NOT a
substitute for the business triggers or physical picker acceptance.

| Layer ID | Actual trigger / coverage | Physical new-Preview status |
| --- | --- | --- |
| financeTransactionModal | Finance: new transaction; direction and datetime | PASS both themes; cancelled without writing |
| financeCategoryModal | Finance: manage categories; native color and type | PASS both themes; cancelled without writing |
| financeBudgetModal | Finance: manage budgets; native month and category | PASS both themes; cancelled without writing |
| membershipModal | Account menu: membership; finance purpose and plans | PASS both themes; no order created |
| accountModal | Account settings from menu; nested delete dialog | PASS both themes |
| siteMessageModal | Pending single-user message; close/ack receipt | Pending |
| deleteAccountModal | Account: delete; CANCEL ONLY on retained fixture | PASS both themes; account retained |
| adminEditModal | Admin: edit isolated selected user | Pending |
| roundSummaryModal | Finish isolated two-word round via skip | PASS both themes |
| confirmModal | Learning destructive confirmation; cancel | PASS both themes; admin trigger pending |
| feedbackModal | Account menu: feedback type and soft keyboard | PASS both themes; no feedback submitted |
| rejudgeResultModal | Rejudge wrong outcome; explicit confirmation and Android Back | PASS both themes; correct/network outcomes pending |

Other interaction families:

- `siteNavPanel`: public, select, language, finance, tools, account/admin;
  tap, mouse, Escape, focus, scrolling, trial route. Old-page physical tap after
  the native sizing fix passed; new-Preview select-page taps and Android Back
  passed in both themes. Public/trial and admin-specific routes remain pending.
- `accountMenu` / `.account-menu-popover`: details/summary, viewport edges,
  account/membership/feedback links, outside click, mutual exclusion with nav.
- Native selects (26 static controls): trialQuizLanguage, trialImageFormat,
  financeDirectionFilter, financeCategoryFilter, financeStatusFilter,
  financeTransactionDirection, financeTransactionCategory, financeCategoryAppliesTo,
  financeBudgetCategory, gradingModeSelect, practiceModeSelect, languageSelect
  (hidden legacy selector), aiLevelSelect, aiSuggestMode, workflowToolSelect,
  adminUserMatch, adminFeedbackType, adminFeedbackStatus, adminMessageScope,
  adminMessageType, adminRoleUserSelect, trialLanguageSelect,
  adminMembershipAction, adminMembershipSelect, adminTrialLanguageSelect, feedbackType.
- Dynamic tool selects: textToolOption, fileToolEncoding, imageFormat,
  imageAngle, imageFlip, qrWifiSecurity, qrKind; workflow schema enum selectors.
- Native pickers: finance month/datetime/color, message expiry, random start/end
  date, image/watermark/gradient colors, workflow colors, file chooser.
- Tooltips are native title/aria descriptions; text selection context menus and
  select/date/color/file dialogs are platform UI, not DOM layers. They need
  actual Android interaction, not a DOM-only success claim.
- No separate custom context-menu, popover portal, drawer or sheet subsystem
  was found. Mobile shared modals already use a bottom-sheet layout.

Required physical matrix: both themes, top/bottom/left/right edges, keyboard,
scroll, hit testing, close, background isolation, no horizontal overflow.
Do not claim all controls passed until the Pending entries above have evidence.

## Authentication environment finding

Read-only metadata checks found the historical production admin username in
Production (active PBKDF2-SHA256 metadata, 310000 iterations) but zero matches in
Preview. Preview's owner is an isolated reset-required fixture, not that user.
The common Task 12 loginAccount verifier is used by both Web and Android; an
absent/deleted Preview user returns invalid_credentials before hash verification.
No password, verifier, pepper or token was read/exported; no production data or
credential was modified. A synthetic six-character PBKDF2 test passes, but the
user's historical admin login remains BLOCKED by environment identity, not PASS.

## Rollout

No D1 migration, API contract, entitlement or payment change. Debug-only native
diagnostics log fixed UI states, layout dimensions and cookie completion, never
credentials/page text. Local/CI browser geometry uses loopback-only existing test
bindings. Production and non-test origins do not expose those bindings.

## 2026-09-06 warm-navigation correction

The earlier one-document-load-per-tab result is NOT a warm-navigation pass.
Native tabs called loadUrl, re-running boot and health/account discovery on every
page. Native warm navigation now dispatches only allowlisted same-origin routes
to the existing SPA renderer. Rapid taps serialize/coalesce; browser history is
still observation, not another load command. Only cold start and a real changed
access-session epoch can load/reload a document. The initial recovery state is
not used during warm navigation. Android Back dismisses the top shared overlay
before going back in history, preserving confirm-only/message receipt rules.

Local real-browser regression: 11 flows passed, including warm route identity,
zero auth-refresh requests, painted-frame login/recovery detection, and all 12
shared dialogs in both themes. Task 20 D1 integration: 18 passed. Static: 28
passed. See the dated physical evidence below; a later tool race was found and
must be rechecked on the next Preview APK before closing this acceptance gate.

Previous fixed-viewport APK on the physical SM-S9360 passed both-theme taps for
navigation/account menus, membership, account/delete-cancel, feedback plus soft
keyboard, and all three finance dialogs with native select/date/month/color
pickers. This is supporting evidence, not a claim that the remaining physical
admin/message/learning/tool picker matrix is complete.

## 2026-09-07 physical SPA acceptance and 2026-09-08 tool race

Physical evidence uses the fefbb64 APK, fixed Preview
https://771ae15a.thewyj-uk.pages.dev, SM-S9360 / Android 16 / WebView 151,
384 CSS-pixel width (1440 physical pixels), 703.2 CSS-pixel WebView height.
Only an isolated user-created Preview test account was used. Reports and
screenshots are outside Git; no secret, token, real QR or personal file is logged.

- Native tools, language, finance, home, tools, finance: six actual tab sequences,
  correct target content (not a membership gate), zero document loads,
  zero /api/me or native refresh calls, and zero painted login/guest/recovery
  frames. Independent periodic status polling is not claimed to be zero.
- Home return retained the document. Process kill and force-stop restored the
  same account. This is nine flow checks, not proof of phone reboot/VPN cases.
- Core popup suite: 52 physical checks in light/dark, 10 distinct modal IDs,
  no runtime errors. Real triggers, ADB touch hit checks, bounds, keyboard,
  native selectors, nested inertness and native Back were exercised.
- Driver corrections: physical coordinates subtract visualViewport offsets;
  wait for stable measured geometry, and verify the actual pointerdown target.
  Previously an IME-shifted tap hit the word-list button instead of Skip.
  A resumed wrong-book view must explicitly switch to setup before selectors.
  These corrections do not add product delays or change learning logic.
- A separate REAL product race was found in the tools suite: show('/tools')
  displayed the catalog and awaited preferences; a user opened random-date;
  the older show continuation then closed that workbench. The URL remained the
  tool URL. The real-browser regression fails on the old code with
  "Late preferences closed the new workbench". A tool view revision now guards
  async continuations; opening/closing/hiding supersedes old renders. Edited
  input and departure to language are regression-tested with real delayed API
  responses, not replacement business data. The local 12-flow suite passes.
- The unified asset release is bumped to avoid serving the old cached tool code.
  API, database, membership and payment contracts are unchanged.

Remaining physical gates: adminEditModal and siteMessageModal using a
legitimately authenticated Preview administrator; rejudge correct/network
outcomes; reboot/recents/network/VPN and other Task 20 persistence scenarios.
The historical production admin is absent from Preview. Do not manufacture a
pass, reset that credential, or forge an owner session to bypass this gate.

## 2026-09-08 physical tools and core overlay suites on the new Preview

The phone returned (SM-S9360 / Android 16 / WebView 151, ADB serial
R5CY22MEHJN). The f639a40-based debug APK was installed on 2026-09-08 14:07
and points at the fixed Preview https://e82714c4.thewyj-uk.pages.dev. Only the
isolated Preview fixture (account 6e846bea-d9ee-4363-9b73-aa5afbfc3b19,
username 1111q) was used; reports and screenshots remain outside Git.

- Tools overlay suite (`TASK20_OVERLAY_SUITE=tools`, report
  tool-overlays-1111q-r8) passed both themes, 24 checks, zero runtime errors:
  random-date start/end pickers, gradient start/end color pickers, text-tool
  select, image-format select, QR kind select, text long-press context menu,
  file chooser open/cancel/reopen twice, and trial navigation with native
  quiz-language and image-format selects. The context-menu gate passed on
  physical evidence (contextmenu event plus two new Android PopupWindows),
  because Samsung draws the floating toolbar inside the WebView surface and
  does not expose it to UIAutomator. The file chooser is the official Android
  16 Photo Picker (`com.google.android.photopicker`); the driver waits for the
  real picker hierarchy and for MainActivity to resume before reopening.
- Core overlay suite (`TASK20_OVERLAY_SUITE=core`, report
  core-overlays-1111q-r1) passed both themes on the same new APK: 52 checks,
  zero runtime errors. All modal layers mount under body, keep the background
  inert, fit the 384x703.2 CSS viewport with no horizontal overflow, and
  release the background after close. Finance direction/datetime/select/color
  and learning grading/practice/select pickers opened as real native dialogs;
  feedback soft-keyboard viewport, nested delete-cancel, confirm cancel,
  rejudge confirm-only Back behavior, and Android Back closing the navigation
  panel all passed in light and dark.
- Driver hardening only (commit 2e2ab2e): native picker/file-chooser detection
  now waits up to 8s for the real platform hierarchy to mount, file-chooser
  cancel waits for MainActivity to actually resume, tap stability includes
  scroll/position/viewport height, and the text menu uses contextmenu plus
  PopupWindow evidence. No product delay, reload, or business-code change.

Repeatable opt-in physical commands: configure the documented device/Preview/
fixture/report environment variables, then run qa/task20_overlay_device.mjs.
TASK20_OVERLAY_SUITE=core (default) and tools produce separate explicit reports;
running one does not mark the other passed. Native file-picker checks only open,
cancel and reopen, never enumerate/select/screenshot personal files.
