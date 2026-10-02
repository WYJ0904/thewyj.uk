# Aeris Experience Pass — P1

Current phase: Android Performance & Navigation. Implementation and non-device validation are complete; physical Android acceptance remains **DEVICE-DEPENDENT DEFERRED**. This report does not label the deferred checks PASS.

## Previous phase gate

Repository: `WYJ0904/thewyj.uk`. Branch: `refactor/aeris-experience-pass`. Base HEAD: `0f45a344276b18ba608926f68d8a398b7c8f2a48`, refreshed from remote main after Phase 0. The original checkout was preserved in its existing branch.

Phase 0's delivered `BASELINE_REPORT.md` recorded current Production 1.3.26 / versionCode 39, source/CI/release integrity, browser page states and loopback upload measurements. Physical Android startup, navigation, jank, 60/120 Hz and SAF-provider measurements were unavailable. The subsequent explicit execution instruction accepts these gaps and permits P1's remaining work to proceed.

## Actual changes

- Retain one authenticated WebView. Visibility and `onPause`/`onResume` follow native content, overlays and Activity lifecycle. A document-local activity signal stops numeric upload rendering, decorative timers and periodic status probes when inactive; upload durability and the session remain active. `pauseTimers()` is not used because it affects all WebViews.
- Guard native destination selection against delayed web history callbacks and accept only the latest requested programmatic route. Keep the existing one-document navigation bridge and its coalesced pending destination. Transfer navigation from the site menu now uses that same document.
- Replace the notification history's eager scrolling column with a real `LazyColumn`, stable revision keys and independent header/control/footer items. Pagination appends rows. Unchanged rows retain identity; selection observes derived membership per row.
- Use a 225 ms search debounce, cancel superseded reads and reject stale results or pages by generation. Keep queries on the repository's IO dispatcher and decode notification media off the main thread.
- Move update-download progress collection from the app root into the account screen. Move native transfer settings, queue and cleanup IO off the UI thread. Stop transfer polling while the lifecycle is below STARTED.
- Share an account-specific queue snapshot cache between worker and UI. Atomic writes update the cache immediately, and file metadata invalidates it after external changes. Generation guards and the durable JSON schema remain intact. Settings now use atomic, synchronized writes across instances.
- Pause/resume transform the current durable record instead of writing an old screen snapshot over newly acknowledged parts. Completion removes only the completed batch, preserving other current records.
- Coalesce web upload progress to one animation frame, patch numeric nodes and checkpoint acknowledgements at most once per 250 ms window. Allocation, completion, pause/error and cleanup boundaries remain immediately durable. Hiding flushes only an outstanding checkpoint, so initial hide cannot overwrite a queue before restoration. Account changes cancel stale scheduled callbacks.
- Advance frontend cache tokens together and precache the new transfer scheduler, preventing a mixed module graph after deployment.

Part size remains 16 MiB, PUT concurrency 3 and hash look-ahead 2. SHA-256, source streaming, Range downloads, account isolation, recovery, revoke and quota semantics are preserved. Product UI design and brand assets were not changed.

## Baseline comparison

Three alternating runs per version used the same 200 MiB on-disk file and machine, fresh browser contexts/accounts, headless desktop Chrome, and isolated loopback Pages/D1/R2. These are host measurements, not physical Android or WAN results. The checked-in compact evidence includes every run; `qa/aeris/p1-browser-benchmark.mjs` reproduces the capture against supplied baseline/current loopback URLs.

| Metric | main 0f45 | P1 | Interpretation |
| --- | ---: | ---: | --- |
| Whole queue innerHTML writes per upload | 18 / 18 / 18 | 5 / 5 / 5 | 72.2% fewer structural replacements |
| Queue storage writes | 20 / 20 / 20 | 11 / 11 / 11 | 45% fewer synchronous writes |
| Pipeline duration, median | 11,388 ms | 11,771 ms | No throughput improvement demonstrated |
| Pipeline throughput, median | 17.56 MiB/s | 16.99 MiB/s | About 3.3% lower in this small loopback sample; no WAN claim |
| Long tasks >=50 ms during upload | 0 / 0 / 0 | 0 / 0 / 0 | No detected long-task regression or improvement |
| Multipart acknowledgements | 13/13 each | 13/13 each | No part loss |

The existing pipeline benchmark also passed with simulated network latency and real per-part SHA-256. Its serial/pipeline speedup is pre-existing behavior, not attributed to P1.

Browser route/activity contract: 120 same-turn native route requests produced one new history entry and landed on the last destination (`/finance`). Menu navigation to transfer changed the path synchronously, preserved the document marker and reached the first measured rAF after 34.6 ms. This rAF value is not Android input latency or INP.

With the activity signal false, persisted uploaded bytes advanced from 48 to 80 MiB while displayed progress stayed at 24%; reactivation immediately caught up to 40% without replacing the document or session. This verifies the browser contract, not an Activity's physical lifecycle behavior.

## Validation

- Initial full Android unit suite: 487 tests, zero failed/error/skipped. The additional latest-route regression subsequently passed in `AppNavigationTest`; the settings race regression is included in the final CI suite.
- `lintDebug` and `assembleDebug`: passed after fixing an introduced indentation error. Existing warnings remain visible; no baseline suppression was added.
- Notification query race, stale pagination, unchanged row identity, 121-row pagination and main-thread Room regressions passed. Search controller tests cover burst input, cancelling a running query and disposal.
- Queue tests cover cross-instance read/modify/write, durable acknowledgement retention during pause, generation reset, corrupt-file recovery, source retention and account isolation.
- Transfer scheduler, isolation, batch/session plan, pipeline, backend quota, integrity, module graph, core navigation/session/storage and interaction tests passed locally.
- Real browser EXE and MP4 files, both >16 MiB: upload → publish → browser download, exact source/download SHA-256 and size. Cancellation, two-file deletion, session recovery and quota restoration passed.
- Browser interaction feedback regression: eight checks passed across account, finance, learning, transfer, tools, membership and traces.
- The route/activity regression is now a Core CI cloud-only browser step. CI completion must be verified from the associated PR checks; local validation alone is not the remote gate.
- The first CI run caught three stale static-test release-token fixtures. Their expected version was advanced to `20261002-aeris-p1`; every asset/module/precache assertion is retained. No assertion or test was removed, weakened or skipped.

## Release and gate accounting

The P1 signed candidate uses the existing production package, certificate and 1.3.26 / 39 metadata for build validation only. It is not uploaded over the existing formal APK. The formal Android release remains 1.3.26 until the later release stage advances all metadata consistently. PR/main/Production changes are recorded in the external phase closure report after remote CI and deployment are observed.

Files changed include native WebView/shell/history/transfer state, targeted Kotlin tests, the transfer scheduler, cache tokens, CI and reproducible browser checks. No server data migration or business API change is required.

## Known limitations and blockers

**DEVICE-DEPENDENT DEFERRED:** startup/session restore on the SM-S9360, 60/120 Hz frame pacing, recomposition traces, 100+ notification scrolling and keyboard jank, native/WebView navigation/input latency, SAF source throughput, real upload interaction, foreground/background/resume/back/deep-link checks. ADB and wireless discovery were unavailable after five connection probes. No emulator result substitutes for these checks.

The 250 ms checkpoint can omit recent acknowledgements after a process crash; server resume reconciliation and immediate terminal persistence preserve recovery. Queue cache reuse is verified in-process; OS/SAF disk performance remains device-dependent. Host rAF gaps and loopback throughput are not mobile performance acceptance evidence.

Ready for next phase: subject to the remote Core CI/main gate, with the explicitly accepted device checks deferred. P1 has no confirmed non-device blocker after the listed fixes and retests. Later phase UI/brand work must remain in separate commits.
