# Release B cloud publication and user update acceptance

## Current handoff — 2026-10-10

The latest user instruction retains the accepted Samsung S25+/Android16 functional results and explicitly cancels the App-internal49→50 manual update test. Its status is **NOT EXECUTED — USER WAIVED**, not PASS or pending user action. No downgrade, reconnect, uninstall or data clearing is authorized for this test. The previous pending wording below is historical. Release B closes only after exact-head CI, accepted immutable APK verification and actual Production Stable50/download/cache acceptance; once that cloud closure passes, Task26 starts from the released main. Task26 retains its own signing/device/release gates.

The user explicitly confirmed all Samsung Android16 functional acceptance on 2026-10-10 and authorized cloud publication without reconnecting ADB. Codex device evidence and user-attested acceptance remain distinct. App-internal update/download/system-install/startup acceptance is **PENDING USER ACCEPTANCE** and must not be changed to PASS without feedback.

Accepted Android source: `5420b2d7403c00c43ae5acd33ae79e45ad1385f1`; merged PR103 source: `5da5b23cee428521a5a61e8f22a3c3b26874de45`. Their complete Git trees match. Candidate CI38033807473 and merged-main CI38036783477 both passed all eight jobs. Final artifact/source verification retains the actual ordinary R8 flags and original certificate.

| Artifact | Verified identity |
| --- | --- |
| APK | uk.thewyj.app, 1.3.37/50, 48,124,983 bytes, SHA256 `9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a` |
| AAB | 24,750,305 bytes, SHA256 `6b61b72e5287766d3bb13af76fe7a7894f8bf963957b747c8be882c629ad9248` |
| Original certificate | `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03` |
| Immutable R2 object | `app/android/thewyj-android-1.3.37.apk`, independently uploaded/read back and signature-verified in wyj-cloud-production and wyj-cloud-preview |

Observed tests include ten isolated tickets against the same existing real WeChat-clone transfer page, exact50000 minor units/INCOME, real accounting notifications, matching local/server transaction IDs and no duplicate replay. Actual offline endpoint failure still saved the local booking before any server receipt; normal network/foreground recovery synchronized the same transaction. The original encrypted session/device identity and100 original bookings were preserved. The final installed APK was read back and exactly matched the artifact above. Additional functional checks are USER_ATTESTED; historical failures and the original recording are retained rather than rewritten.

This metadata change follows successful immutable uploads and readbacks. It advances Gradle defaults, release metadata, all three Wrangler scopes, official Android/site changelog entries and shared asset/SW versions together. It does not change Task25 masters/definitions, infrastructure bindings, business/learning records or payment rules. Release B has no new D1 migration; canonical0024 remains recorded once.

Before merging this metadata PR, verify its complete CI and isolated Preview download. After merging, verify final-main CI, actual Production deployment, GET/HEAD/download hash and signature, stale validators, version comparison, original49 rollback resources and the latest-first changelog/cache. Do not infer those executions from this document. The operational checkpoint and final cloud closure carry actual deployment IDs and results.

Rollback preserves the immutable49 and50 objects and uses the prior complete Pages release configuration:49 key `app/android/thewyj-android-1.3.36.apk`, SHA256 `798ef91a7be32c8d6e181ff4813a173014c0bce73ca4f93077c7030df63ccb48`. Do not downgrade Android, uninstall the original app, clear its data or reset D1.

The functional-test handset already had candidate1.3.37/50 installed. Once Stable is50, that same-version client must show up-to-date; a49 client detects50. Do not fabricate an update prompt by weakening version comparison. Task26 can be prepared on a separate branch after cloud publication, while its formal release stays gated on Release B user update closure and Task26's own acceptance. Task27 has not started.
