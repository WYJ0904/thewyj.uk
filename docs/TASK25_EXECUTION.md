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
| GitHub clone/read/write | Clone/read work; linked account reports repository admin/push permission; branch push/PR still to exercise |
| Actions / PR | API and logs readable; Core CI and signed candidate workflows exist |
| Repository secrets | `gh secret list` returns HTTP 403 `Resource not accessible by integration`; secret names/values cannot be enumerated |
| Signing CI | Prior signed-candidate run [35616140542](https://github.com/WYJ0904/thewyj.uk/actions/runs/35616140542) failed at Validate signing secrets; fresh candidate run still required |
| Cloudflare | Pinned Wrangler 4.118.0 installed via npm; `wrangler whoami` reports not authenticated; no configured Cloudflare runtime credential |
| Existing infrastructure | Pages project `thewyj-uk`; preserve existing Pages/D1/R2 deployment system |
| Preview | D1 `wyj-cloud-preview` / `a3e6253b-689f-49f3-998b-7c5828ea255a`; R2 `wyj-cloud-preview` |
| Production | D1 `wyj-cloud-production` / `11c288d8-c584-409f-bb1f-7e7af11793e5`; R2 `wyj-cloud-production` |
| Production read access | Public app config is HTTP 200 using curl; initial Python urllib request was 403, so that client failure does not establish a Production outage |
| Android | Project/wrapper present; JDK 21 available; installing SDK 36/build-tools 36.0.0 in cloud workspace |
| Gradle | Wrapper 9.4.1; downloading distribution |
| Signing locally | Existing environment-based signing config preserved; no local release signing credentials configured |
| Instrumentation | No `/dev/kvm` or physical Samsung attached; compile instrumentation and execute feasible JVM/browser checks |

## Stable Android protection

Current Stable: `uk.thewyj.app`, 1.3.33 / 46, `app/android/thewyj-android-1.3.33.apk`, 47,893,965 bytes, SHA-256 `17da079bc7428dc87b1b0b2141ca011f6297101fba3a5d2cc6bbac3fe289048c`.

Preserve `android/release-metadata.json`, existing `ANDROID_*` bindings, Stable object/download pointer and signing identity. Task 25 candidate will use separate metadata/artifacts (1.3.34 / 47). No candidate may become Stable without the actual release gate.

## Current stage

Software implementation in progress. Production migration/deployment have not been performed. No real user data has been used as a test fixture.

Planned gates:

1. Add idempotent, additive migration and authenticated, audited feature flag/channel contracts.
2. Implement admin/user UI and native consumer with fail-closed account isolation.
3. Test global OFF/ON, override, Stable/Beta/Experimental gating, percentage boundaries/determinism and kill switch, plus security/concurrency/regressions.
4. Run local isolated Pages/D1/R2 preview, browser and Android unit/lint/build checks; run GitHub CI and signed candidate workflow where authorized credentials permit.
5. Inspect Production schema before any migration; deploy only with existing credentials and passing gates. Never reset D1.
6. Save final evidence and `docs/TASK25_CLOSURE.md` to GitHub.

## Current blockers and device boundary

- Cloudflare deployment/D1/R2 administration currently lacks authenticated runtime credentials; actual remote operations will be tested, not assumed unavailable.
- Signing secrets and workflow dispatch authorization must be tested on this task's candidate.
- Physical acceptance is NOT EXECUTED: current Stable → candidate in-place Samsung upgrade; final signature/install compatibility; Back/Resume; actual Samsung WebView; real offline/recovery; haptic/system permissions. These remain separate from software checks.

Resume by reading this file, git status/log, main HEAD, open PR and Actions results. Continue from completed gates; do not repeat predecessors or advance Task 26.
