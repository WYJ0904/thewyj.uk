# Task 25 cloud execution

Updated: 2026-10-06 (UTC). This file is the recovery entry point for this task.

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

Software implementation and automatic acceptance complete. Core CI [37505935692](https://github.com/WYJ0904/thewyj.uk/actions/runs/37505935692) SUCCESS, 8/8 including both browser regression jobs and Android runtime. Hosted Pages Preview deployed by the existing Git integration. Preview Task 25 API returns `503 task25_schema_not_ready`; D1 migration administration is blocked by the absent API token. Production migration/deployment have not been performed. Final blocked-release [closure](TASK25_CLOSURE.md) records completed work, evidence and external gates. No real user data has been used as a test fixture.

Planned gates:

1. Add idempotent, additive migration and authenticated, audited feature flag/channel contracts.
2. Implement admin/user UI and native consumer with fail-closed account isolation.
3. Test global OFF/ON, override, Stable/Beta/Experimental gating, percentage boundaries/determinism and kill switch, plus security/concurrency/regressions.
4. Run local isolated Pages/D1/R2 preview, browser and Android unit/lint/build checks; run GitHub CI and signed candidate workflow where authorized credentials permit.
5. Inspect Production schema before any migration; deploy only with existing credentials and passing gates. Never reset D1.
6. Save final evidence and `docs/TASK25_CLOSURE.md` to GitHub.

## Current blockers and device boundary

- Cloudflare API/D1/R2 administration lacks credentials; Pages deployment through Git integration is available and proved. Preview's Task 25 schema is not ready, and Production schema inspection/migration remains unauthenticated.
- Workflow dispatch works. Fresh signing workflow and CI discovery prove required signing credentials absent; release signing is blocked without changing the Stable identity.
- Physical acceptance is NOT EXECUTED: current Stable → candidate in-place Samsung upgrade; final signature/install compatibility; Back/Resume; actual Samsung WebView; real offline/recovery; haptic/system permissions. These remain separate from software checks.

Resume by reading this file, git status/log, main HEAD, open PR and Actions results. Continue from completed gates; do not repeat predecessors or advance Task 26.

## Software implementation checkpoint

The additive `0024` migration, server evaluator, audited admin API/UI, account channel UI, native memory-only consumer and shared contract vectors are implemented. Global OFF, kill switch and excluded channels cannot be bypassed by a user override. Configuration revisions prevent lost writes; a transaction nonce prevents a losing override write from using the winner's revision.

Validated in cloud so far:

- D1/API: 12 acceptance groups, including genuine synthetic Android device-session access, WebView cookie and browser token producing the same canonical evaluation; rate limits, CSRF, isolation, concurrency, audit and migration replay.
- Web/native shared vectors: 19 cases; Web parser PASS, Android JVM/runtime checks queued.
- Local isolated Pages/D1/R2 migration: all 24 files applied; never Production D1.
- Initial Kotlin compilation PASS. Full Gradle tests/lint/build now use a downloaded complete JDK 21; the environment's original Java runtime lacked `javac`.
- Stable metadata: all 36 consistency checks PASS. Complete public Stable download and certificate verified: SHA `17da079bc7428dc87b1b0b2141ca011f6297101fba3a5d2cc6bbac3fe289048c`, certificate `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`.
- Web generation: `20261006-task25-flags-1`; added modules are precached. Business-module edits outside Task 25 are generation strings only.

Git HTTPS push failed (401); exact local Git objects/commits are uploaded through the authenticated GitHub REST Git API, with a fast-forward and expected-head check. This preserves commit SHAs and avoids a local-only handoff.

Actual Pages project listing, remote Production D1 inspection and remote R2 object access each reject the operation because `CLOUDFLARE_API_TOKEN` is absent. No temporary account, parallel deployment, Production migration or R2 write is used. A CI credential-presence job and the existing signed-candidate workflow will test repository/CI credentials separately; absence in the cloud shell is not treated as proof about GitHub Secrets.

Actual Chromium Pages acceptance PASS at 390/1366px. GitHub PR #96 is draft. Initial Core CI [37505064825](https://github.com/WYJ0904/thewyj.uk/actions/runs/37505064825) found the emulator job's `sdkmanager` PATH error; repaired by resolving the runner's installed SDK tool explicitly, matching the existing Android build job. No failing product assertion was removed.

CI credential discovery completed successfully and its artifact/log proves all six standard Cloudflare/signing bindings are absent. The discovery job being green means the check ran, **not** that remote feature acceptance or deployment passed. Repository environments are empty; secrets enumeration remains 403. Its original `remote_preview` field was an inference about API credentials, superseded by the actual Git integration/HTTP probe below; the workflow now reports D1/R2 administration separately. Machine-readable evidence is stored under `docs/task25/evidence/`.

Actual hosted Preview [c4838955](https://c4838955.thewyj-uk.pages.dev) deployed commit `13b952fd64e502aec6af0e800c9a4a3be737d5da` successfully. Status proves environment `preview`, D1/R2 bindings and Task 25 master ON. `qa/task25/remote-preview-smoke.py` created only a synthetic ordinary Preview account; registration/browser/native logins PASS, anonymous access 401 and non-admin access 403. Browser token, native token and WebView cookie each receive the same `503 task25_schema_not_ready`. This is a real remote acceptance blocker, not a missing Pages deployment. One earlier probe also created a synthetic account before correcting its native client/device request; no real user record was changed.

Candidate 1.3.34/47 unsigned APK/AAB build PASS and actual package/version verified. Hashes and unreleased metadata: `docs/task25/evidence/candidate-local-metadata.json`. Stable metadata/config remains unchanged; final public download hash equals discovery. GitHub also stores the candidate in [Android artifact 11432003030](https://github.com/WYJ0904/thewyj.uk/actions/runs/37505935692/artifacts/11432003030) (90-day retention).

Remaining external gates: remote D1 schema/migration administration, existing identity release signing, and physical Samsung acceptance. Local software, CI, emulator and unsigned candidate are complete; full software release acceptance and overall release remain BLOCKED. They are additional to the device boundary, so the device-only SOFTWARE PASS formula cannot be used. Do not start Task 26.

## Final-branch CI follow-up

Report commit `1a30f17` triggered [37509287826](https://github.com/WYJ0904/thewyj.uk/actions/runs/37509287826). Its first attempt caught a pre-existing P33 hard-reload visibility/layout race; the second passed P33 but the Wrangler Pages development proxy crashed with connection resets/broken pipes during P4. These attempts are failed and are not represented as 8/8 PASS. The earlier code acceptance [37505935692](https://github.com/WYJ0904/thewyj.uk/actions/runs/37505935692) remains genuinely 8/8 PASS for the pinned candidate.

The Pages CI job now uses Node 24, matching the cloud workspace. P33 waits for the restored home to be visible and allows its existing ResizeObserver/frame layout to settle before geometric snapshots, including viewport changes. Every original geometric/session assertion remains. Local P33 passes all guest/authenticated/reload cases; P4 passes 390/1366/1920px on the persistent Node 24 Pages fixture. Product code, migrations, candidate and Stable metadata are unchanged. Final follow-up checks and outcomes are recorded by the latest branch Actions and the PR #96 closure addendum; never infer success from the older run alone.
