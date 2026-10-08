# Task 25 Cloud-first Closure / Windows continuation

Updated 2026-10-08 (Asia/Hong_Kong). This is a continuation of PR96, not Task26. The final source SHA, final CI run/artifact hashes and newest Preview deployment are recorded in the newest [PR96 Closure comment](https://github.com/WYJ0904/thewyj.uk/pull/96); obtain them before any release action. This document and its evidence are committed before that final CI run so the run validates the actual handoff changes.

## Actual cloud result

| Item | Result / evidence |
| --- | --- |
| Starting source | `c9772436a2cd16b8b2914b4216a1ba67a20afa64`; clean checkout fast-forwarded from old6ddc7eb |
| Main / PR | `efc05c3596c83a12d668911c5f891d2d5f3c395a`; #96 Draft/open/unmerged, 0 behind/27 ahead, actual merge-tree exit0 at starting source |
| Starting Core CI | [37767370636](https://github.com/WYJ0904/thewyj.uk/actions/runs/37767370636), all8 jobs SUCCESS; full final CI follows this commit |
| PR97 | Merged into Task25 at `d0b2f24f23544a50330ed59e222b9cda1a6b6441`; payment/R8 source and prior failures preserved |
| Code repair | Core CI and signed-workflow defaults now build approved candidate1.3.36/49; guarded Admin UI runner now accepts only the explicitly selected existing Production origin as well as Preview/development. Stable Gradle/metadata/Pages release variables unchanged |
| Fixture repair | Hosted probes restore only their synthetic preference, neutralize their own override/flag, revoke native sessions and self-delete their own ordinary account. Identity and former-session rejection are checked. Harmless OFF/killed flags and audit tombstones are retained explicitly |
| Feature contract | 12 D1/API groups,19 shared vectors,5 additive-migration/fallback groups,6 R2 distribution groups and16 signing/promotion guard tests PASS locally; existing P1–P6 reused |
| Fresh hosted Preview | Immutable `f7703cf0-3e3c-4630-af0d-9c3729325c15`: actual browser/native/WebView200, identical account/decision; Beta→Experimental→Stable; anonymous401, ordinary admin403; probe account soft-deleted and former session rejected |
| Preview APK | HEAD/browser/native/WebView/cache-miss/stale-validator PASS, exact Stable46 bytes. The old503 is superseded. Private R2 inventory/permissions remain unverified without management access |
| Current cloud credentials | Runtime revision43: no configured secrets/identities; Wrangler not authenticated. Read-only Production D1 and Preview R2 commands actually reject missing token |
| Actions alternative | Fresh dispatched [37772784363](https://github.com/WYJ0904/thewyj.uk/actions/runs/37772784363), artifact11548518253: all7 inputs absent, release explicitly BLOCKED; workflow SUCCESS is evidence collection only |
| Preview Admin | Historical API/UI PASS reported by user and retained. Current-head hosted revalidation BLOCKED: ADMIN SESSION. Development CI UI does not replace it |
| Original signing | Historical local original identity preserved. Four current cloud/Actions inputs absent; exact final-source signed APK/AAB verification LOCAL_REQUIRED. Never generate a replacement key |
| Samsung | `adb devices -l` actually empty. This round's new accessibility/OCR/payment/device specialties DEVICE_DEFERRED. Historical formal R8¥0.01 10/10 PASS reported by user is retained alongside earlier failures; unavailable local record is not invented as current-head/cloud physical evidence |
| Production | Existing status/config/APK/package/certificate healthy; Task25 features/channel404. No migration or deployment executed in this cloud continuation |
| Data | No real-user data modification/deletion, Production reset, R2 write, Stable-pointer change or signing-identity change |

Committed evidence: [baseline](task25/evidence/cloud-first-baseline-20261008.json), [Preview contract/cleanup](task25/evidence/cloud-first-preview-contract-20261008.json), [Preview download](task25/evidence/cloud-first-preview-download-20261008.json), [fresh Actions readiness](task25/evidence/cloud-first-actions-preflight-20261008.json). Final current-head CI/Preview/candidate evidence is attached to the newest PR Closure, not copied from an older source. The payment documents and all earlier PASS/FAILURE reports remain historical evidence, not removed.

```text
TASK 25 SOFTWARE IMPLEMENTATION / AUTOMATED TESTS: PASS (final CI must also finish green)
CLOUD_COMPLETE: NO
CLOUD_BLOCKED: YES
LOCAL_REQUIRED: YES
DEVICE_DEFERRED: YES
TASK25_FULL_PASS: NO
TASK 25 RELEASE STATUS: BLOCKED
READY FOR TASK 26: NO
```

## Production / rollback boundary

Public Stable is still `uk.thewyj.app`,1.3.33/46,47,893,965bytes, SHA256 `17da079bc7428dc87b1b0b2141ca011f6297101fba3a5d2cc6bbac3fe289048c`; original certificate `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`. Pointer `/api/app/download`, metadata `/api/app/config`, R2 key `app/android/thewyj-android-1.3.33.apk`. Public bytes/metadata/signature are verified; private object inventory and active deployment require management permission.

Keep Pages project `thewyj-uk`, Production D1 `wyj-cloud-production` / `11c288d8-c584-409f-bb1f-7e7af11793e5`, R2 `wyj-cloud-production`; Preview D1 `wyj-cloud-preview` / `a3e6253b-689f-49f3-998b-7c5828ea255a`, R2 `wyj-cloud-preview`. Historical Production deployment `840c4eaa-30b8-483c-9ba1-ee5159332932` is a recovery lead, **not freshly verified active or safe rollback target**. Re-read the existing Pages API/project with legitimate credentials before writing.

Historical Production ledger has24 entries,0019–0023 applied, no0024/task25 objects. Current ledger/bookmark/bindings are BLOCKED_PRIVATE_ACCESS. Do not substitute this historical result for preflight. Canonical0024 SHA256 is `67712cbe6da1f35fdd59d2b4806c164869e06d840b1ae652a3e8f6f082018173`:5 tables,1 index,5 triggers; initial flags OFF. It touches no business tables or Android pointers. Local failure/retry/replay/audit atomicity tests PASS; actual Production migration is NOT_EXECUTED.

The approved compatible-server order is valid only with its explicit receipt, Preview API/UI+download+private D1 preflight, exact-source original signing, independent Samsung observations, clean source and8 green CI jobs. Deferred physical observations remain missing gates. Final29-item Samsung/Production/review/main-CI gates still block PR merge and binary promotion. This cloud run cannot satisfy entry just by deferring hardware checks. Rollback NOT_REQUIRED this run: no Production write occurred. Future deployment rollback retains additive schema and audit; never drop tables/reset D1 or restore a bookmark across real-user writes.

## Shortest Windows continuation

Run in PowerShell in the existing clone, or clone once if needed. Keep local changes/evidence before changing branches; never reset them to make the gate green.

```powershell
git clone https://github.com/WYJ0904/thewyj.uk.git  # only if no existing clone
Set-Location thewyj.uk
git fetch origin
git switch codex/task25-flags-release-channels
git merge --ff-only origin/codex/task25-flags-release-channels
if (git status --porcelain) { throw 'Preserve/reconcile local changes before release' }
$Task25Source = git rev-parse HEAD
gh pr view 96 --json state,isDraft,mergeable,headRefOid,baseRefOid
gh run list --branch codex/task25-flags-release-channels --workflow ci.yml --limit 3
```

Then have local Codex read this document, the newest PR96 Closure and `docs/TASK25_RELEASE_PLAN.md`, reuse the already saved original signing/Preview Admin/ordinary-R810-of10 evidence, and execute only the next unlocked step. Do not start new deferred payment/accessibility/OCR tests. No Task26 or Stable promotion while any original final gate remains outstanding.

Preserve the original keystore+passwords+alias, existing Stable APK, signed candidate APK/AAB+metadata/hashes/source, reviewed29-item receipts, private original videos/OCR/device failure logs, Preview Admin screenshots/audit/cleanup evidence, local authorization receipt and D1 preflight/bookmark/ledger/import evidence. Keep private materials outside Git/Actions reports. Locate them in the existing local workspace; cloud did not verify a Windows path. Never echo credentials, commit them, create a new identity, uninstall Aeris or clear session/Room/app data.

### 1. Restore only existing authorized access; read-only preflight

Reuse the authorized local Wrangler OAuth/configuration or securely bound existing token. `wrangler whoami` must identify the existing account; do not accept its suggested temporary-account deployment. The seven relevant names are `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `WYJ_TASK25_ADMIN_SESSION`, and the four `THEWYJ_ANDROID_KEYSTORE_*` / `THEWYJ_ANDROID_KEY_ALIAS` inputs defined in the signed workflow. Presence is not proof of validity. If secrets are legitimately bound to cloud/Actions later, these independent server checks can continue there; local is required for the physical target and materials that actually remain local.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npx wrangler whoami
$Task25Evidence = Join-Path (Split-Path (Get-Location).Path -Parent) ('task25-release-' + $Task25Source)
New-Item -ItemType Directory -Path $Task25Evidence -Force | Out-Null
npx wrangler pages deployment list --project-name thewyj-uk
npx wrangler d1 execute WYJ_DB --env production --remote --file cloudflare/task25-production-preflight.sql --json
npx wrangler d1 migrations list WYJ_DB --env production --remote
$Task25Utc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
npx wrangler d1 time-travel info WYJ_DB --env production --timestamp $Task25Utc
npx wrangler r2 object get wyj-cloud-preview/app/android/thewyj-android-1.3.33.apk --remote --file "$Task25Evidence/preview-stable-readback.apk"
Get-FileHash "$Task25Evidence/preview-stable-readback.apk" -Algorithm SHA256
python qa/task25/remote-download-smoke.py --environment preview --origin https://codex-task25-flags-release-c.thewyj-uk.pages.dev --output "$Task25Evidence/preview-download.json"
```

Record effective active Production deployment, D1/R2 IDs, all existing variable values and secret **names**, recovery bookmark and ledger privately. Expected migration pending list is only0024, no partial objects. If0024 already applied with matching schema, skip application. Any unknown older pending migration or incompatible partial schema blocks writing. Retrieve the existing Pages project through `GET https://api.cloudflare.com/client/v4/accounts/97c274a981e8dd6703aa6388e11c4614/pages/projects/thewyj-uk` with existing legal authorization to verify configuration/deployment; preserve D1/R2/Secrets/allANDROID_* values. Do not print credentials/private headers.

### 2. Hosted administrator revalidation and cleanup

Use the existing authorized Preview session securely as `WYJ_TASK25_ADMIN_SESSION`; never reuse development fixture credentials remotely. Start a separate private Chrome CDP instance with `--remote-debugging-port=9225 --user-data-dir=<new-private-temp-dir>`, set `WYJ_CDP_URL=http://127.0.0.1:9225`. Remove that temporary profile after acceptance; never upload it.

```powershell
python qa/task25/remote-admin-smoke.py --environment preview --origin https://codex-task25-flags-release-c.thewyj-uk.pages.dev --output "$Task25Evidence/preview-admin-api.json"
node qa/task25/remote-admin-ui-smoke.mjs --environment preview --origin https://codex-task25-flags-release-c.thewyj-uk.pages.dev --output "$Task25Evidence/preview-admin-ui.json"
```

Expected unchanged API8/UI9 checks, real visible console, actual deterministic percentage, targeted override/channel/kill/refresh/audit and ordinary GET/POST403; new cleanup additionally verifies synthetic self-deletion. New flag rows remain OFF/killed/rollout0 and overrides inherit, with audits retained. Do not claim rows physically purged. Old fixture/admin revocation is still unverified here: inventory exact IDs from existing reports and match synthetic ownership before using the existing audited administration API. Revoke the dedicated Preview administrator using the authorized owner, after all admin smoke completes. Never bulk-delete by username prefix or drop audit rows; no flag-delete API exists. Record leftover inert rows/tombstones accurately.

### 3. Exact final-source signed1.3.36/49

Cloud Core CI builds the unsigned1.3.36/49 candidate; it is not an installable original-identity release. If all four original secrets are supplied to existing Actions, dispatch:

```powershell
gh workflow run android-signed-candidate.yml --ref codex/task25-flags-release-channels -f version_name=1.3.36 -f version_code=49 -f base_url=https://thewyj.uk
```

If the material remains local, set only the existing `THEWYJ_ANDROID_KEYSTORE_FILE`, `THEWYJ_ANDROID_KEYSTORE_PASSWORD`, `THEWYJ_ANDROID_KEY_ALIAS`, `THEWYJ_ANDROID_KEY_PASSWORD` securely. Use JDK21 and Android36 build-tools on PATH. No test/diagnostic gateway; release R8/resource shrinking stay enabled.

```powershell
$env:THEWYJ_PAYMENT_DEVICE_TEST = 'false'
$env:THEWYJ_PAYMENT_DIAGNOSTICS = 'false'
Push-Location android
./gradlew.bat clean testDebugUnitTest lintDebug assembleRelease bundleRelease --no-daemon --stacktrace -PTHEWYJ_BASE_URL=https://thewyj.uk -PTHEWYJ_CANDIDATE_VERSION_NAME=1.3.36 -PTHEWYJ_CANDIDATE_VERSION_CODE=49
if ($LASTEXITCODE -ne 0) { throw 'Candidate build failed' }
Pop-Location
python scripts/stage_android_candidate.py --apk android/app/build/outputs/apk/release/app-release.apk --aab android/app/build/outputs/bundle/release/app-release.aab --version-name 1.3.36 --version-code 49 --signing-status verified --output "$Task25Evidence/signed-candidate.json"
apksigner verify --verbose --print-certs android/app/build/outputs/apk/release/app-release.apk
jarsigner -verify -verbose -certs android/app/build/outputs/bundle/release/app-release.aab
keytool -printcert -jarfile android/app/build/outputs/bundle/release/app-release.aab
Get-FileHash android/app/build/outputs/apk/release/app-release.apk -Algorithm SHA256
Get-FileHash android/app/build/outputs/bundle/release/app-release.aab -Algorithm SHA256
```

Expected package `uk.thewyj.app`,1.3.36/49, both original certificate fingerprints, exact current branch source, both sizes/hashes recorded, unreleased. PR test-merge metadata is not the source SHA of the branch-signed workflow. A past signed binary must not be relabelled as a new HEAD; any rebuild requires independent signature/hash verification and applicable acceptance. Retain installed original session/data; physical prerequisites can only be resumed when the deferred scope is reopened and device available.

```powershell
adb devices -l
adb -s <observed-physical-Samsung-serial> shell getprop ro.product.model
adb -s <observed-physical-Samsung-serial> shell getprop ro.build.version.release
adb -s <observed-physical-Samsung-serial> shell dumpsys package uk.thewyj.app
# Only after verifying installed baseline/signing and reviewed physical scope:
adb -s <observed-physical-Samsung-serial> install -r android/app/build/outputs/apk/release/app-release.apk
```

Record actual before/after version; local reported installed48 is distinct from public Stable46. No emulator, uninstall, `-d`, data clear, Room reset or fresh login may substitute for preservation. All29 original final observations remain mandatory before merge/Stable; this round's deferral does not make them PASS.

### 4. Production entry, migration and compatible service

Populate a copy of the receipt template with reviewed real evidence, actual final source/base-main/8-green-CI, original signing, Preview gates, independent Samsung checks and the existing explicit compatible-server authorization. Never change NOT_EXECUTED to PASS merely to invoke the guard. Run:

```powershell
python scripts/check_task25_production_gates.py --candidate-metadata "$Task25Evidence/signed-candidate.json" --acceptance "$Task25Evidence/reviewed-receipt.json" --apk android/app/build/outputs/apk/release/app-release.apk --aab android/app/build/outputs/bundle/release/app-release.aab
```

**If guard fails, stop Production writes, continue independent preparation.** Only actual PASS+reviewed evidence unlocks migration. Recheck ledger/partial schema immediately before writing and capture business-table counts without exporting real user records.

```powershell
$Task25Canonical = (Resolve-Path cloudflare/migrations/0024_feature_flags_release_channels.sql).Path
if ((Get-FileHash $Task25Canonical -Algorithm SHA256).Hash.ToLowerInvariant() -ne '67712cbe6da1f35fdd59d2b4806c164869e06d840b1ae652a3e8f6f082018173') { throw 'Canonical migration changed' }
npx wrangler d1 migrations apply WYJ_DB --env production --remote
```

Success requires ledger+schema/default-OFF verification. If and only if the actual remote trigger-splitter failure is `incomplete input`7500, retain that failure, re-read ledger/DDL and compare all11 canonical objects, then use the documented same-file import. Prepare **unchanged original bytes plus ledger SQL in one new file**; never execute the ledger separately. The D1 file-import path restores the original database on failure; no manual BEGIN/COMMIT or reset is introduced.

```powershell
$Task25Import = Join-Path $Task25Evidence '0024-reviewed-import.sql'
$Task25Bytes = [System.IO.File]::ReadAllBytes($Task25Canonical)
$Task25Ledger = [System.Text.Encoding]::UTF8.GetBytes("`nINSERT INTO wyj_d1_migrations(name, applied_at) VALUES ('0024_feature_flags_release_channels.sql', strftime('%Y-%m-%dT%H:%M:%SZ','now'));`n")
$Task25Stream = [System.IO.File]::Open($Task25Import, [System.IO.FileMode]::CreateNew)
try { $Task25Stream.Write($Task25Bytes,0,$Task25Bytes.Length); $Task25Stream.Write($Task25Ledger,0,$Task25Ledger.Length) } finally { $Task25Stream.Dispose() }
Get-FileHash $Task25Import -Algorithm SHA256
npx wrangler d1 execute WYJ_DB --env production --remote --file $Task25Import --json
if ($LASTEXITCODE -ne 0) { throw 'Migration import failed: stop deployment and inspect recovery' }
npx wrangler d1 execute WYJ_DB --env production --remote --file cloudflare/task25-production-preflight.sql --json
npx wrangler d1 execute WYJ_DB --env production --remote --command "SELECT name,applied_at FROM wyj_d1_migrations WHERE name='0024_feature_flags_release_channels.sql'; SELECT * FROM task25_metadata; SELECT flag_key,enabled,kill_switch,channels_json,rollout_basis_points FROM task25_feature_flags;" --json
```

Expected single0024 ledger record, schema_version1,5tables+1index+5triggers, default seeded flagsOFF and existing business counts unchanged. If already applied, do not replay the import. Any uncertain/partial/import failure blocks later promotion.

From a clean isolated checkout of the pinned signed source, deploy to existing Pages Production only after these gates PASS:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
node scripts/stage_pages_deploy.mjs
npx wrangler pages deploy .wrangler/pages-output --project-name thewyj-uk --branch main --commit-hash $Task25Source
```

First deploy with existing Production masterOFF; inspect effective D1/R2/Secrets/ANDROID_* values and preserve all of them. Then in the isolated checkout only set root+Production `TASK25_FEATURE_FLAGS_ENABLED=true`, leaving initial feature definitionsOFF and Stable46 metadata/pointer unchanged; restage and deploy the same source/project. Capture the exact config diff and both deployment IDs. Run actual Production browser/native/WebView/session/Admin API/UI/channel/rollout/kill and account/Finance/notification/payment/file regressions per the release plan. Preview results are not Production smoke. No real-user data changes for fixtures. Once this same-project Production service has actually passed entry and deployed, securely use an authorized Production admin session and run:

```powershell
python qa/task25/remote-admin-smoke.py --environment production --origin https://thewyj.uk --output "$Task25Evidence/production-admin-api.json"
node qa/task25/remote-admin-ui-smoke.mjs --environment production --origin https://thewyj.uk --output "$Task25Evidence/production-admin-ui.json"
```

The UI runner verifies the selected environment/master/Stable identity before fixtures, never dismisses hosted admin message receipts and retains its exact9 checks. Do not run Production fixtures before deployment gates.

### 5. Rollback, final merge and Stable last

Record actual pre-deploy active deployment as rollback target. Use the existing Pages API `POST /accounts/<existing-account>/pages/projects/thewyj-uk/deployments/<verified-old-production-deployment>/rollback` with legal existing authorization if deployment smoke fails, then verify effective master/metadata/old APK bytes. Keep additive schema, users and audit. No routine D1 Time Travel restore. A deploy timeout is unknown: inspect active deployment before retrying.

Only all original final gates permit Ready→review→merge#96→final main CI→verify final-main Production/source/master/smoke. Then and only then upload **new** signed `app/android/thewyj-android-1.3.36.apk`, independently readback/verify same hash/size/certificate, prepare guarded atomic metadata/changelog/pointer files with `scripts/prepare_task25_android_release.py`, run both existing release consistency checks, and publish one consistent configuration **last**. Keep old1.3.33 object and rollback deployment. AAB remains an independently signed verified artifact, not the APK download endpoint. No upload/pointer command is authorized by merely deferred physical acceptance. Finish post-release smoke before TASK25_FULL_PASS or Task26.
