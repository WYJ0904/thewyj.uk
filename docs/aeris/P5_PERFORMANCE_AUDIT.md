# P5 Web performance and architecture

## Accepted base and evidence scope

P4 final/main `4127b7a8165bbcab8f378f025897dd19400e116d` was fetched and
independently checked: PR #91 merged, main Core CI 37351635026 six jobs successful,
Production fdc048f4 / source 4127b7a, formal APK 1.3.30/43 and accepted SHA.
The Samsung remained connected. Before P5 implementation its current summary
and Finance identities matched at 3, with two independent recovery identities.
No previous long acceptance was repeated. P4 previous-phase gate is PASS.

The immutable P5 base is a Git archive of that exact commit. Raw before/after
data are retained privately in artifacts/aeris-p5 and artifacts/aeris-p5-device.
Desktop and 390px measurements are real Windows Chrome/CDP with isolated local
Pages D1/R2 and explicit synthetic ledger/review presentation records. These
measurements do not establish Android or WAN speed. Device measurements use
the formal APK, actual Samsung and current Production account/API; only static
branch assets are substituted before publication. No raw payloads are logged.

## Findings and changes

- Guest home initially generated 103 hidden catalogue cards: 4,446 connected
  elements, 3,612 hidden, 46 JavaScript resources. After visiting workspaces,
  authenticated home retained roughly 5,700 elements. Lazy feature ownership
  avoids the initial catalogue mount and workflow evaluation. The existing
  owners keep their stores, identity decisions and API contracts.
- Catalogue generation moved to entry initially made the first entry slower.
  Profiling separated layout from the access/preferences requests. Public
  catalogue preparation now runs alongside the existing permission check for
  already-entitled accounts. A 24-row initial batch preserves all 103 tools,
  search and direct links. Explicit append preserves prior row identities.
- Inactive heavy generated lists are parked as original DocumentFragment nodes
  and resumed without cloning. This reduces connected hidden DOM/style work;
  it deliberately preserves memory for draft/row identity, not a claim of zero
  detached memory. Account reset discards presentation references.
- Shared authenticated-home rendering now has one presentation owner, keyed
  shelves and equal-value text elision. Account/session/domain state stays in
  its original owners. No second router or state framework was introduced.
- A 32 MiB MD5 call caused a 769 ms main-thread task. Large MD5 work uses a
  bounded worker with the same existing algorithm and a transferable buffer.
  Worker is terminated on success, error or timeout. SHA and multipart part
  size/concurrency/integrity have not changed. Equal output verified.
- Durable equal-value writes are elided only when readable persistent storage
  agrees. Failed persistence remains retryable; queue coalescing/crash recovery
  stay with the existing transfer owner. Hidden transfer views no longer make
  unused capability/share reads on an account callback.
- Audited all five stylesheet roles. Removed only 94 earlier declarations
  duplicated by an identical selector, condition, property and value in a later
  layer; fallback values and specificity/conditional differences retained.
  DS2 remains canonical and stylesheet order unchanged; no DS3 or visual redesign.
- Existing single-flight data owners and account-scoped caches are retained.
  Repeated serial permission reads are freshness checks; no permission, finance,
  membership or share/revoke TTL cache was added to conceal them.

## Preliminary comparison

| Measure | Immutable P4 base | P5 working implementation |
| --- | ---: | ---: |
| Guest home connected elements | 4,446 | 3,133 |
| Guest home hidden elements | 3,612 | 2,301 |
| Guest executed/requested JS resources in frame | 46 | 33 |
| Hidden initial catalogue cards | 103 | 0 |
| Auth home after workspace cycle | about 5,700 | about 3,235 |
| First tools settled-ready (includes fixed 160 ms settle) | 245–276 ms | 200–216 ms |
| Initial catalogue batch | 103 | 24, append to 103 |
| 32 MiB MD5 main-thread long task | 769 ms | none observed |
| MD5 elapsed | 808 ms | about 830 ms |
| 200 MiB + 32 KiB upload durable writes | 22 | 19 |
| Numeric upload queue root rewrites | 0 | 0 |
| Both download SHA-256 round trips | PASS | PASS |
| Active global intervals / observers | 1 / 2 | 1 / 2 |

Authenticated home still loads owners needed to display its cached summaries;
resource counts there are not claimed lower. Baseline/final cold startup,
trusted first interaction, raw CDP script/style/layout/heap and route samples
are in the JSON artifacts. Settled-ready includes test settle and is not touch
latency. No overall hash throughput or WAN transfer improvement is claimed.

## Regression and gates (in progress)

Targeted ownership tests, core/session/storage tests, financial model and P4
canonical/recovery tests passed. Actual browser contracts preserve all 103
tools, workflow deep link, parked node identity, candidate draft and no runtime
errors. P1/P2/P3.3 and P4 browser regressions passed. 390/1366/1920 light/dark
nine-workspace before/after matrix passed without horizontal overflow.

Android inputs have no changes. Local full 512 tests/lintDebug/assembleDebug
passed after a no-cache rerun corrected missing cached class outputs. The
existing signed 1.3.30/43 binary remains applicable; no debug APK is installed.
Current working device comparison preserved canonical 3 and recovery 2.
Final CI, device, publication and closure are recorded separately when complete.

No server protocol, D1 migration, Android recognition/OCR/accessibility,
auto-booking rules, historical Room keys, payment/ticket IDs, raw notification
privacy rule, repository/domain/package or durable storage IDs changed.
Production/user records are not used as destructive fixtures. P6 and Task 25
remain unstarted.
