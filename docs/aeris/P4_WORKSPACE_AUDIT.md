# P4 workspace audit

## Scope and baseline

The starting commit is `6ef37726d0deaf6fd40da265d339198a9ffec408` on fetched
`origin/main`. The clean checkout was advanced by fast forward before creating
`refactor/aeris-experience-pass`; no existing worktree or commit was reset.

The latest accepted home is P3.3's **shared guest/authenticated Public Home**.
P3/P3.1's separate authenticated Launchpad was superseded by P3.2/P3.3. This
phase preserves the shared DOM, five functional/account galleries, three scene
cards, Product Window, account capabilities and `/select` compatibility alias.

Previous phase evidence refreshed on 2026-10-05:

- Main Core CI: `37127289749`, success, source `6ef37726`.
- Production Pages: `aab6b16f-43a7-4824-a72a-b1de9cb98ac9`, main, source `6ef3772`.
- Official Android: `1.3.28 / 41`, `uk.thewyj.app`, Production base.
- Official downloaded APK: `47,893,965` bytes;
  SHA-256 `360e0c25444101e9df02f1c419dfffc055fe970df5591e2bbaa6770eef54541f`.
- Signature: `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`.
- All 25 entries in the brand asset manifest match their recorded hashes.
- Fresh P3.3 browser gate: 8 guest cases, 8 authenticated cases, four viewport
  session/reload/alias restores; passed against the immutable base export.
- P1 lazy history, cancellable 225 ms search, retained WebView and transfer rAF
  updates remain in source; P2 shared motion/haptic/swipe policies are preserved.
- ADB has no attached device. No physical P3 or P4 result is inferred from the
  source, unit tests, browser screenshots or previous reports.

## Baseline measurement method

`qa/aeris/p4-workspace-browser.mjs` runs the real application in isolated Chrome
contexts against local Pages Functions, D1 and R2. The immutable baseline is a
Git archive of the base SHA, with its own database/storage. Finance and admin
responses are explicitly synthetic presentation fixtures; transfers use real
disk Files and the real local multipart API. No Production account fixture is
created. Metrics use raw CDP, PerformanceObserver and requestAnimationFrame.
The dedicated DevTools MCP is unavailable; these are not its trace metrics.

Data: 1,500 ledger rows, 120 canonical review rows, 160 administrator rows;
390/1366/1920 px, light/dark; 200 MiB plus twelve 32 KiB files, three upload runs.
Measurements are **Windows Chrome / loopback**, not Android or WAN speed.

Baseline root ledger rewrites: 12/12/12 for twelve unchanged refreshes; all 1,500
rows replaced. Continuous search produced 11/12/12 long tasks. Tools search
rewrote its catalog ten times. Upload queue root rewrites: 41 in each run.

## Previous phase gap repaired

`createFinanceController.hydrate()` advanced the change cursor from the cheap
bootstrap response even when no transaction snapshot was fetched. An edit or
tombstone that did not increase the transaction count was then skipped by
`pullChanges()`.

The isolated before/after browser test reproduces both operations. At the base
SHA both edit and removal remain invisible; after the fix both converge. Only
a completed snapshot may adopt the bootstrap watermark. Ordinary refreshes
leave the cursor for the existing change-feed consumer to advance. Recognition,
payment direction, enrichment, booking, event aliases and server rules are not
changed. This is the only business-adjacent change in P4.

## Workspace changes

| Workspace | Presentation and state granularity |
| --- | --- |
| Home | Accepted shared home preserved; existing compact account feedback retained. |
| Finance | Dense rows; 100-row initial presentation with append pagination; full totals/history retained; keyed row patches; 160 ms search; independent deferred monthly insights; separate pending/recorded/insight card boundaries. |
| Notifications | Native LazyColumn retained; dense rows with explicit selection, bounded text and timestamp hierarchy; existing swipe, pin, delete, details, pagination and haptics preserved. Web canonical reviews use keyed rows and keep open drafts during refresh. |
| Files | Keyed queue/share rows; status/progress hierarchy; numeric quota patches avoid equal-value DOM writes; existing rAF accuracy, 250 ms persistence, part SHA, retries and owner isolation retained. Native rows use readable status labels. |
| Learning | Existing local question transitions retained; compact question/setup presentation and accessible round progress. No grading, round, history or learning storage rule is changed. |
| Tools | Dense catalog/category rows; 120 ms settled search with composition handling; keyed favorites/catalog/shelves and one delegated handler per container. |
| Account/settings | Keyed definition rows; native setting rows with navigation affordance, 56 dp minimum height and bounded secondary text. Existing account controls and permissions remain authoritative. |
| Admin | Dense rows; append retains loaded users; search keeps prior results until the latest response; delegated edit handling; original server pagination/permissions/destructive confirmations preserved. |

`reconcileKeyedRows` is a small DOM presentation helper. It does not own data,
fetching, persistence, matching, deduplication or terminal lifecycle decisions.
Public/internal names, package, domain, persistent keys, schema and bridge IDs
are unchanged. The new helper is included in the offline shell. The final browser asset release is
`20261005-p4-pending-5`, so the bounded multipart response correction is not
hidden behind a previously cached preview bundle.

## Regression evidence and boundaries

Detailed local artifacts are in `artifacts/aeris-p4/`. They are ignored output,
not Production data or committed binaries. Automated browser tests added to
Core CI exercise row identity, one-row edits, append pagination, filters/history,
folds, slow review refresh/draft preservation, terminal refresh, errors, local
favorite updates, tool Back, account Escape and administrator pagination/search.

The native isolated 125-row state test covers pagination, selection, details,
pin, delete and subsequent refresh, preserving unaffected row objects.
Android's initial local run has 510 tests, zero failures/errors/skips, plus
successful lintDebug and assembleDebug. This is not frame pacing/device proof.

CI exposed two test-infrastructure issues: old pinned cache-version assertions,
and a missing-rubric failure fixture that only cleared memory while background
learning sync could restore its imported standard meaning. The assertions now
pin the new cache version; the fixture imports missing meaning durably, retaining
all failure/recovery assertions. No grading behavior is changed.

The file lifecycle CI also stalled with 12/13 parts acknowledged. Multipart IO
now requires actual byte/state progress to reset the idle watchdog and bounds
the acknowledgement phase after the request body is sent. Slow uploads with
advancing bytes retain their existing idle policy; same URL/body/hash retries
remain bounded and idempotent. The unit regression covers duplicate events and
response events that would otherwise extend the acknowledgement wait. There
is no change to part size, concurrency, SHA, API/storage layout or downloads.

The Windows Wrangler dev proxy exited intermittently during repeated navigation.
Settled-theme visual captures use an isolated static/legacy fixture gateway;
their Finance/review/admin/empty-transfer responses are presentation fixtures.
Earlier before/after upload measurements and the full Cloud-only CI still use
Pages Functions, D1 and R2. This gateway is not a Production/security or device
validation substitute.

No migration is added or applied remotely. Production migration list reports no
pending migrations. Read-only D1 baseline finds 99 transactions with 99 distinct
IDs (50 active, 49 tombstones); historical dates remain present. No real ledger,
notification, user file or share is altered for this phase's fixtures.

## Carry-forward

Loopback upload duration must not be presented as a network-speed improvement.
Physical upload stutter/WAN throughput need device profiling. The separately
reported HTTP/1 download-tail issue is not changed by this presentation work;
HTTP/2 retrieval of the official baseline APK matched bytes and certificate.
No P5, P6, Task 25 or network protocol redesign is included.

## P4 canonical pending closure repair

The normal review projection now uses server records exclusively. Unmatched local recognitions remain in a separate recovery section with their original identities. A complete successful server observation is current even when recovery exists. Recognition, OCR, capture, auto-booking, lifecycle and Room identities are unchanged. Regression coverage includes 3 canonical / 2 recovery, exact-alias convergence and empty/error/partial fallback. Signed verification candidate 1.3.30/43 uses the existing release certificate; release promotion remains gated by fresh device acceptance.

