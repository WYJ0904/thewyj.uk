# Task26 execution record

- Released base main:550bc41bbaa01751d75c109f3246b9e174e4460d; Stable1.3.37/50.
- Independent branch:codex/task26-adaptive-learning-mastery.
- Release B Closure archived in2bb0574 and [PR104](https://github.com/WYJ0904/thewyj.uk/pull/104#issuecomment-6096339363); PR/main CI38041538855/38042322159 both8/8.
- Current stage:server API, additive migration and Web UI implemented; isolated D1/client acceptance passed; real-browser matrix and final exact-source CI are being completed. No Task26 Production write, remote migration, Android pointer or Task27 work.
- Existing English/Japanese custom quiz, wrong-book/rejudge, Task11 history/sync and language entitlements will be retained. Server-issued adaptive tickets/events become the mastery authority; client historical correctness is not silently promoted into authoritative score.
- Actual missing resources:Wrangler not authenticated; Actions Cloudflare/signing/Admin inputs all false; secret/variable listing403. Pages Git deploy and GitHub repository operations work. Hosted D1 migration, privileged Preview acceptance and any required new original signing remain separately gated.
- See TASK26_DESIGN.md for algorithm/data/API/UI/test matrix and release boundaries. Implementation/tests/Preview/Production statuses remain IN_PROGRESS/NOT_EXECUTED until actual evidence.

## Engine checkpoint

Pure mastery-v1 reducer and deterministic adaptive selector implemented;29 acceptance groups PASS. Reviewed English/Japanese catalog currently62 knowledge points/124 question variants, reusing existing rubrics/canonical Japanese forms plus explicit vocabulary/grammar/examples/confusion sets. Correctness uses course-owned deterministic answers, not AI. Repeat cooldown survives arbitrarily many duplicate attempts, effective evidence is capped per point/day, and mastery requires spaced diverse evidence. Current source is a verified implementation checkpoint, not full API/UI/Preview/Production acceptance.

## API/D1/Web checkpoint — latest user scope

Continue this branch and deliver a Draft PR plus complete handoff. Do not merge, deploy Production or start Task27. Reuse unchanged passing evidence; rerun only affected suites after actual changes and required CI on the new source.

- 0025 SHA256:4664bbc91a8d1b6158ee58532186b38c870cb677c17c289e072e1cb4afd4adef. Official Wrangler local migration ledger successfully applies001–0025; isolated migration replay preserves every pre-existing table row and old Task25 definitions. Remote Preview/Production migration NOT_EXECUTED.
- Authenticated adaptive ticket/event/mastery/review/reconcile/explanation APIs use existing language memberships, Task25 decisions and D1 rate limits. Canonical answer grading is server-only. Twenty-six isolated D1/API acceptance groups PASS, including concurrency, digest conflict, receipt replay, projection-failure recovery, privacy, flags, real AI timeout/cache/fallback and120-event/four-query recovery.
- Seventeen client acceptance groups PASS: account isolation, stable event/outbox recovery, bounds, malformed data, stale-state rejection and delayed-response account switch. The UI reuses the language workspace and displays explicit pending sync; no client mastery calculation. Atomic per-account Web Locks prevent multiple-window outbox clobbering.
- CI includes the Task26 unit/D1/client/browser suites and enables all eight existing Core jobs for this branch. Android native implementation, release metadata, original signer, R2 key and Stable50 pointer are unchanged. CI compilation/emulator regression is distinct from Samsung acceptance; no new binary promotion is planned.
- Production root and production environment TASK26_ADAPTIVE_LEARNING_ENABLED remainfalse. Preview eligibility istrue but all five new feature definitions are OFF/0%/Experimental-only. No new flag is actually enabled in a remote environment.
- LOCAL_REQUIRED:legitimate Cloudflare management access for remote Preview migration/ledger/bookmark verification; hosted privileged Admin session; Task26 Samsung/WebView observations if required for final product acceptance. Missing resources block only dependent gates. No local PC credential or cookie export is requested.
- Browser screenshot/runtime and final CI references will be attached to the Draft PR and final handoff. Earlier local QA failures remain in scratch evidence: incorrect theme-cycle/element assumptions and a CSP-blocked inline test style were corrected using actual DOM readiness and a DevTools font-size probe; CSP was not relaxed and runtime-error assertions remain intact.

## Draft delivery checkpoint

- Draft PR105 is OPEN; main remains550bc41. All code checkpoints are pushed on the same Task26 branch. No Ready/merge/Production/Task27 action.
- 38053153749 failed old Release B asset-token assertions;678d646 corrected the static release-consistency fixture with all checks intact.38053754900 passed six jobs but failed application cache lookup and parked-row module identity: browser QA loaded old query URLs, which instantiated a different WeakMap module than the current imports. QA now resolves the unique ASSET_RELEASE consistently; expected retained identity/draft/empty behavior is unchanged. Both failed runs remain available.
- New read-only cloudflare/task26-preflight.sql and task26-schema-verification.sql executed successfully in the isolated official D1 state. Four tables/four indexes/one trigger, exact metadata, invalid rows0 and pending receipts0 observed. No remote ledger/write claimed.
- Local real Chromium390/768/1366/1920 acceptance passed after the actual offline durability fix;320 prior same-CSS checkpoint retained. Final CI executes the whole five-width matrix on its actual source.
- Complete Windows/Preview/physical recovery steps and immutable Stable50 boundaries are in TASK26_HANDOFF.md. Non-sensitive evidence is in docs/releases/task26/2026-10-10; secrets remain outside Git.
- Additional review reproduced a same-account multi-window UI bug: storage events loaded cache but did not hydrate the acknowledged receipt/new ticket, leaving an already-answered question editable. Fixed hydration aborts stale requests, locks completed tickets, clears a draft when the ticket changes, and avoids reciprocal storage-triggered fetch/write loops. Two new focused controller regressions pass; previously passed unchanged suites were not rerun locally. Runtime assets/SW advanced together to Task26r2 so existing Preview caches cannot retain the old controller. Full final-source CI will confirm the integration.
