# I03 Core CI Blocker Closeout & Deferred I09 Toast Tracking

## 1. Original Failing CI Run & Job
- **Branch**: `hydrogen/i03-public-pages-redesign` (Draft PR `#165`, base `hydrogen/i07-motion-interaction-engine`)
- **Failed GitHub Actions Run**: [`44534935108`](https://github.com/WYJ0904/thewyj.uk/actions/runs/44534935108) (baseline HEAD `8b87714395398fece3d027f29a42c4ba7e36aa21`)
- **Failed Job**: `Cloud-only browser, canonical session and toolbox` (Job ID `135601731268`)
- **Failed Step**: `Task 25 feature administration and release channel browser acceptance` (`qa/task25/remote-admin-ui-smoke.mjs`)
- **Failing Stage**: `UI_visible_control_#saveReleaseChannelBtn`
  - `boot_state: "ready"`, control `visibility: "visible"`, `inert: false`, geometry `278.5 × 44px`
  - `document.elementFromPoint()` at button center returned SVG `<path>`
  - `console_screenshot_unobstructed: false`, `cleanup_pass: true`, `real_user_data_modified: false`

## 2. Exact Root Cause (Reproduced 1:1 Locally)
1. **CI Proxy Transient Asset Drop**: In CI `task15-pages-dev.log` lines 11785–11796, `wrangler pages dev` (`ProxyWorker`) logged `kj/async-io.c++:60: disconnected: stream disconnected prematurely` (`Network connection lost.`) on `GET /public-experience.css` during `userPage.navigate('/')`.
2. **Unstyled SVG Expansion + Expanded Nav Drawer**: Because `index.html` header SVG icons (`#headerDownloadLink`, `#headerChangelogLink`, `#notificationBellBtn`, `#homeSearchBtn`, `#siteNavToggle`, `#themeToggleBtn`) lacked explicit HTML `width`/`height`/`fill="none"` attributes and `.site-nav-panel` collapse rules lived solely in `public-experience.css` (absent from `styles.css` and `product-ui.css`), dropping `/public-experience.css` caused `#siteNavPanel` to expand in-flow and header `<svg>` elements to revert to Chromium's default `300 × 150px` intrinsic solid-black box.
3. **Sticky `#accountBar` Occlusion**: `#accountBar` (`position: sticky; top: 0; z-index: 800`) ballooned from ~64px to `1351 × 780.19px`. When `remote-admin-ui-smoke.mjs` scrolled `#saveReleaseChannelBtn` (`y = 435.66`) to viewport center inside `#accountModal`, sticky `#accountBar` sat directly above it, placing `#headerChangelogLink > svg > path` at the click coordinate.
4. Local 1:1 reproduction dropping `/public-experience.css` matched the CI failure screenshot and `elementFromPoint()` DOM path (`... > nav#accountBar > ... > a#headerChangelogLink > svg > path`) identically.

## 3. Remediation Applied on `hydrogen/i03-public-pages-redesign`
- `index.html`: Added explicit HTML `width`, `height`, `fill="none"`, `stroke="currentColor"`, `stroke-width` attributes on `#accountBar` SVGs and `#dismissVersionNoticeBtn svg`.
- `styles.css`: Added defensive `.site-nav-panel` collapse and `.site-nav svg` sizing fallback rules.
- `product-ui.css`: Added defensive baseline `.site-nav-bar`, `.home-inline-nav`, `.site-release-actions`, `.site-nav-panel` layout rules (0 `!important`, 0 undefined CSS custom properties).
- `qa/task25/remote-admin-ui-smoke.mjs`: Retained `requireVisibleControl()` and all hit-testing assertions untouched; added read-only pre/post state capture (`beforeClickState` / `afterClickState`), stylesheet status telemetry, and full `elementFromPoint()` / `elementsFromPoint()` stack diagnostics on failure.
- `sw.js`: Rebuilt manifest hashes via `npm run task27:publication` (preserving `CORE_SHELL = 81`, `REQUIRED_SHELL = 89`).

## 4. Fix Commit & Green Core CI Verification
- **Fix Commit on `hydrogen/i03-public-pages-redesign`**: `7f88e82bd5e482e70295f2ef8e0f1b4ce25c8d21`
- **Green Core CI Run**: [`44672926000`](https://github.com/WYJ0904/thewyj.uk/actions/runs/44672926000) (`status: completed`, `conclusion: success`)
- **Final Job Conclusions**:
  - `Pages build and publish allowlist`: `success`
  - `Android unit, lint and APK`: `success`
  - `Sensitive files and static naming`: `success`
  - `JavaScript and static site checks`: `success`
  - `Python syntax and unittest (ubuntu-latest)`: `success`
  - `Python syntax and unittest (windows-latest)`: `success`
  - `Cloud-only browser, canonical session and toolbox`: `success` (including `Task 25 feature administration and release channel browser acceptance`)
  - `Browser flow (application)`: `success`
  - `Task 25 cloud credential discovery`: `skipped` (optional credentialed job, honestly reported `SKIPPED`)
  - `Task 25 Android runtime contract`: `skipped` (optional Android job, honestly reported `SKIPPED`)

---

## 5. Non-Blocking Deferred Issue Assigned to I09 (`Toast Overlap`)
- **Target Stage**: **I09｜状态、降级与系统一致性**
- **Status**: `DEFERRED_TO_I09` (NOT marked fixed; tracked transparently without touching the global toast architecture out-of-scope)
- **Observed Screenshot**: `docs/ui-rebuild/i03/evidence/preview/hosted-home-1440.png` (and visible during signed-in desktop views when `#versionNotice` is active)
- **Element Selector**: `#versionNotice.version-notice` (`right: 20px; bottom: 20px; z-index: var(--ds-z-toast, 640);` in `spatial-experience.css`)
- **Reproduction Steps**:
  1. Open `/` at `1440×900` with `p07_accessibility` enabled and an unseen `CHANGELOG` entry.
  2. Dismiss is not yet clicked; `#versionNotice` (`已更新至 v2026.11.18.2`) renders fixed at bottom-right and slightly overlaps the bottom-right border/corner of `#publicCapabilityGallery` (and bottom-right card corners on long pages).
- **Impact Assessment**: Minor non-blocking visual border overlap on initial load before auto/manual dismiss; does NOT occlude `#saveReleaseChannelBtn` or any critical Task 25 form control. To be unified cleanly in I09 across top-center placement, z-index tiering, auto-dismiss timing, and collision avoidance.
