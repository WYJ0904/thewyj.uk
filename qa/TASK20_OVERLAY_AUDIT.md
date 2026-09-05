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
| financeTransactionModal | Finance: new/edit transaction; direction, datetime, category | Pending |
| financeCategoryModal | Finance: manage categories; native color and type | Pending |
| financeBudgetModal | Finance: manage budgets; native month and category | Pending |
| membershipModal | Account menu: membership; purpose/plan/payment controls | Pending |
| accountModal | Account settings from menu; nested delete dialog | Pending |
| siteMessageModal | Pending single-user message; close/ack receipt | Pending |
| deleteAccountModal | Account: delete; CANCEL ONLY on retained fixture | Pending |
| adminEditModal | Admin: edit isolated selected user | Pending |
| roundSummaryModal | Finish isolated learning round | Pending |
| confirmModal | Learning/admin destructive confirmation; cancel | Pending |
| feedbackModal | Account menu: feedback, existing types and views | Pending |
| rejudgeResultModal | Rejudge correct/wrong/network outcomes | Pending |

Other interaction families:

- `siteNavPanel`: public, select, language, finance, tools, account/admin;
  tap, mouse, Escape, focus, scrolling, trial route. Old-page physical tap after
  the native sizing fix passed; new-Preview full matrix pending.
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
