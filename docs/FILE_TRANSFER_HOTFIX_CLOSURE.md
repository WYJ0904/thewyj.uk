# File Transfer Hotfix closure report

Status: **awaiting physical Android acceptance**. Task 24 remains COMPLETE. This
independent hotfix is not Task 25.

## Baseline

- Repository: `WYJ0904/thewyj.uk`
- Starting clean main: `66c2ca643d3ab1052721a6a33f050f1f1c3f1948`
- Worktree branch: `codex/file-transfer-hotfix`
- PR: [#79](https://github.com/WYJ0904/thewyj.uk/pull/79)
- Production runtime implementation: `ecf03ee54f42036a996feef191f44a3f96faa8cd`
- Final PR head and merge commit: pending physical Android acceptance.
- Existing formal Android release: `uk.thewyj.app` 1.3.19 (32); in-app update metadata unchanged.

## Root causes and corrections

1. The Android signed-out shell entered session recovery before the public
   `/transfer#share=...` recipient route. The Web bootstrap also waited on
   backend state before rendering the transfer page. The recipient route now
   renders anonymously, and owner-only requests run only in owner context.
2. Android's HTTPS intent route kept only the path, dropping query and fragment.
   The route policy and native shell now preserve both for the exact trusted
   origin. `/transfer` is a valid SPA route. The manifest no longer registers
   every `thewyj.uk` HTTPS path; it offers only `/transfer` with no automatic
   verification, leaving public links browser-first.
3. Quota accounting counted expired active sessions as used storage and combined
   active upload reservations with stored shares. Capabilities and diagnostics
   now return `stored_bytes`, `reserved_bytes`, and their sum `used_bytes`.
   The page exposes unfinished cloud sessions and lets the owner release them.
4. Cancel removed only the local queue item. Superseding a batch fired a
   best-effort abort without awaiting it. Cancel and replacement now abort the
   server session; failed aborts remain in an owner-scoped retry queue. A
   scheduled Task22 Worker provides the server-side expiry backstop. Pause
   retains its session and uploaded parts.
5. The transfer integrity matrix lacked PDF, multilingual TXT, ZIP, DOCX and
   filename cases. The server accepts ordinary Unicode/punctuation filenames
   while rejecting traversal and controls. Android DownloadManager now prefers
   RFC 5987 UTF-8 `filename*` over the ASCII fallback.
6. Web imports and the service worker still used the Task24 asset version.
   This hotfix advances the asset token to `20260928-transfer-hotfix-r1` so
   Production browsers and WebViews load the new transfer module.

## Code changes

- Public routing and shell: `app.js`, `index.html`,
  `js/transfer/app.js`, Android `MainActivity`, `NotificationRoutePolicy`,
  `WebRoutePolicy`, `AppViewModel`, `ThewyjApp`, and manifest.
- Transfer server and cleanup: `functions/_lib/task22-api.mjs`,
  `task22-model.mjs`, `task22-service.mjs`,
  `cloudflare/task22-cleanup-worker.mjs`,
  `wrangler.task22-cleanup.jsonc`.
- Android download name: `ThewyjWebView.kt`.
- Cache version: `js/core/config.js`, `sw.js`, and versioned HTML/module
  imports. No payment recognition, Finance, or notification implementation was
  changed.
- Regressions: Task22 D1, transfer integrity, browser round trip, Android
  route/download name, and static contract tests.

## Migration

`0023_transfer_session_cleanup.sql` adds cleanup state, retry count/time and
completion time to upload sessions, plus an index. It retains the existing
Task22 schema marker, allowing the old Pages runtime to coexist while the
migration is applied. It was applied once to Preview and once to Production on
2026-09-28. Both environments subsequently reported no pending migrations.

## Production evidence before cleanup

Snapshot from Production D1/R2 on 2026-09-28, before the guarded cleanup:

| D1 resource | Count | Bytes / detail |
| --- | ---: | ---: |
| Active upload sessions | 8 | 2,682,662,157 declared |
| Of those still valid | 1 | 70,559,890 reserved |
| Of those expired | 7 | 2,612,102,267 ghost reservation |
| Published sessions | 12 | 2,363,618,519 historical declared |
| Aborted sessions | 2 | 839,733,447 historical declared |
| Expired sessions | 1 | 1,992,407 historical declared |
| Upload files | 24 | metadata rows |
| Upload parts | 20 | 281,107,709 recorded part bytes |
| Shares | 0 | 0 stored bytes |
| Orphan share files | 4 | parent shares absent |
| Download grants | 13 | 7 active-state, 6 completed; all past expiry |
| R2 committed objects, entire bucket | 54 | 548,275,190 |
| R2 `transfers/v2/production/objects/` | 0 | 0 |
| R2 `transfers/v2/production/files/` | 0 | 0 |

The apparent ~2.5 GiB was the declared size of expired upload reservations,
not published shares or committed transfer objects. R2's bucket lifecycle also
has the default seven-day incomplete multipart abort rule. The current valid
70,559,890-byte session was explicitly protected.

## Production cleanup

After Core CI and Preview verification, the Production Task22 Worker was
deployed with hourly cron `43 * * * *` (Worker version
`b8ec2856-2e09-45b2-8e09-795fe87c1e72`). The same tested cleanup code was
run once through remote D1/R2 bindings with before/after snapshots and
assertions that all still-valid session, share and grant IDs survived.

- Terminalized 7 expired active sessions.
- Retried and completed cleanup for 3 old aborted/expired/failed sessions.
- Removed 15 expired-session part rows and 4 orphan share-file rows.
- Removed 13 expired grant rows.
- Did not delete any valid session, share, grant, or committed R2 transfer object.

## Production evidence after cleanup

| D1/R2 resource | After |
| --- | ---: |
| Active upload sessions | 1 |
| Still-valid active bytes | 70,559,890 |
| Expired active sessions/bytes | 0 / 0 |
| Upload files | 24 |
| Upload parts | 5 / 70,559,890 bytes, all under the protected active session |
| Shares | 0 |
| Share files | 0 |
| Download grants | 0 |
| Pending session cleanup | 0 |
| R2 committed objects, entire bucket | 54 / 548,275,190 bytes |
| R2 transfer `objects/` and legacy `files/` | 0 / 0 bytes |

After synthetic Production browser testing, the test shares were revoked.
The same Production query again showed zero shares, zero expired active
sessions, and only the original valid 70,559,890-byte reservation. A separate
R2 read confirmed zero committed objects under the transfer `objects/` prefix.

That protected session naturally expired at 2026-09-28 13:40:33 UTC. The
scheduled Worker marked it `expired` with `cleanup_state=complete` at
13:43:59 UTC. On 2026-09-29 the original owner's reserved quota was therefore
zero, and there were no active sessions or expired active reservations.

For the pending Samsung acceptance, one separate test account intentionally
holds a password-free, seven-file, 14,051-byte share until
2026-10-06 06:20:26 UTC. It includes PDF, TXT, ZIP, DOCX, binary, MP4 and EXE
test fixtures. The link and file hashes were delivered outside Git in the
local `file-transfer-hotfix-device-share.json` artifact.
This deliberate fixture is the only current Production transfer share and is
not counted as an orphan or ghost reservation.

## Integrity matrix

The isolated D1/R2 service test asserts source byte length and SHA-256 equal
R2 byte length and SHA-256 equal downloaded byte length and SHA-256 for every
row below. It also checks original name/extension, MIME, Content-Disposition,
Content-Length, Accept-Ranges, range windows, cross-part range and idempotent
resume. Production browser tests independently checked source versus recipient
download for the listed examples.

| Format | Isolated source/R2/download | Production source/download | Name, MIME, range |
| --- | --- | --- | --- |
| JPEG | Match | Not repeated | Pass |
| PNG | Match | Not repeated | Pass |
| PDF | Match | Match: `3663f01c6363484a876579f2b593bde6e6fbc59aea891fe95c6fdc8841a8edf4` | Pass, Chinese/spaces |
| UTF-8 TXT | Match | Match: `ff74b2cb22f237dc28b02171bd06fc3f7415dc08bf0a77380099e6d5bd1ccc5e` | Pass, mixed LF/CRLF and emoji |
| MP4 | Match | Match: `904c7bbdac4db69a13f4cf63219e68844b999292fcdaf76064abeb3dea694793` | Pass, >16 MiB |
| EXE | Match | Match: `32eebb9b544628b7046287216f2c23fbd2aa585c6f506bf6203ac8b2f3ac6c97` | Pass, >16 MiB |
| ZIP | Match | Match: `6d0b8dfb2e01742e2e53b7af0a5cc200ca040a17cf8765df08c4559050fe25c9` | Pass, punctuation |
| DOCX | Match | Match: `d125bceb1a6b2d64d59cd5275ccaa5038d9d8c27373a7fa3aa806a5d3eb7d2bc` | Pass, Chinese |
| Random/binary, including 0x00/0xff | Match | Match: `7ee29dc0e1b070924f02d7fa44e7b7acf406b081cf22cbd7da8ea0bd1d71ee32` | Pass |

## Browser E2E

- Local and real Preview/Production: a fresh browser context without owner
  cookie or localStorage opened `/transfer#share=<id>`, saw metadata, authorized
  and downloaded EXE/MP4 across the 16 MiB boundary. SHA-256 and byte length
  matched the source. The Production test then cancelled a single upload,
  replaced a two-file session, deleted one file, re-uploaded the survivor, and
  cancelled it. Both reservations reached zero. It revoked its synthetic share
  and checked stored and reserved bytes returned to zero.
- Preview and Production: a valid upload session with part 1 already uploaded
  survived a full page reload. Reselecting the original file reused the same
  session and part 1, uploaded only part 2, then produced an anonymous download
  with matching 17,104,896-byte length and SHA-256
  `a215d9d54dd4ab969e22ac3e7ccc67ce9f99caa017bbfdd29f73ec30c7bede8a`.
- Production PDF, TXT, ZIP, DOCX and binary recipient downloads also passed in
  a fresh logged-out browser context. Synthetic shares were revoked.
- Production guest API: the unfinished-session list returned the newly created
  4,096-byte reservation under the same session ID; abort immediately changed
  `reserved_bytes` and `used_bytes` to zero.

## Android tests

- JVM unit tests cover exact HTTPS origin, malicious URLs, query+fragment
  preservation, cold/warm route selection, public `/transfer` shell routing,
  private-route restrictions, and UTF-8 DownloadManager filename parsing.
- Full `testDebugUnitTest`, `lintDebug`, and `assembleDebug` passed locally
  and in Core CI. Android instrumentation and physical WebView/DownloadManager
  download behavior remain **UNVALIDATED** while no device or AVD is attached.
- Signed hotfix candidate: `uk.thewyj.app` 1.3.20 (33), Production base
  `https://thewyj.uk`, 47,676,905 bytes, SHA-256
  `8a92a7b2ba54224528d010e12dbe9cdccd756ae5882923b093166ff05ff6ed13`.
  The release certificate SHA-256 is
  `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`.
  A byte-identical `thewyj-android-1.3.20-file-transfer-hotfix-candidate.apk`
  was delivered in the user's local artifacts directory, outside Git.
  The old formal release remains 1.3.19 (32); formal Android update metadata
  must remain unchanged until the user decides a release.

## CI and Production deployment

- Runtime commit `ecf03ee`: Core CI run
  [36413890813](https://github.com/WYJ0904/thewyj.uk/actions/runs/36413890813)
  passed all six jobs after retrying one unrelated, nondeterministic vocabulary
  rejudge browser case on the identical commit. No vocabulary logic was edited.
- Test-only PR head `de0ed14`: Core CI run
  [36416094741](https://github.com/WYJ0904/thewyj.uk/actions/runs/36416094741)
  passed all six jobs on the first attempt.
- Production Pages deployment:
  `431603bb-f33b-4518-9669-d7c467543686`, source `ecf03ee`.
  The live `https://thewyj.uk` HTML/config uses
  `20260928-transfer-hotfix-r1`; transfer capabilities report the new quota
  fields. `/api/app/config` still advertises Android 1.3.19 (32).
- Preview Pages, migration and cleanup Worker were verified before Production.
  The Production cleanup Worker health endpoint returned the expected
  Production identity. The registered `43 * * * *` cron actually ran on
  2026-09-28 at 11:43:56 UTC with outcome `ok`, no exception, and Worker
  version `b8ec2856-2e09-45b2-8e09-795fe87c1e72`.

## Remaining manual acceptance

The signed APK is delivered. The smallest Samsung test remains:

1. Install the signed candidate in place and sign out of the app.
2. Open the prepared share link from the delivered JSON in Chrome; verify it remains in Chrome and
   downloads PDF plus MP4 or EXE without login.
3. Explicitly open the same link in the thewyj app; verify the correct share
   appears with fragment intact and no login, then download PDF plus MP4 or EXE.
4. Cancel one in-progress upload and verify the visible reserved quota drops.

Do not mark this hotfix COMPLETE or merge PR #79 until these physical checks
pass. Task 25 remains outside the hotfix.

## Samsung follow-up, 2026-09-29/30

The preceding release evidence is historical. The user installed 1.3.20 (33)
and reported that the public-share routing test passed and small downloads
succeeded. A real camera MP4 subsequently failed in the app. The original
camera file was 188,140,359 bytes; the phone's downloaded copy was **0 bytes**.
This is a physical download failure, regardless of successful upload metadata.
The displayed 179.4 was MiB, while the camera app displayed decimal MB; it was
not evidence of missing upload bytes. The web UI now labels binary units
explicitly as KiB/MiB/GiB.

Corrections in the follow-up:

- WebView share attachments use a narrowly validated, same-origin native range
  downloader. It probes the full Content-Range total, validates every range,
  resumes interrupted reads from the last byte written, and publishes a
  MediaStore Download only after the complete byte count is written. Failed
  downloads remove their own incomplete destination and report failure.
- The Android web page always selects the native attachment route rather than
  an advertised File System Access picker. Download progress/completion/failure
  is shown on the page. Other download URLs retain their existing handler.
- An abandoned initial attachment GET no longer completes its grant or retires
  the share before the response body has been consumed. Cleanup protects an
  unexpired authorized grant. A red regression reproduced an abandoned GET
  retiring a share; the corrected service passes the same test.
- Recipient retry/multiple-file clicks reuse the same unexpired grant in memory
  instead of consuming another download authorization. No bearer tokens are
  added to logs, Git, or persistent client storage.
- Published filenames are shown in My Shares, the current share card is brought
  into view, and the owner can revoke it there. Public recipients cannot see the
  owner action. Published files remain immutable; replacing them requires a new
  share.
- Asset version is `20260929-transfer-hotfix-r2`. Formal Android release
  metadata remains 1.3.19 (32).

The follow-up's Android JVM downloader regressions, full unit suite, lint,
debug build, Task22 service and integrity tests passed. Core CI on `382e640`
([36565221482](https://github.com/WYJ0904/thewyj.uk/actions/runs/36565221482))
and `560b30a`
([36566021521](https://github.com/WYJ0904/thewyj.uk/actions/runs/36566021521))
passed all six jobs, including the browser transfer round trip. The final
layout/test/report commit still requires its own CI run.

No new migration or user-data cleanup is required by these corrections.
The current follow-up has **not** yet been deployed to Production. The last
Production access attempt returned Cloudflare authentication error 7403;
deployment and renewed live checks must be recorded separately from local/CI
evidence. The large-file native download remains **UNVALIDATED** until the new
signed candidate is installed on Samsung and its downloaded file is checked.

## Separate pending-identity follow-up

The user's Android and Finance lists both contained seven canonical pending
records; the complaint concerns duplicate-looking content. The separate Draft
[PR #80](https://github.com/WYJ0904/thewyj.uk/pull/80) is stacked on this hotfix
and permits reconciliation of two amountless hints only when their event IDs
map to the **same locally archived notification instance**. Existing package,
direction, provider-reference, amount-conflict and lifecycle-window guards
remain. Distinct archive instances are retained, even at similar times or with
the same amount. Android displays seconds to match Finance's precision.

JVM and D1 regressions cover same-instance amountless updates and a separate
nearby payment that must survive. This is not a general amount/time merge, and
the specific Samsung records are not claimed to be duplicates without the
archive-instance evidence. Task 24 remains COMPLETE; Task 25 is unchanged.
