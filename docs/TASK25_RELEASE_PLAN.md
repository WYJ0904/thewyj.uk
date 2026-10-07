# Task 25 release execution plan

This is preparation, not permission to bypass a failed gate. Baseline: PR #96 Draft, main `efc05c3596c83a12d668911c5f891d2d5f3c395a`, accepted software/Preview/CI in the saved closure and final GitHub acceptance. Task 26 remains closed. Stable is 1.3.33/46, candidate is 1.3.34/47. Current remote administrator session, Cloudflare management token, original signing inputs and physical Samsung are unavailable.

## Deployment system and boundaries

The repository has Core CI and `android-signed-candidate.yml`; it has **no separate Production deployment or Android publication workflow**. Existing Cloudflare Pages Git integration deploys PR Preview and main Production. Retain project `thewyj-uk`; do not create another project/account. A direct Wrangler deployment to that same project's Production branch is the pre-merge path needed for Production acceptance while #96 stays Draft. Main Git deployment after the release gates is the final deployment path.

| Environment | D1 | R2 |
| --- | --- | --- |
| Preview | `wyj-cloud-preview`, `a3e6253b-689f-49f3-998b-7c5828ea255a` | `wyj-cloud-preview` |
| Production | `wyj-cloud-production`, `11c288d8-c584-409f-bb1f-7e7af11793e5` | `wyj-cloud-production` |

Root/Production master switch is currently OFF; Preview is ON. All initial feature definitions are OFF. Missing account preference is Stable. Beta never includes Experimental implicitly. Even 100% or targeted ON cannot bypass channel/global-OFF/kill gates. All binary channels still resolve the existing Stable API, not candidate distribution. No migration changes Finance, notifications, files, user accounts, R2 objects or Android metadata.

## Production preflight and migration

After existing Cloudflare credentials and an authorized hosted admin session become available, pin the final candidate/source SHA, latest successful CI and current main; check PR #96 is still Draft/unmerged and mergeable. Fetch the latest main and use `git merge-tree --write-tree origin/main HEAD`. Repeat read-only Production status/config/hash smoke and record the existing Pages deployment ID and its bindings/variables for rollback. Record a D1 Time Travel bookmark using `npx wrangler d1 time-travel info WYJ_DB --env production --timestamp <current-UTC-ISO>`; inspect it privately and do not reset/restore Production as a routine step.

```sh
npx wrangler d1 execute WYJ_DB --env production --remote --file cloudflare/task25-production-preflight.sql --json
npx wrangler d1 migrations list WYJ_DB --env production --remote
```

Inspect the ledger, previous migration names, Task 12 FK parent and all existing Task 25 table/index/trigger definitions. No Task 25 objects is a normal pre-migration state. If any objects already exist, compare their columns/defaults/checks/FKs/triggers with 0024 before trusting a schema marker; `CREATE IF NOT EXISTS` cannot repair an incompatible table. A partial/incompatible schema or unknown outstanding older migration requires reconciliation, not blindly applying all pending migrations. Only when the pending list is exactly `0024_feature_flags_release_channels.sql` (or already applied with compatible schema), continue:

```sh
npx wrangler d1 migrations apply WYJ_DB --env production --remote
npx wrangler d1 execute WYJ_DB --env production --remote --file cloudflare/task25-production-preflight.sql --json
npx wrangler d1 execute WYJ_DB --env production --remote --command "SELECT name, applied_at FROM wyj_d1_migrations WHERE name='0024_feature_flags_release_channels.sql'; SELECT value FROM task25_metadata WHERE key='schema_version'; SELECT flag_key, enabled, kill_switch, channels_json, rollout_basis_points FROM task25_feature_flags WHERE flag_key IN ('task25_validation','aeris_experimental_badge');" --json
```

Capture commands, executor, UTC, source SHA, migration hash and resulting ledger/DDL. A previously applied migration must preserve operator settings: inspect rather than force seeded rows back to defaults. SQL and its ledger insertion execute as one D1 migration transaction. The isolated release test uses Wrangler 4.118.0's own SQL splitter and actual Miniflare D1 batch: a deliberately failing last statement rolls back DDL, marker, seed and ledger, then a clean retry succeeds. Production transaction behavior still requires actual execution evidence; local PASS does not claim that execution.

Failure before commit: leave master OFF; verify no ledger/marker/partial objects, inspect errors and retry the unchanged additive file. Failure after commit/deployment: retain Task 25 data/audit and the additive schema; roll back the Pages deployment and master switch. Do not drop tables, reset D1 or restore a bookmark over real user writes. There is no destructive down migration because old server/clients tolerate extra tables. The fixture verifies every existing business-table row remains identical after this migration and replay preserves live flag/preference/override/audit rows.

## Server/Web rollout and Production acceptance

1. Migration and schema/ledger checks PASS.
2. From an isolated checkout of the pinned candidate, stage with `npm ci --ignore-scripts --no-audit --no-fund` and `node scripts/stage_pages_deploy.mjs`.
3. Deploy initially with the existing Production master OFF to prove compatibility: `npx wrangler pages deploy .wrangler/pages-output --project-name thewyj-uk --branch main --commit-hash <pinned-SHA>`. Preserve Production D1/R2 bindings, all existing secrets and every `ANDROID_*` value. Inspect the resulting deployment/variables; do not assume Preview variables apply to Production.
4. In that isolated checkout only, set root and `env.production.vars.TASK25_FEATURE_FLAGS_ENABLED` to `true`, with all other variables/bindings unchanged. This changes the service availability; seeded functionality remains OFF. Stage/deploy the same source/project again. Save the exact configuration diff and deployment ID privately. PR #96 remains Draft and main unchanged at this acceptance stage.
5. Run Production API/session/browser/native/WebView identity smoke and the harmless admin smoke below. Verify Admin UI with the same authorized session, channels, independent percentage bucket, targeted ON/OFF/inherit and kill switch. Test master OFF/restore and unavailable-feature behavior on Preview, without disabling Production services for unrelated users. Existing automated failure contracts remain the outage evidence; genuine Production outage acceptance is not invented.
6. Compare Production public/config/APK with the baseline, and check account/Finance/notifications/files/session/browser behavior for regression without modifying existing users. Record each outcome separately. Do not treat Preview as Production evidence.

After an existing session is supplied securely as `WYJ_TASK25_ADMIN_SESSION`, execute first on Preview, then on Production:

```sh
python3 qa/task25/remote-admin-smoke.py --environment preview --origin https://codex-task25-flags-release-c.thewyj-uk.pages.dev --output artifacts/task25-preview-admin-smoke.json
python3 qa/task25/remote-admin-smoke.py --environment production --origin https://thewyj.uk --output artifacts/task25-production-admin-smoke.json
```

The script proves environment, master, Stable metadata and administrator access **before** fixture creation. It creates one synthetic account and one uniquely named unconsumed harmless flag, tests actual APIs, and independently computes SHA256 buckets. Finally it leaves that flag globally OFF, rollout 0 and killed, returns only its synthetic preference to Stable and revokes its session. It never changes an existing user's preferences/data. Failure or failed cleanup returns nonzero and cannot count as PASS. Credentials use a private temporary headers file, no redirect following, no plaintext report/log fields. Its local execution is software evidence; hosted Admin API/UI are still unexecuted until authorized session evidence exists.

Emergency path: use `POST /api/admin/feature-flags` with the complete current definition, current `expected_revision` and `kill_switch:true`; refetch/retry on 409, verify audit and evaluation. If admin/D1 is unavailable, set the existing Pages Production master OFF and redeploy/roll back through the same project. New evaluations stop immediately; already valid memory snapshots expire within 30 seconds and clients close features when paused/offline/refresh fails. Flags do not replace business authorization. Failed audit writes atomically roll back the flag change; the release test injects this failure.

## Original signing and candidate

Four required repository/CI secrets are `THEWYJ_ANDROID_KEYSTORE_B64`, `THEWYJ_ANDROID_KEYSTORE_PASSWORD`, `THEWYJ_ANDROID_KEY_ALIAS`, `THEWYJ_ANDROID_KEY_PASSWORD`. Gradle uses the decoded `THEWYJ_ANDROID_KEYSTORE_FILE` plus the other three. No key generation, signing identity rotation, Stable object write or publication is present in the signed candidate workflow. It validates advancing version/name and HTTPS origin, uses candidate Gradle properties without editing Stable defaults, tests/lints/builds APK+AAB, verifies the APK package/version/certificate and independently verifies the AAB JAR signature/certificate, hashes both artifacts and removes the decoded keystore. Candidate metadata always says unreleased, physical NOT_EXECUTED and promotion false.

```sh
gh workflow run android-signed-candidate.yml --ref codex/task25-flags-release-channels -f version_name=1.3.34 -f version_code=47 -f base_url=https://thewyj.uk
```

Use the workflow for the pinned final source; record exact checked-out SHA, run/artifact ID and APK/AAB hashes. Required package is `uk.thewyj.app`, name 1.3.34, code 47; both signatures must match Stable certificate `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`. The saved Stable APK/hash/certificate evidence is the upgrade baseline. Missing original credentials or mismatch stays BLOCKED. Mocked guard tests prove rejection paths; they do not prove original signing succeeded.

## Physical Samsung gate

After access is actually available, run `adb devices -l`, select the physical Samsung serial, record model/Android 16/WebView version, and inspect `adb -s <serial> shell dumpsys package uk.thewyj.app` to confirm installed Stable 46. Verify that installed APK's original certificate, active account and local data, then execute `adb -s <serial> install -r <verified-signed-1.3.34-candidate.apk>` once. Never uninstall, clear data, use `-d`, or substitute an emulator for this gate.

Record actual outcome for package/signature/version47, retained session/local data; Stable/Beta/Experimental; native/WebView same-account decisions and targeted/deterministic rollout; Back/Resume/foreground/background/WebView reload/process restoration; offline startup, online-to-offline, flag unavailable and recovery; existing cache TTL/OFF fallback without disabling the rest of the app; haptic/install/system permissions on this Samsung/Android 16. Use only synthetic test accounts/harmless flags for changed preferences. Restore temporary network conditions. Every item remains NOT_EXECUTED until actually observed on the signed candidate; a failure is a release blocker, never a changed assertion.

## Final promotion and failure recovery

Only after Production migration/deploy/smoke, original APK/AAB signing, physical Samsung, necessary CI and final review all PASS: make #96 Ready, merge, verify exact main SHA/main CI, and complete final Production server deployment with the approved master setting. Main Git deployment uses the committed root/Production master OFF baseline unless a separately gated final configuration is prepared; it must not silently supersede the accepted ON deployment. Verify the effective setting and deploy the approved final configuration on the same project, then repeat smoke before any binary promotion. Recheck the published Stable 46 before touching distribution. Keep versioned objects immutable; there is currently no separate `latest` R2 object to rewrite. `/api/app/download` follows `ANDROID_APK_KEY` in the Pages deployment; `/api/app/config` and all three channels follow the same deployment variables.

1. Verify candidate hashes/signatures again, and save current release configuration/deployment rollback evidence.
2. Upload **only a new versioned key**: `npx wrangler r2 object put wyj-cloud-production/app/android/thewyj-android-1.3.34.apk --remote --file <verified-signed-candidate.apk> --content-type application/vnd.android.package-archive`. Check the key does not already contain different bytes before writing. Do not overwrite/remove `app/android/thewyj-android-1.3.33.apk` or write an unsigned artifact. Retain AAB in the signed Actions artifact; this application distributes APK, not AAB.
3. Retrieve the new object with `npx wrangler r2 object get wyj-cloud-production/app/android/thewyj-android-1.3.34.apk --remote --file artifacts/task25-r2-readback.apk`; verify size/hash/certificate/package/version against the **exact signed artifact**, not a rebuilt unsigned candidate. On upload/readback failure, stop: Stable metadata/pointer remains 46. An unreferenced new object is safe and resumable.
4. Prepare a single consistent release configuration changing Gradle default name/code, `android/release-metadata.json`, root/Preview/Production `ANDROID_*` fields and release notes/date/build to the verified signed APK. Preserve package/signing identity/minimum code. `scripts/prepare_task25_android_release.py` prepares these files atomically in a new directory outside the checkout; it refuses unsigned/stale candidates, missing gates/evidence, emulator/uninstall/data-loss receipts and missing/mismatched Production R2 readback. It independently rechecks APK/AAB original signatures. Its receipt template `docs/task25/release-acceptance.template.json` currently marks unexecuted gates accurately; never turn declarations into evidence. Complete the receipt from reviewed real observations and run the command below. After applying the reviewed proposal, run `python3 scripts/check_android_release_consistency.py --apk <verified-signed-candidate.apk> --verify-apk-integrity --expect-certificate 2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`. Publish that reviewed main configuration through the existing Pages deployment only after the new R2 object is verified. Metadata and download pointer are one deployment, never independent manual edits. Preview must also have a separately uploaded/verified artifact in its own bucket before its pointer changes; do not point Preview at Production R2.
5. Verify `/api/app/config` announces 1.3.34/47 and correct signed hash/size; download `/api/app/download`, verify bytes/package/certificate/hash, then do final Production/channel/Android update smoke. Keep old46 object and rollback deployment.

Download responses now use `private, no-store` because the route changes with the pointer. Before promotion ensure old `max-age=300` responses have expired (five minutes after the Task 25 server rollout) or purge that URL via the existing Cloudflare account. Already running clients with old metadata can detect a hash mismatch and refetch; do not disable verification. After-pointer failure: roll back the whole Pages release configuration/deployment to 46, keep both immutable R2 objects, verify old metadata/download. A timed-out deploy is an unknown outcome: inspect active deployment/config/hash before retrying; never assume failure and publish a second pointer blindly.

No gate currently authorizes these writes. The present release remains BLOCKED; the closure lists actual execution and future actions separately.

```sh
python3 scripts/prepare_task25_android_release.py --candidate-metadata <verified-candidate-metadata.json> --acceptance <reviewed-release-receipt.json> --apk <signed-candidate.apk> --aab <signed-candidate.aab> --r2-readback <production-readback.apk> --release-date <UTC-date> --release-build <reviewed-build-id> --release-notes-file <reviewed-notes.txt> --output-dir <new-directory-outside-checkout>
```
