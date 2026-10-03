# P3.3 Authenticated Home Restoration

P3 initial and P3.1 failed owner visual/product acceptance. P3.2 restored guest
cards, but its complete-home PASS was incorrect: authenticated root and session
restore still selected Personal Launchpad. Its original report remains in the
task history; its status is now guest restoration PASS / authenticated missing.

## Cause and corrected ownership

`renderCurrentRoute` grouped authenticated `/`, `/login`, `/register` and
`/select` into `showModulePicker`, which mounted a different home. Login and
module-return handlers also pushed `/select`. P3.2 tests explicitly accepted a
Launchpad with no hero and inspected restored geometry only while signed out.

P3.3 keeps exactly one `publicHome` DOM for guest and authenticated sessions.
The former module-picker function is a compatibility dispatcher to that home,
and `/select` remains a supported native/deep-link alias, canonicalized to `/`
without dropping its query flags. Its old DOM identifier is an inert hidden
marker, not a second template. No `/dashboard`, backend, schema or data owner is
created. Existing real login, session restoration and permissions remain.

## Integrated existing capabilities (owner's preferred option A)

- Learning records, streak, wrong words, daily goals and unfinished rounds move
  into Learning's existing card; all language/resume handlers retain their IDs.
- Favorites and recent tools use `WYJTools.getSummary` in Tools' card and scene.
- Finance uses `financeController.dashboardSummary`. Access alone is not proof
  of a loaded ledger: without a known sync/cache boundary or pending local edit,
  the scene and summary say “尚未读取”; no invented zero balance is displayed.
- Transfer queue status and its original entry move into Share's card.
- Membership, entitlements, recent updates and existing sync/backup controls move
  into Account's card. Pending notification verification is a compact user entry.

The shared gallery retains all five complete explicitly labelled product demos
in both sessions. Reliable personal summaries accompany them; demo data never
masquerades as current account data. Root summaries skip hidden/inactive WebView
rendering and refresh from the same owners on visibility/resume.

## Visual direction and template reduction

Task 19/P2's distinctive scene offsets, rotations and expanding two-column card
composition remain. All three scenes also render on mobile. P3 official Aeris
assets, interaction/motion contracts, PWA/metadata and engineering remain.

Hero uses the logo/name, one short functional line, and session-specific actions.
The kicker, serif manifesto, multiple slogans and trust list are removed. Product
Window is “本机试用”, with task-specific tabs and actual local operations; the
Gallery is “功能与账户”, with complete capability previews and existing entries.
Its quick shortcuts and repeated business CTAs are removed. Privacy remains plain
text, plans remain comparison cards with the live catalog, and footer is a short
download/changelog row. No new decorative card system, hover-only requirement,
auto animation, fake chart or gradients are added.

## Validation contract

The new P3.3 matrix uses real local-server authentication and separately verifies
320/390/1366/1920 × light/dark for both sessions. It asserts rendered geometry for
hero, scene container/all three cards, five Gallery panels/active preview and real
Product Window; zero visible replacement Launchpad; same DOM identity across
sign-in; canonical root after login, hard reload, alias and native route bridge;
unchanged session. Exact zoom reflow remains separately measured. Existing tests
continue to run with their obsolete dashboard expectations replaced by the new
required home assertions; security, upload, performance and state tests remain.

Actual local and Production screenshots, human-agent visual inspection, runtime
checks and final CI/release identities are in the task's P3.3 Closure Report.
Existing real browser session is used for Production authenticated inspection;
no session is forged, no account is forced out, no credentials are harvested,
and no Production finance/files are seeded for preview.

Physical Android authenticated home is reported separately. Without a connected
device it is **PHYSICAL DEVICE AUTHENTICATED HOME: UNVALIDATED**; desktop/native
route simulation is not a physical result. Native package/APK remain unchanged.
P4 is excluded until both home gates and the visual/template gates pass.
