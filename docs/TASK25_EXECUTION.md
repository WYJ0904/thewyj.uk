# Task 25 cloud execution

Updated: 2026-10-07 (UTC). This file is the recovery entry point for this task.

Latest continuation: [saved full Closure6043762841](https://github.com/WYJ0904/thewyj.uk/pull/96#issuecomment-6043762841), source88d4661 / CI37660529040 8/8 SUCCESS, derived from the user's original156bc29 baseline. Independent hosted preflight and management-quota repair are recorded below; the newest PR96 full Closure supplies exact resulting HEAD/CI/Preview/artifact IDs. PR remains Draft, main efc05c3 and Stable1.3.33/46 preserved. Task26 starts automatically only after full Task25 release/physical/final-main acceptance PASS; it has not started. Earlier sections retain historical evidence.

## Baseline and scope

- Repository: `WYJ0904/thewyj.uk`.
- Base/main HEAD: `efc05c3596c83a12d668911c5f891d2d5f3c395a`.
- Working branch: `codex/task25-flags-release-channels`; initial checkout clean.
- Base Core CI: [37439956942](https://github.com/WYJ0904/thewyj.uk/actions/runs/37439956942), SUCCESS, 6/6.
- No open/draft PR at discovery. Task 24 is COMPLETE (final report supersedes its historical blocked checkpoints).
- No original Task 25 plan or implementation was found in repository files/branches/issues. Implementation follows the explicit cloud handoff requirements: server evaluated feature flags, administration API/UI, account release channel, deterministic rollout, kill switch, native/WebView agreement, migrations, release protection and inspectable acceptance evidence.
- Task 26 has not started.

## Experience Pass recovery

P1–P6 are complete. Do not restart them from old audit-file checkpoints.

| Phase | Authoritative evidence | Recovered state |
| --- | --- | --- |
| P1 | Merged #81/#82; subsequent P3 baseline and final P6 regression closure | PASS, reused |
| P2 | Merged #83/#84; P3 baseline verifies P2 device and CI closure | PASS, reused |
| P3 | Merged #85–#89; final P6 regression closure | PASS, reused |
| P4 | [Final #91 closure](https://github.com/WYJ0904/thewyj.uk/pull/91#issuecomment-6000766047) | PASS; supersedes earlier BLOCKED reports |
| P5 | [Final #92 closure](https://github.com/WYJ0904/thewyj.uk/pull/92#issuecomment-6005610641) | PASS |
| P6 | [Final #93 closure](https://github.com/WYJ0904/thewyj.uk/pull/93#issuecomment-6007877132) | PASS; Experience Pass COMPLETE |
| Later home fixes | [#94 closure](https://github.com/WYJ0904/thewyj.uk/pull/94#issuecomment-6011384160), [#95 closure](https://github.com/WYJ0904/thewyj.uk/pull/95#issuecomment-6013409430) | Merged, CI/device/Production closed |

Historical Windows artifact paths are not cloud prerequisites. GitHub source, closure comments and current public artifacts are the recovery evidence.

## Environment discovery

| Capability | Actual observation |
| --- | --- |
| GitHub clone/read/write | Clone/read and REST Git-object fast-forward writes work; draft [PR #96](https://github.com/WYJ0904/thewyj.uk/pull/96) created |
| Actions / PR | API and logs readable; Core CI and signed candidate workflows exist |
| Repository secrets | `gh secret list` returns HTTP 403 `Resource not accessible by integration`; secret names/values cannot be enumerated |
| Signing CI | Fresh Task 25 run [37505069396](https://github.com/WYJ0904/thewyj.uk/actions/runs/37505069396) failed at Validate signing secrets: `THEWYJ_ANDROID_KEYSTORE_B64` missing; CI discovery proves all four required signing secrets absent |
| Cloudflare | Wrangler 4.118.0 not authenticated. Existing Git integration **does** deploy Pages Preview automatically; API administration remains unauthenticated. Dashboard link identifies account `97c274a981e8dd6703aa6388e11c4614` |
| Existing infrastructure | Pages project `thewyj-uk`; preserve existing Pages/D1/R2 deployment system |
| Preview | D1 `wyj-cloud-preview` / `a3e6253b-689f-49f3-998b-7c5828ea255a`; R2 `wyj-cloud-preview` |
| Production | D1 `wyj-cloud-production` / `11c288d8-c584-409f-bb1f-7e7af11793e5`; R2 `wyj-cloud-production` |
| Production read access | Public app config is HTTP 200 using curl; initial Python urllib request was 403, so that client failure does not establish a Production outage |
| Android | SDK 36/build-tools 36.0.0/platform-tools installed; complete Temurin JDK 21 installed because original Java runtime lacked javac |
| Gradle | Wrapper 9.4.1 exercised; 520 JVM tests PASS (76 XML suites), lint PASS (0 errors), debug/instrumentation/release APK/AAB builds PASS |
| Signing locally | Existing environment-based signing config preserved; no local release signing credentials configured |
| Instrumentation | Local machine has no `/dev/kvm` or Samsung; GitHub Android 11 software emulator executed all 19 shared vectors successfully ([runtime job](https://github.com/WYJ0904/thewyj.uk/actions/runs/37505935692/job/112415101968)) |

## Stable Android protection

Current Stable: `uk.thewyj.app`, 1.3.33 / 46, `app/android/thewyj-android-1.3.33.apk`, 47,893,965 bytes, SHA-256 `17da079bc7428dc87b1b0b2141ca011f6297101fba3a5d2cc6bbac3fe289048c`.

Preserve `android/release-metadata.json`, existing `ANDROID_*` bindings, Stable object/download pointer and signing identity. Task 25 candidate will use separate metadata/artifacts (1.3.34 / 47). No candidate may become Stable without the actual release gate.

## Current stage

Software implementation and automatic acceptance complete. Final software commit `c2a4801` Core CI [37512761641](https://github.com/WYJ0904/thewyj.uk/actions/runs/37512761641) SUCCESS, 8/8 including both browser regression jobs and Android runtime. Hosted Pages Preview deployed by the existing Git integration. Actual 2026-10-07 Preview browser/native/WebView features all return 200 with matching identity/decisions, and Beta/Experimental/Stable preferences pass; this supersedes yesterday's schema-not-ready checkpoint. Hosted administrator rollout, direct migration ledger inspection and Production preflight/migration remain unexecuted because authorized administration credentials are unavailable. Production migration/deployment have not been performed. Final blocked-release [closure](TASK25_CLOSURE.md) records completed work, evidence and external gates. No real user data has been used as a test fixture.

Planned gates:

1. Add idempotent, additive migration and authenticated, audited feature flag/channel contracts.
2. Implement admin/user UI and native consumer with fail-closed account isolation.
3. Test global OFF/ON, override, Stable/Beta/Experimental gating, percentage boundaries/determinism and kill switch, plus security/concurrency/regressions.
4. Run local isolated Pages/D1/R2 preview, browser and Android unit/lint/build checks; run GitHub CI and signed candidate workflow where authorized credentials permit.
5. Inspect Production schema before any migration; deploy only with existing credentials and passing gates. Never reset D1.
6. Save final evidence and `docs/TASK25_CLOSURE.md` to GitHub.

## Current blockers and device boundary

- Cloudflare API/D1/R2 administration lacks credentials; Pages deployment and hosted Preview user/channel/identity contract are PASS. The remote administrator rollout gate is unexecuted; direct Preview ledger and Production schema inspection/migration remain unauthenticated. Do not restore the superseded Preview schema-not-ready blocker.
- Workflow dispatch works. Fresh signing workflow and CI discovery prove required signing credentials absent; release signing is blocked without changing the Stable identity.
- Physical acceptance is NOT EXECUTED: current Stable → candidate in-place Samsung upgrade; final signature/install compatibility; Back/Resume; actual Samsung WebView; real offline/recovery; haptic/system permissions. These remain separate from software checks.

Resume by reading this file, git status/log, main HEAD, open PR and Actions results. Continue from completed gates; do not repeat predecessors or advance Task 26.

## Software implementation checkpoint

The additive `0024` migration, server evaluator, audited admin API/UI, account channel UI, native memory-only consumer and shared contract vectors are implemented. Global OFF, kill switch and excluded channels cannot be bypassed by a user override. Configuration revisions prevent lost writes; a transaction nonce prevents a losing override write from using the winner's revision.

Validated in cloud so far:

- D1/API: 12 acceptance groups, including genuine synthetic Android device-session access, WebView cookie and browser token producing the same canonical evaluation; rate limits, CSRF, isolation, concurrency, audit and migration replay.
- Web/native shared vectors: 19 cases; Web parser, Android JVM and Android 11 runtime PASS.
- Local isolated Pages/D1/R2 migration: all 24 files applied; never Production D1.
- Initial Kotlin compilation PASS. Full Gradle tests/lint/build now use a downloaded complete JDK 21; the environment's original Java runtime lacked `javac`.
- Stable metadata: all 36 consistency checks PASS. Complete public Stable download and certificate verified: SHA `17da079bc7428dc87b1b0b2141ca011f6297101fba3a5d2cc6bbac3fe289048c`, certificate `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`.
- Web generation: `20261006-task25-flags-1`; added modules are precached. Business-module edits outside Task 25 are generation strings only.

Git HTTPS push failed (401); exact local Git objects/commits are uploaded through the authenticated GitHub REST Git API, with a fast-forward and expected-head check. This preserves commit SHAs and avoids a local-only handoff.

Actual Pages project listing, remote Production D1 inspection and remote R2 object access each reject the operation because `CLOUDFLARE_API_TOKEN` is absent. No temporary account, parallel deployment, Production migration or R2 write is used. A CI credential-presence job and the existing signed-candidate workflow will test repository/CI credentials separately; absence in the cloud shell is not treated as proof about GitHub Secrets.

Actual Chromium Pages acceptance PASS at 390/1366px. GitHub PR #96 is draft. Initial Core CI [37505064825](https://github.com/WYJ0904/thewyj.uk/actions/runs/37505064825) found the emulator job's `sdkmanager` PATH error; repaired by resolving the runner's installed SDK tool explicitly, matching the existing Android build job. No failing product assertion was removed.

CI credential discovery completed successfully and its artifact/log proves all six standard Cloudflare/signing bindings are absent. The discovery job being green means the check ran, **not** that remote feature acceptance or deployment passed. Repository environments are empty; secrets enumeration remains 403. Its original `remote_preview` field was an inference about API credentials, superseded by the actual Git integration/HTTP probe below; the workflow now reports D1/R2 administration separately. Machine-readable evidence is stored under `docs/task25/evidence/`.

Historical 2026-10-06 hosted Preview [c4838955](https://c4838955.thewyj-uk.pages.dev) deployed commit `13b952fd64e502aec6af0e800c9a4a3be737d5da` successfully. Status proved environment `preview`, D1/R2 bindings and Task 25 master ON. The synthetic ordinary user probe had browser/native login PASS, anonymous 401, ordinary admin 403 and all three feature consumers `503 task25_schema_not_ready`. Preserve this evidence, but the 2026-10-07 real 200/channel acceptance below supersedes that blocker. One earlier probe also created a synthetic account before correcting its native client/device request; no real user record was changed.

Candidate 1.3.34/47 unsigned APK/AAB build PASS and actual package/version verified. Hashes and unreleased metadata: `docs/task25/evidence/candidate-local-metadata.json`. Stable metadata/config remains unchanged; final public download hash equals discovery. GitHub also stores the candidate in [Android artifact 11432003030](https://github.com/WYJ0904/thewyj.uk/actions/runs/37505935692/artifacts/11432003030) (90-day retention).

Remaining external gates: remote D1 schema/migration administration, existing identity release signing, and physical Samsung acceptance. Local software, CI, emulator and unsigned candidate are complete; full software release acceptance and overall release remain BLOCKED. They are additional to the device boundary, so the device-only SOFTWARE PASS formula cannot be used. Do not start Task 26.

## Final-branch CI follow-up

Report commit `1a30f17` triggered [37509287826](https://github.com/WYJ0904/thewyj.uk/actions/runs/37509287826). Its first attempt caught a pre-existing P33 hard-reload visibility/layout race; the second passed P33 but the Wrangler Pages development proxy crashed with connection resets/broken pipes during P4. These attempts are failed and are not represented as 8/8 PASS. The earlier code acceptance [37505935692](https://github.com/WYJ0904/thewyj.uk/actions/runs/37505935692) remains genuinely 8/8 PASS for the pinned candidate.

The Pages CI job now uses Node 24, matching the cloud workspace. P33 waits for the restored home to be visible and allows its existing ResizeObserver/frame layout to settle before geometric snapshots, including viewport changes. Every original geometric/session assertion remains. Local P33 passes all guest/authenticated/reload cases; P4 passes 390/1366/1920px on the persistent Node 24 Pages fixture. Product code, migrations, candidate and Stable metadata are unchanged. Final software branch `c2a4801` run [37512761641](https://github.com/WYJ0904/thewyj.uk/actions/runs/37512761641) actually completed SUCCESS, 8/8. Evidence-only follow-up commits use latest branch Actions and the PR #96 closure addendum as their check source.

## 2026-10-07 recovery and hosted acceptance

Recovery confirmed clean `codex/task25-flags-release-channels` at `c2a4801`, unchanged main `efc05c3`, open Draft PR #96 and final software CI 8/8 SUCCESS. The existing [takeover comment](https://github.com/WYJ0904/thewyj.uk/pull/96#issuecomment-6023232280) also records that CI outcome; its remote schema assumption is now superseded by the actual API probe.

Immutable [Preview 8e567f72](https://8e567f72.thewyj-uk.pages.dev) proves environment=preview, D1/R2 bindings and master ON. A single additional synthetic Preview account passed registration/browser/native login, ordinary admin denial, all three identity consumers and Beta → Experimental → Stable changes. Its newly created sessions were revoked. See `docs/task25/evidence/hosted-preview-smoke-20261007.json`. This proves the live schema marker and user read/write contract are available; this Codex did not execute a remote migration and cannot establish its executor/time/ledger without management credentials.

Current environment status lists no configured credentials/identities. Latest CI readiness artifact `11435633925` confirms six standard bindings absent. Fresh `wrangler whoami` is unauthenticated and an actual `--env production --remote` read-only Task 25 table inspection rejects missing token. No temporary Cloudflare account, parallel infrastructure, Production SQL mutation or Stable write was performed. Existing Production status/config remain 200 with every app release field equal to the discovery baseline. adb lists no physical device. See `final-state-20261007.json` and `cloud-readiness.json`.

Evidence-only commit `d7a5f3f` run [37615300468](https://github.com/WYJ0904/thewyj.uk/actions/runs/37615300468) passed 7 jobs but exposed a P1 test observation race: the 250ms persistence coalescer can lag the already painted percent, so a newer stored acknowledgement is not necessarily newer than the display. The repair waits for the acknowledged percentage to exceed the suspended displayed percent, retains every original assertion, and records held/hidden/resumed diagnostics. Actual isolated Pages/D1/R2 Chromium P1 regression PASS; see `p1-resume-regression.json`. Product code and Stable/candidate configuration are unchanged. This failed run is retained; latest repair CI and final closure addendum are authoritative for the final branch.

Repair commit `91072ea` run [37617315706](https://github.com/WYJ0904/thewyj.uk/actions/runs/37617315706) passed P1 in CI (display held at 16%, resumed to 32%, session preserved) but later failed the P5 catalogue row identity assertion; overall run FAILURE, 7/8 jobs. P5 now waits for the authenticated owner's preference cache and all 103 rendered rows to reflect that cache before capturing unchanged-model identity. All original tools/Finance identity, workflow and draft assertions remain; failure diagnostics contain only row state, never credentials. Local final browser check PASS; see `p5-hydration-regression.json`. Tools/Finance/product code and Stable configuration remain unchanged. Latest branch Actions and final PR closure addendum are the final check source.

## Release preparation continuation — 2026-10-07

User-directed baseline is `a95409e`, saved closure, PR #96 and final GitHub acceptance. Discovery confirms main `efc05c3` unchanged, worktree initially clean, PR open/Draft/unmerged, `mergeable=true/clean`, 0 commits behind main; read-only `merge-tree` succeeds. Managed cloud configuration contains no credentials/identities, six standard local credentials absent, secrets/vars enumeration 403, no repository environments, Wrangler unauthenticated, physical adb list empty. Existing Preview Git deployment at source `a95409e` is successful (`1957ea8e`); current Production public status/config remain 200 and exact app fields unchanged. No new Production migration/deployment is performed.

Completed release audits cover Production binding separation, migration/schema compatibility/replay/rollback, old-client availability, safe channel/percentage defaults, original signing inputs, 46→47 upgrade prerequisites, kill emergency path, audit atomicity, R2 ordering and failure recovery. Existing deployment system has no separate publish workflow: Pages Git integration plus the same-project Wrangler path and signed-candidate Actions are recorded in the plan.

Repairs: moving `/api/app/download` uses `private, no-store` so an old cached APK cannot outlive new release metadata; signed workflow uses advancing candidate properties without patching Stable Gradle defaults, validates HTTPS origin, verifies both original APK and AAB signatures, hashes both and cleans the original keystore. Candidate staging independently checks APK manifest and original verified signatures and records source SHA. No Kotlin/feature evaluation redesign or Android Stable metadata change.

Added `npm run test:task25-release`: 5 actual isolated D1/R2 resilience groups and 12 signing/proposal gate tests PASS. The SQL uses Wrangler's real splitter/Miniflare batch; fault at the transaction end rolls back schema, seeds and ledger, retry succeeds, replay preserves operator state and all preexisting business rows. Injected audit failure cannot partially commit state; master OFF/D1 failure still serves old-client config/download. Mocked signature/receipt tests are refusal-path evidence, not actual signing/device PASS.

`remote-admin-smoke.py` runs unchanged against a deliberately selected existing environment, proves authorization before fixture creation and only uses a new synthetic account/harmless unconsumed flag. Actual local development execution PASS for all 8 contract checks and safe cleanup. CI runs it against isolated development only; hosted Admin API/UI remain unexecuted. `prepare_task25_android_release.py` produces an atomic, reviewable file bundle outside the checkout only after all real gates and exact signed Production R2 readback match; it does not deploy/upload/change Stable. Template remains NOT_EXECUTED/BLOCKED.

Related local validation: original 12 D1/API groups and 19 shared cases PASS; Task 20's 18 groups/Android contract PASS; 36 Stable consistency checks plus checker regression tests PASS; Pages Functions compiles. Existing 520 JVM/emulator/browser evidence is reused; full new branch CI verifies the relevant workflow/candidate changes. Local unsigned APK passes actual staging/manifest/hash guards; it remains unreleased. See `release-preparation-20261007.json` and `local-admin-release-smoke.json` for safe evidence.

Remaining independent blockers: hosted admin session, Cloudflare administration credentials, original four signing secrets, physical Samsung. Concrete next commands per gate and strict release order are in [TASK25_RELEASE_PLAN.md](TASK25_RELEASE_PLAN.md); current closure remains SOFTWARE IMPLEMENTATION/AUTOMATED TESTS PASS, full SOFTWARE BLOCKED, PHYSICAL BLOCKED/NOT_EXECUTED, RELEASE BLOCKED, Task 26 NO.


## Final release closure preparation continuation — 2026-10-07

Continue only from `156bc29b1711d66ab42e8eceeb8e476da5ad5239`, PR #96 and [final acceptance 6040667270](https://github.com/WYJ0904/thewyj.uk/pull/96#issuecomment-6040667270). Fresh discovery confirms clean initial tree/branch, unchanged main `efc05c3`, Draft/open/unmerged/clean-mergeable PR, no behind-main drift and CI 37638087020 still 8/8 SUCCESS. Actual final candidate ZIP/APK/AAB hashes and package 1.3.34/47 match saved evidence; APK verification independently rejects its unsigned state. Actual existing Production APK download remains package `uk.thewyj.app`, 1.3.33/46, identical SHA256/bytes/original certificate; every public release field equals the baseline.

Managed environment revision 27 still lists no secret/identity bindings. Local seven credential/session variables are absent, Wrangler 4.118.0 is unauthenticated, actual read-only Production D1 query and Preview R2 object get reject missing token. GitHub secret enumeration is 403; Core CI now checks the administrator-session binding as a seventh boolean without exposing values. Full-path adb actually lists zero devices. Production main-associated Pages check links `840c4eaa-30b8-483c-9ba1-ee5159332932`; active deployment/binding/ledger inventory remains unverified without Cloudflare management access.

Current Preview feature status/config remain healthy; APK GET for browser/native/WebView HTTP agents remains 503, previous HEAD was 405. No object absence/permission cause is invented. Fixed download HEAD metadata support and rejection of known size/available R2 SHA256 mismatch; retained streaming compatibility with old multipart objects lacking SHA256. Six new actual isolated R2 groups PASS, alongside the existing five resilience groups. Production preflight SQL now includes indexes by table and reads the actual migration ledger; isolated execution proves it read-only before migration and verifies index/ledger discovery after. No migration content changed or remote application attempted.

New hosted-capable Admin UI runner passed all nine actual browser checks in explicit isolated **development**, including synthetic channel changes, console writes/refresh, independent rollout, native/WebView same-account decisions, audit and ordinary GET/POST denial; cleanup leaves only its new harmless flag OFF/killed and revokes new synthetic sessions. Screenshot/report saved; the same runner is in Core CI. This does not satisfy hosted Preview Admin API/UI acceptance. Original local-only browser fixture remains restricted. New read-only hosted download probe correctly reports BLOCKED for the real Preview, without writes.

Production entry now requires every latest user pre-gate (hosted Admin API/UI, Preview download, Cloudflare/D1 preflight, original signing, physical Samsung, current-head CI, exact candidate integrity and clean worktree) **before any Production migration/deploy**. The read-only guard independently checks original APK+AAB signatures/bytes, exact source, Draft PR/base drift and real eight-job CI. Promotion additionally requires every physical checklist observation and device identity; 14 guard tests PASS. Receipt template stays NOT_EXECUTED/BLOCKED. Full physical coverage includes Room, pending/recovery identity, Finance pending, legacy local-only recovery and notification→Finance/amount accounting, in addition to lifecycle/channels/network/permissions. Metadata and pointer remain last, after immutable signed-object readback.

Related local Task 20 18 groups, Task 25 12 D1/API groups and 19 shared cases, 36 Stable consistency checks, Python/JS guards, repository audit and Worker compile PASS. Native/feature design and Android source/default Stable fields unchanged; current-head Actions/Preview/artifacts are recorded in the final PR #96 closure addendum after this commit. Evidence: `docs/task25/evidence/release-closure-preparation-20261007.json`, `local-admin-ui-release-smoke.json`.

External blockers remain ADMIN SESSION, CLOUDFLARE ADMIN TOKEN, PRODUCTION SIGNING CREDENTIALS and physical Samsung. Preview binary distribution 503 is an additional unpassed gate requiring Cloudflare investigation. No Production Task25 write/deploy, Stable promotion, R2 overwrite/delete, replacement identity, app uninstall/data clear, real-user data deletion or Task 26 work.


### Current-head Admin UI runner follow-up

Continuation commit `7b78a31` run [37657127773](https://github.com/WYJ0904/thewyj.uk/actions/runs/37657127773) completed **FAILURE, 7/8**, at the new Admin UI runner; accepted P1–P6, original 390/1366 Task25 UI and API release smoke passed first. Preserve this failed result, never call it final green. The initial asynchronous console catalogue could refill the form while the runner started writing/evaluating. A development 150ms-latency reproduction without the readiness wait fails with fixture selection lost; the repaired runner waits for the actual loaded console, and all nine checks/cleanup pass under the same latency. Atomic scope-check-and-click ensures a late selection change cannot mutate any pre-existing flag or non-synthetic override target. Original assertions remain. Failure diagnostics expose only fixture state, never credentials. CI now exercises this latency path. See `admin-ui-readiness-regression.json` and `local-admin-ui-latency-release-smoke.json`. Latest repair HEAD/CI/Preview/artifacts in the final PR addendum replace this intermediate failed run as the final source, without erasing it.

Current 7b78 unsigned artifact11498693833 independently matches accepted APK/AAB hashes, package/version and original unsigned state; actual Gradle aggregate 520 tests, zero failures/skips. Hosted Preview869e025a-8e98-419b-ba32-d66d47310622 independently passes browser/native/WebView 200/same-account decisions and Beta→Experimental→Stable; APK GET/HEAD still503. These are distinct gates. Production public metadata/hash/certificate stay Stable46; no Task25 write.


Observed remaining ordering dependency: the unchanged approved candidate embeds Production (`https://thewyj.uk`) and its native/WebView clients use BuildConfig. Actual Production feature/channel endpoints both return404. Full signed-Samsung channel/flag acceptance requires that service, while the latest user rule forbids any Task25 Production migration/deploy until full Samsung PASS. This dependency is recorded in `production-physical-ordering.json` and the plan; no changed-origin binary, mock/proxy response, cross-environment session routing or partial-device PASS is substituted. Signing/device availability can unlock independent upgrade/data/lifecycle checks, but cannot by itself satisfy this ordering dependency. Production stays untouched.

## Independent Actions preflight continuation — 2026-10-07

Resume from [saved Closure 6043762841](https://github.com/WYJ0904/thewyj.uk/pull/96#issuecomment-6043762841), current source88d4661 and CI37660529040 8/8 SUCCESS; the user's listed156bc29 is the preserved original baseline, not a reason to revert the two already recorded commits. Fresh fetch/tree/PR confirms Draft/open/unmerged/clean merge, main unchanged and zero behind-main drift. Cloud revision34 has no secret/identity bindings; actual local seven inputs absent, Wrangler config absent and adb empty. Repository secret/variable enumeration403 does not prove Actions credential absence.

Added `task25-hosted-preflight.yml` and `qa/task25/hosted-release-preflight.py` so future cloud sessions can independently discover Actions inputs and run the prepared hosted probes using CI-bound credentials, without rerunning the complete green suite merely to refresh blockers. Production reads and Preview fixtures are separately scoped; no Production migration/deploy/signing/R2 upload/pointer operation exists. Source/origin/output guards reject mismatches before requests, signer secrets are discovery-only, and artifacts exclude headers/profile/private process logs. Actual local no-credential execution reads preserved Stable46, records hosted download503, all missing external gates BLOCKED and empty adb; runner success is evidence collection, never release PASS. Latest current-head CI/Pages/Actions preflight artifact IDs and result are in the final PR96 closure addendum.

User now requests continuous Task25→Task26 execution, with full Task25 PASS as a hard prerequisite. No Task26 audit, feature branch, implementation or migration has started. Once every real Task25 gate and final-main/Stable condition passes, start Task26 directly without another confirmation; until then READY FOR TASK26 remains NO.

### Management quota regression follow-up

Independent preflight37667091495 (push) and37668749055 (actual manual dispatch) succeed as evidence collection, both explicitly release BLOCKED with all seven Actions inputs absent, hosted APK503 and empty adb. Current21f9270 CoreCI37667100312 attempt1 completed FAILURE7/8 after original390/1366 UI and API8 PASS: the new UI hit a legitimate per-route administrator quota429. Actor/fixture selection remained correct and cleanup passed. This failed result is retained.

The runner now starts its management sequence in the next fixed60-second window using actual server time. CI first requires a real development-only quota denial, then preserves every original UI/permission/audit/identity/cleanup assertion under150ms latency. Actual isolated D1 with limits ON: precharged quota429; old runner fails at first evaluation; repaired runner passes9 checks and cleanup, observed429=true, server_limits_changed=false. No limit weakening, quota row deletion, product UI change or exception masking. Evidence: `admin-ui-rate-budget-regression.json`, `local-admin-ui-rate-regression.json`. Known Preview/Production binding collision also blocks Preview fixture writes while other read-only evidence continues. Latest repair CI and preflight results are in final PR addendum.

### Visible administrator UI evidence

Source73b028c / CoreCI37672259949 completed8/8 SUCCESS, preserving rate429, API8/UI9 and safe cleanup. Visual review of actual artifact11507035614 found a preceding Task18 message obscured the console and missing CJK fonts; a closed account details menu was also programmatically bypassed. Those state assertions do not establish unobstructed UI acceptance. Hosted admin was already BLOCKED and was never called PASS.

The prepared runner now hit-tests visible non-inert controls before UI clicks, waits for transient rendering, normally opens the account menu, and requires a bounded unobstructed full-console screenshot. Development alone may dismiss prior synthetic message fixtures; hosted administrator receipts remain untouched and a blocking message prevents acceptance. CI/preflight install CJK fonts for readable review. Actual development notice coverage proves blocked controls are refused, all original9 checks/rate429/cleanup PASS. Evidence is admin-ui-visibility-regression.json and local-admin-ui-visible-release-smoke.json. Latest current-head full CI/Pages/artifacts remain the final PR96 addendum; no Production/Stable/Task26 work.


## Cloud-first continuation — 2026-10-08 (Asia/Hong_Kong)

Fresh starting PR96 head c9772436/main efc05c3/CI37767370636 are verified. No uncommitted repairs were found before fast-forward. Existing PR97/payment/R8 history retained; no new deferred specialty tests. CI candidate and original-signed workflow defaults corrected to1.3.36/49 without changing Stable variables. Remote probes now explicitly soft-delete only their own ordinary synthetic account, reject its old session and retain harmless killed flags/audits. Actual current hosted Preview user/channel/identity/cleanup and full APK byte/cache smoke PASS; old503 superseded. Fresh independently dispatched Actions37772784363 proves all7 inputs absent and reports release BLOCKED. Current runtime43 has no credentials; actual WranglerD1/R2 readonly checks blocked, adb empty. No Production SQL/deploy/Stable/R2/signing change or real-user deletion. Current result/precise Windows commands and original release gates: [TASK25_CLOUD_HANDOFF.md](TASK25_CLOUD_HANDOFF.md); final HEAD, full CoreCI, current Preview/artifact hashes in newest PR96 Closure. Task26 remains closed.


### Current cloud CI failure retained and repaired

Run37774133818 at aa087c2 completedFAILURE6/8. Application Finance observed category hydration before the deliberately deferred budget insights; the unchanged50.00 assertion remains and now waits for the explicit budget readiness marker. A500ms frame-delay fixture exercises that ordering; full local application browser regression passes. AdminUI completed all9 checks but cleanupFAILED: actual self-delete200 was followed byme401 after the still-open synthetic page consumed the revoked session. The runner closes only its own isolated contexts before cleanup, preserving exact200/403 assertions and everyUI check. No product/server/Finance logic or release gate changed. Evidence: `docs/task25/evidence/cloud-first-ci-followup-20261008.json`; final repaired source/currentCI are in newest PR96 Closure.

Actual development rate-enabled150ms-latency reproduction after the cleanup repair: all9 visible UI checksPASS, real quota429 observed, own flag disabled/override inherit, native logout and ordinary synthetic self-delete verified with exact200/403. `cloud-first-local-admin-cleanup-20261008.json` preserves this local software evidence; it is not hosted Admin or Samsung acceptance.

## Final release continuation — 2026-10-09 (Asia/Hong_Kong)

Restored actual remote c0ed243 (main efc05c3, #96 Draft, 0 behind/36 ahead, merge-tree succeeds) rather than the stale cloud cf8e2b4 checkout. Current baselineCI37780346466 actuallyFAILED:5 success/1 failure/2 skipped; preceding37776115197 is genuinely8/8SUCCESS. The failure is the31-request D1 fixed-window fixture crossing12:59UTC. Original30×200/1×429 assertions remain; fixture clock now pins one window and adds continued429/exactRetryAfter/next-window200 with independent D1 counters. Local12D1 groups/19sharedvectors and5D1/6R2/20candidate-promotion guardsPASS. Full final-sourceCoreCI follows this commit, not copied from the old green run.

Latest user explicitly orders main merge+CI before Production and Task25 device behavior. Added that explicit receipt mode without deleting default/compatible gates: original signing, Preview/private preflight, exact identical merge tree and eight actual candidate+mainCI jobs still required; final24Task25 physical observations remain mandatory before Stable promotion. Main previously skipped discovery/instrumentation, so both now run on trusted main. No financial-specialty physical check is silently certified; those five checks remain for the second independently versioned Android release.

Cloud runtime50 remains Linux, no USB target/private-network grant/localChromebridge/original signing files/Wrangler login. Existing browser permission does not create a local connection. User requested a supported remote login, then expressly prohibitedTinyFish; cancellation found its read-only run alreadyCOMPLETED, and no final result was retrieved/used as CF/D1PASS. No furtherTinyFish use. Actual current immutablePreview f776cd52 passes anonymous401/nonadmin403, browser/native/WebView200sameaccount/decision,三通道, own account softdelete/formersession403 and fullAPKHEAD/GET/cache-miss/stale-validator checks; old503 remains superseded. PublicProduction status/config200Stable46 and Task25routes404; no Production writes or Androidpromotion executed. Current final-source IDs belong in the newest PR96Closure.

Evidence: `docs/task25/evidence/final-release-*-20261009.json`; current minimal Windows/localChrome/USB continuation: `docs/TASK25_LOCAL_CHROME_HANDOFF.md`. CLOUD_BLOCKED/LOCAL_REQUIRED, TASK25_FULL_PASS:NO, READY_FOR_TASK26:NO. Task26 and the separate Android repair phase have not started. Original Stable/configuration/migration/signing workflow and all historic device PASS/FAILURE records are preserved.
