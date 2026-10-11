# Release B — final cloud closure, 2026-10-10

Release B is formally published. This report supersedes the pending update-user-test wording and historical offline statuses in RELEASE_B_RELEASE_STATE.md and RELEASE_B_OFFLINE_READINESS.md. Historical failures and device evidence are retained. Dates below are UTC; the user-facing release date is2026-10-10 in Hong Kong.

| Gate | Actual result |
| --- | --- |
| IMPLEMENTATION | PASS — accepted Android source5420b2d/PR103 plus reviewed Web/metadata publication |
| CI | PASS — PR104 final66dda3d and final-main550bc41 both actual8/8 SUCCESS |
| PRODUCTION | PASS — existing Pages project thewyj-uk, deployment575097ca-d940-4100-af6f-cb689518c7b4 |
| STABLE50 | RELEASED —1.3.37/versionCode50, original signed accepted APK |
| SAMSUNG FUNCTIONAL ACCEPTANCE | PASS — existing recorded evidence and explicit user attestation for the exact installed APK; no new cloud physical test claimed |
| APP INTERNAL UPDATE USER TEST | NOT EXECUTED — USER WAIVED; no downgrade/reconnect/uninstall/data clearing |
| RELEASE B CLOSURE | COMPLETE |

## Source and automated acceptance

- [PR103](https://github.com/WYJ0904/thewyj.uk/pull/103) accepted source5420b2d7403c00c43ae5acd33ae79e45ad1385f1, merged5da5b23cee428521a5a61e8f22a3c3b26874de45. Existing Samsung S25+/Android16 transfer/OCR, duplicate protection, offline recovery, session and booking preservation evidence remains valid.
- [PR104](https://github.com/WYJ0904/thewyj.uk/pull/104) merged2026-10-10T09:42:11Z; final reviewed head66dda3dc9bf2bcc9e9890402972f9b84e7ea4764; [main550bc41bbaa01751d75c109f3246b9e174e4460d](https://github.com/WYJ0904/thewyj.uk/commit/550bc41bbaa01751d75c109f3246b9e174e4460d). Main and reviewed PR trees are identical, edd69c015dd6a5368ef28907191055775ef72847. Main and worktree were freshly checked at closure.
- [PR CI38041538855](https://github.com/WYJ0904/thewyj.uk/actions/runs/38041538855) and [main CI38042322159](https://github.com/WYJ0904/thewyj.uk/actions/runs/38042322159): all eight jobs completed SUCCESS, none failed/skipped/cancelled. Jobs: Python; JavaScript/static; sensitive files; Android unit/lint/build; Android runtime contract; application browser; cloud-only browser/session/toolbox; credential discovery.
- Actual PR Android report:545 JVM tests,0 failures,0 skipped; lint/build passed. Runtime testing used an isolated Android11 emulator, not the Samsung.
- Application browser artifacts independently inspected for PR and main:24/24,0 runtime errors. Task25 D1/API12 groups and19 shared Web/native vectors passed. Static31 and release-protection22 checks retained. Independent APK/config guard46 checks and23 release-related Python tests also passed in this cloud executor.
- Fixed the remaining quoted-key changelog fixture bug by reading the actual published runtime entries, retaining the latest-version assertions. Hosted browser testing also discovered an unbreakable historical technical string at768px; repaired text wrapping, added five-width assertions and advanced the shared asset/SW cache token. No Android implementation/backend/migration changes or weakening of tests.

## Exact artifact and distribution

| Field | Verified value |
| --- | --- |
| Package | uk.thewyj.app |
| Version |1.3.37 /50 |
| APK SHA256 |9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a |
| APK size |48,124,983bytes |
| Original certificate SHA256 |2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03 |
| Immutable R2 key |app/android/thewyj-android-1.3.37.apk |
| Production metadata |https://thewyj.uk/api/app/config |
| Production download |https://thewyj.uk/api/app/download |
| Reused AAB record |24,750,305bytes; SHA2566b61b72e5287766d3bb13af76fe7a7894f8bf963957b747c8be882c629ad9248 |

The APK was independently downloaded, manifest/signature/hash/size verified in this executor from Preview and Production, and matches the user-accepted installed50 exactly. Android implementation/proguard sources remain identical to5420b2d. No new APK build/signing identity was substituted. The AAB record reuses the existing signed-candidate report in RELEASE_B_RELEASE_STATE.md; its binary was not independently reacquired or published in this cloud session.

Original upload/readback verification in both wyj-cloud-production and wyj-cloud-preview is reused from the existing release record. This session did not re-upload or overwrite any immutable object. Fresh Production-backed download readback proves the active50 distribution returns the accepted bytes; fresh private bucket inventory was not available and is not claimed.

Exact-head [Preview1d51eae4](https://1d51eae4.thewyj-uk.pages.dev), deployment1d51eae4-86d3-4561-90dd-476f58b967ee, and Production both passed real cloud Chromium checks at320/390/768/1366/1920px: newest-first changelog, reload persistence, one Release B entry, no horizontal overflow, correct download UI, and actual browser APK download/hash. Production API probes passed HEAD plus browser/native/WebView HTTP GET, cache-miss and stale-validator full-byte readbacks, MIME/length/hash headers and private,no-store caching. HTTP native/WebView user agents are transport evidence, not new physical-device execution.

## Production, compatibility and data protection

[Production Pages deployment](https://dash.cloudflare.com/?to=/97c274a981e8dd6703aa6388e11c4614/pages/view/thewyj-uk/575097ca-d940-4100-af6f-cb689518c7b4) succeeded for final-main550bc41. Fresh Production app.js, canonical homepage HTML, product-ui.css and sw.js bytes match that source. Public metadata reports the exact50 version/file/hash/size/date/release notes. Official Web version2026.10.10.1 and Android1.3.37 logs are latest-first and the SW/assets use20261010-aeris-release-b50-r1.

Production environment/health, D1/R2/Workers-AI binding availability, business feature switches and public membership catalog were compared before/after and remain unchanged. Protected account/Feature Flag/admin/Finance/notification/tool routes reject anonymous calls; public membership/share/transfer/changelog routes stay available. Hosted Preview browser/native/WebView canonical identity, three channels and ordinary-user admin403 passed, and the owned synthetic account/session cleanup passed. Existing Task25 accepted Production admin/rollout evidence is retained; the current exact-source isolated admin browser CI passed. No new privileged Production Admin smoke or private user-data query is claimed without a session.

**No new D1 migration is required or executed for Release B.** Canonical0024 remains byte-identical, SHA25667712cbe6da1f35fdd59d2b4806c164869e06d840b1ae652a3e8f6f082018173; existing Task25 migration evidence is retained. No ledger inserted, no Time Travel restore/reset, no user/Finance/notification/payment/file/learning record deleted or reset. Source review confirms no backend/data implementation changes; all tracked D1/R2/AI bindings and non-Android variables are unchanged. This is non-destructive scope and regression evidence, not a fresh census of private Production records.

Current cloud/Actions Cloudflare administrator, signing and admin-session inputs remain absent; Wranglerwhoami is unauthenticated. This does not undo the existing accepted signed50, immutable uploads or observed Pages Git Production deployment. It does prevent inventing fresh private management operations and remains relevant to Task26 migration/signing gates.

## Rollback and continuation

Prior source5da5b23cee428521a5a61e8f22a3c3b26874de45 and associated deployment9cb40083-a522-45d7-a103-681764e30329 preserve the previous49 release configuration. Previous49 APK was freshly downloaded and independently signature/hash checked: keyapp/android/thewyj-android-1.3.36.apk, SHA256798ef91a7be32c8d6e181ff4813a173014c0bce73ca4f93077c7030df63ccb48, same original certificate. Retain both49 and50 objects. If an actual critical regression occurs, restore the prior complete Pages configuration on the existing project and verify its metadata/download readback; do not overwrite objects, force Android downgrade/uninstall, clear data, or reset D1. Rollback was prepared; no rollback is active or was executed.

Release A/Task25 was already formally released and accepted per TASK25_CLOSURE.md and PR96's final evidence. With Release B cloud closure complete and the explicit update-test waiver recorded, Task26 may start from final released main550bc41 on an independent branch. Task26 must retain its own Preview/D1/flags/entitlement/signing/physical gates; this Release B Samsung evidence does not establish Task26 physical acceptance. Task27 has not started.

Non-sensitive live evidence is saved in docs/releases/release-b/2026-10-10; original failed runs95001a0/38039621835 and historical device failure records remain inspectable.
