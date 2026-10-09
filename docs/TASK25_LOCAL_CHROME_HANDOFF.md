# Task25 final release continuation — 2026-10-09

This report follows the latest user-authorized sequence: Task25 and its own signed APK first; independent Android accessibility/accounting repair and a second signed APK next; Task26 only after both releases are accepted. No Task26 work is authorized in this round. The current full source/CI/Preview/artifact identifiers are recorded in the newest PR96 Closure comment; do not reuse an older SHA mechanically.

## Actual executor and access boundary

The selected executor is `/workspace`, Linux6.18.44 x86_64, cloud runtime revision50, unrestricted HTTP through the inherited proxy, no VPN/private TCP grants, configured secrets or outbound identities. Actual `adb devices -l` is empty. No Windows process, local Chrome CDP bridge or original `.jks`/`.keystore`/`.p12` material is available here. Wrangler4.118.0 is installed but `wrangler whoami` reports unauthenticated; all seven relevant environment inputs are absent. GitHub API/Git fetch and Actions are available. JDK21/Android36 tools and existing candidate artifacts are available.

The user's computer permission is valid; it does not connect that computer's USB or saved Chrome profile to this cloud executor. Never read/export a Chrome cookie database, passwords, session tokens or private keys to compensate. A supported remote-browser login entry was prepared at the user's request. After the user explicitly prohibited TinyFish, no further browser work/result retrieval was performed; cancellation returned `COMPLETED` because its read-only run had already ended. Its unreviewed result does not establish a Cloudflare/D1 acceptance PASS. Use the local Chrome session only through a supported browser-control interface in a local execution session.

## Verified cloud continuation

- Clean local checkout fast-forwarded from `cf8e2b4e30cad788ec16e88a4e3ec30795d30ac5` to actual PR head `c0ed2433d41ae7de861c12f658b7bd7a2bb54a3e`; preserved all seven later scope/version commits and PR97 integration. Main remains `efc05c3596c83a12d668911c5f891d2d5f3c395a`. PR96 is Draft/open/unmerged; actual merge-tree succeeds, 0 behind/36 ahead at that baseline.
- Prior repaired Core CI37776115197 is genuinely8/8 SUCCESS, but latest baseline37780346466 is FAILURE: five jobs succeeded, JavaScript failed, two browser jobs skipped. It is retained, not described as green. The real failure occurred after the native contract at12:58:59.177UTC and before12:59:01.020UTC:31 concurrent rate-limit requests crossed a fixed-minute window and legitimately produced no429. The fixture now fixes its clock within one window, preserves30×200/1×429, verifies exact Retry-After, continued denial and next-window200 with independent D1 counters. Production quota/authorization code is unchanged.
- The explicit latest main-before-Production/device order is implemented without deleting old/default gates. New mode requires original signing, Preview/D1 preflight, exact merged tree and both candidate/main CI; final promotion still requires actual Samsung observations. Added negative tests reject source drift, a different merge tree, missing main CI and attempted early Stable promotion.
- Main previously skipped the two Task25-only jobs, which would make an eight-job final-main gate impossible. Core CI now also runs boolean credential discovery and emulator contract verification on trusted main; neither substitutes for original signing or physical Samsung acceptance. All existing PR conditions remain.
- Current baseline immutable Preview `https://f776cd52.thewyj-uk.pages.dev`, deployment `f776cd52-846c-4df3-ae4e-3e2462d8935f`, passes actual Browser/Native/WebView HTTP contracts, identical account/decision, Beta→Experimental→Stable, anonymous401/ordinary-admin403, owned synthetic-account self-deletion and former-session403. This is HTTP contract evidence, not physical Samsung acceptance. Latest repaired-source Preview and full CI follow the final commit.
- Fresh Production public read-only check2026-10-09T01:32UTC: status/config200, `uk.thewyj.app` Stable1.3.33/46; features/channel404. Existing version is healthy; Task25 Production API release is not complete. Private active deployment/ledger/object inventory cannot be certified from public routes.
- Protected Stable metadata, Gradle defaults, Wrangler configuration, canonical0024 and original signing workflow remain unchanged. No real-user modification/deletion, Production migration/deployment, R2 write, Stable promotion or physical install occurred in this continuation.

## Production recovery and distribution

Keep existing Pages `thewyj-uk`, Production D1 `wyj-cloud-production`/`11c288d8-c584-409f-bb1f-7e7af11793e5`, R2 `wyj-cloud-production`; Preview D1 `wyj-cloud-preview`/`a3e6253b-689f-49f3-998b-7c5828ea255a`, R2 `wyj-cloud-preview`. Historical Production deployment `840c4eaa-30b8-483c-9ba1-ee5159332932` and24 ledger rows/0024 pending are recovery leads, not freshly verified private state. Re-read active deployment, bindings, variables, migration ledger, sqlite_master and D1 Time Travel bookmark before writes. Canonical0024 hash remains `67712cbe6da1f35fdd59d2b4806c164869e06d840b1ae652a3e8f6f082018173`. If already applied and compatible, skip it. If only0024 is pending, apply once after the actual entry gate; use the approved same-file SQL+ledger transaction import if Wrangler trigger splitting fails, never a standalone ledger insert or D1 reset.

Public Stable remains1.3.33/46, package `uk.thewyj.app`,47,893,965bytes, APK SHA256 `17da079bc7428dc87b1b0b2141ca011f6297101fba3a5d2cc6bbac3fe289048c`; original certificate SHA256 `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`. Existing key `app/android/thewyj-android-1.3.33.apk`, metadata `https://thewyj.uk/api/app/config`, pointer `https://thewyj.uk/api/app/download`. Candidate target is1.3.36/49 from the reviewed installed1.3.35/48; verify the real phone baseline before preparing receipts. An unsigned CI artifact cannot be published as official. Exact-source signed APK/AAB hashes are NOT_AVAILABLE until the original signer is actually used and independently verified.

Rollback was not required: this continuation made no Production writes. Future server rollback retains additive schema/audit and restores the approved existing Pages configuration, not a database reset. Keep both immutable APK objects; after a pointer failure restore metadata and pointer together to the verified prior Stable. Never restore a Time Travel bookmark across real-user writes without a separate incident decision.

## Minimal local continuation

The local Samsung was freshly observed on 2026-10-09 with an earlier unpublished1.3.36/49 acceptance APK already installed. Record the actual49 baseline. The receipt may use installed1.3.36/49 only with `same_version_revalidation` evidence, the independently read installed APK SHA256/original certificate, `unpublished_candidate:true` and the current public Stable46. This permits ordinary `install -r` for the exact final-source49 candidate, never downgrade/uninstall or a fabricated48 baseline. Original signing, preserved session/Room and all24 final Task25 observations remain mandatory. The older48→49 upgrade evidence remains historical.

Open the existing repository **in Windows local Codex with access to the connected Samsung and a supported control interface for the already logged-in Chrome**. The user has already authorized normal tests, signing with existing material, merge, migration and release; do not request those permissions again. Preserve local edits/artifacts before synchronizing:

```powershell
git fetch origin
git switch codex/task25-flags-release-channels
git merge --ff-only origin/codex/task25-flags-release-channels
git status --short
gh pr view 96 --json state,isDraft,mergeable,headRefOid,baseRefOid
gh run list --workflow ci.yml --branch codex/task25-flags-release-channels --limit 3
adb devices -l
adb -s <actual-Samsung-serial> shell getprop ro.product.model
adb -s <actual-Samsung-serial> shell getprop ro.build.version.sdk
adb -s <actual-Samsung-serial> shell dumpsys package uk.thewyj.app
```

Read the newest PR96 Closure, this file and the current top section of `docs/TASK25_RELEASE_PLAN.md`. Reuse local original keystore/identity and valid administrator evidence/session through existing supported tools, never export Chrome authentication. Run the original signed-candidate workflow only if its four original inputs exist; otherwise build locally using the existing four signing inputs, JDK21 and Android36 as specified in `TASK25_CLOUD_HANDOFF.md`. Verify APK/AAB package/version/hash/certificate and exact source, then Preview Admin API/UI and private D1/R2 preflight. Record rollback before merge. Only after those gates and candidate CI PASS, mark96 Ready/review/merge with a merge commit, wait for all main CI and verify the identical signed-candidate tree. Use the explicit new order receipt, fill real `final_main_commit`/`main_ci.run_id`, and run the read-only production gate on clean main before migration and service activation.

Upload/read back only the new signed versioned object; retain Stable46. On the actual SM-S9360 Android16, perform `adb -s <serial> install -r <verified-signed-task25.apk>`, verify all24 Task25 checks without uninstall/data clear and preserve session/Room. Then complete the final receipt, guarded atomic metadata/pointer proposal, same-project deployment and Production+Android smoke. Do not confuse immutable artifact publication with final Stable promotion. Preserve all earlier payment PASS/FAILURE recordings for the second distinct APK release; do not start those repairs or Task26 before Task25 is truly released.

```text
CLOUD_COMPLETE: NO
CLOUD_BLOCKED: YES
LOCAL_REQUIRED: YES — local Chrome/USB/original signing
DEVICE_DEFERRED: YES — separate accounting/accessibility APK only
TASK25_FULL_PASS: NO
TASK 25 RELEASE STATUS: BLOCKED
READY FOR TASK 26: NO
```
