# Task 25 feature flags and release channels

Task 25 evaluates optional features on the server for the canonical authenticated account. Flags do not grant business permissions. Existing membership, finance, notification and file authorization still applies.

## Evaluation and defaults

Precedence is kill switch → global OFF → excluded channel → account ON/OFF override → percentage rollout. An override cannot bypass a kill switch, global OFF or channel exclusion. A missing preference means `stable`. Allowed channels are explicitly enumerated; Beta does not implicitly include Experimental.

The deterministic bucket is `floor(first_uint32_be(SHA256(flag_key + NUL + canonical_user_id)) * 10000 / 2^32)`. A bucket is enabled when it is less than `rollout_basis_points`. Percentages accept increments of 0.01%, with 0% OFF and 100% ON. Browser, native and WebView consume the server decision and do not derive independent buckets.

`0024_feature_flags_release_channels.sql` adds only Task 25 tables/triggers/indexes. Reapplying it preserves existing records. Both seeded flags are OFF: `task25_validation` has no business effects; `aeris_experimental_badge` is cosmetic. Production's service master switch remains `TASK25_FEATURE_FLAGS_ENABLED=false`; Preview is separately configured. No stable Android object or pointer is part of this migration.

Snapshots are private/no-store, account-bound and valid for at most 30 seconds. Expired, malformed, unknown-account, offline, paused or failed refresh decisions are OFF. Clients clear the previous snapshot before requests and discard stale completions after account/lifecycle changes. Decisions are memory-only. The kill switch takes effect for new evaluations immediately and existing snapshots expire within 30 seconds; it is not a substitute for server authorization.

## HTTP contract

Existing Task 12 browser sessions and Task 20 native/WebView credentials resolve the same canonical account. Query parameters are rejected. Mutations use the existing CSRF protection, strict field/type validation, an 8 KiB body limit, and account rate limits (120 GET / 30 POST per 60 seconds per route). Credentials and decisions are not written to logs.

| Route | Authorization | Request/response |
| --- | --- | --- |
| `GET /api/features` | Account | `{ok, snapshot}`; snapshot includes schema/account/channel/revisions/expiry/decisions |
| `GET /api/release-channel` | Account | `{ok, channel, revision}` |
| `POST /api/release-channel` | Account | `{channel, expected_revision}` → `{ok, snapshot}`; only the caller's preference changes |
| `GET /api/admin/feature-flags` | Administrator | `{ok, flags, audit}`; at most 200 definitions and 100 recent audit entries |
| `POST /api/admin/feature-flags` | Administrator | `{flag_key, description, enabled, kill_switch, channels, rollout_percentage, expected_revision}` → `{ok, flag}` |
| `POST /api/admin/feature-flags/override` | Administrator | `{flag_key, user_id, enabled, expected_revision}` → `{ok, override}`; enabled is true/false/null (inherit) |
| `POST /api/admin/feature-flags/evaluate` | Administrator | `{user_id, channel?}` → `{ok, snapshot, simulation:true}`; dry run never saves a preference |

Revision zero creates a definition/preference. Existing writes require the current revision; conflicts return 409. Flag/override changes and their audit records commit together. Override writes use a transaction nonce so a losing concurrent revision check cannot write against the winner's revision. Disabled master/dependency/unready schema return 503; unauthenticated/forbidden/rate-limited calls return 401/403/429. Unsupported methods return 405.

## Android release protection

Stable stays 1.3.33/46 with its existing R2 key, update endpoint, hash and signing certificate. Stable/Beta/Experimental are account feature preferences; changing one cannot install an APK or publish a candidate. All channels retain the formal `/api/app/config` and `/api/app/download` release until a separate binary release gate passes.

Candidate 1.3.34/47 is built with Gradle properties `THEWYJ_CANDIDATE_VERSION_NAME` and `THEWYJ_CANDIDATE_VERSION_CODE`; repository defaults remain Stable. `scripts/stage_android_candidate.py` records APK/AAB hashes, byte sizes, signing state and `stablePromotionAllowed:false`, and refuses to replace Stable metadata. Unsigned candidates are software artifacts, not install/upgrade acceptance. The signed workflow requires the existing signing secrets and verifies the resulting certificate against Stable. No new keystore is generated.

## Reproducible software acceptance

- `npm run test:task25`: D1/API contract/security/concurrency/audit/migration tests and shared Web vectors.
- `WYJ_TEST_ADMIN_SECRET=<isolated fixture secret> node qa/task25/feature-flags-browser.mjs`: local Pages/D1/R2 browser acceptance at 390/1366px; hostname is restricted to 127.0.0.1 to prevent Production fixtures.
- `cd android && ./gradlew testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest assembleRelease bundleRelease`: JVM, lint and build acceptance.
- `./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=uk.thewyj.app.FeatureContractInstrumentedTest`: the same 19 vectors on Android runtime. The CI emulator is software evidence and does not replace Samsung physical acceptance.
- Core CI records cloud/signing credential presence as booleans. A successful discovery job is not deployment evidence. Missing credentials remain release blockers.

Final status, evidence links and recovery instructions are in `TASK25_EXECUTION.md` and `TASK25_CLOSURE.md`. Task 26 requires an actual Task 25 release closure.
