# Task 20 Android audit

## Scope and fixed identity

- Product name: `thewyj`.
- Release `applicationId` and namespace: `uk.thewyj.app`.
- Shared service identity: existing Task 12 stable user ID, Task 13 entitlements, and same-origin Cloudflare APIs.
- Native navigation: Home, Learning, Tools, Finance, My.
- Mature product functions remain in the single hardened WebView; no plan, price, entitlement, payment QR, finance rule, or admin rule is copied into Android.

## Legacy DailyPayGuard audit

The locally available legacy prototype outside this repository was inspected on 2026-09-04. It is a separate `com.yj.dailypayguard` Compose application with a `NotificationListenerService`, boot receiver, and local single-screen finance UI. `TransactionStore.kt` stores `timestamp`, decimal amount, source, Chinese type, and display time as tab-separated lines in plaintext SharedPreferences `daily_pay_guard_store/records`; the timestamp is also used as the record ID. Its daily limit is a float preference. It has no thewyj account, stable server user ID, session rotation, cloud ownership, canonical finance revision, tombstone, or durable upload receipt.

Task 20 does not copy its manifest permissions, listener, boot receiver, plaintext store, parser, or package identity. The old private SharedPreferences are inaccessible to a differently signed/package-named app. Existing Task 16's dry-run-first DailyPayGuard migration tool remains the supported auditable path; Task 21 may add an explicit user-controlled export/import handoff after separate review. No old record is silently discarded or uploaded by Task 20.

## Session and data boundaries

| Concern | Implementation / acceptance |
| --- | --- |
| Access | 15-minute Task 12 token; digest only in D1; short HttpOnly cookie in WebView |
| Refresh | 180-day sliding rotating credential; digest only in D1; AES-GCM ciphertext protected by Android Keystore |
| Retry | Stable pending rotation UUID survives ambiguous timeout; same UUID is idempotent |
| Replay | Reuse with a different rotation UUID revokes the device token family |
| Network change | IP, NAT, ASN, Wi-Fi, mobile data, VPN, and Cloudflare edge are not session identity |
| Offline | Cached account enters explicit offline mode; timeout/429/5xx never clears credentials |
| Terminal | Logout, revoke/reuse, expiry, ban, delete, session generation change, or cleared app data |
| Account switch | Old cookie, WebView local/session storage, HTTP auth, browser finance/learning queues, and cached account are cleared before new cookie installation |
| Update | Fixed package/storage/Keystore names preserve session and WebView data across in-place upgrade |
| Background | Unique WorkManager job every 12 hours with network constraint and exponential retry; no permanent service or polling loop |

## WebView threat model

- Only the exact configured HTTPS origin remains in-app; foreign HTTPS, mail, and telephone links leave the app.
- HTTP, JavaScript, file, content, data, intent, and unknown custom schemes are blocked.
- Mixed content, file/content access, multiple windows, automatic JS windows, and third-party cookies are disabled.
- No Java object is exposed to page JavaScript. Two fixed custom-URI actions request native refresh or logout without transferring a token.
- Downloads are limited to the trusted origin and receive only the current short-lived cookie. Long-term refresh credentials never enter WebView, localStorage, logs, crash data, APK resources, or download URLs.

## Cloudflare changes and rollout

- Migration `0015_android_device_sessions.sql` adds device session metadata and used-refresh receipts without changing user IDs or business tables.
- New endpoints: `GET /api/app/config`, `POST /api/app/login`, `POST /api/app/session/refresh`, `POST /api/app/session/logout`, and `GET /api/app/session`.
- Required encrypted secret: `WYJ_TASK20_DEVICE_SESSION_SECRET`, independently generated per environment.
- Preview flag is on. Production flag remains off until physical-device acceptance and an explicit Production rollout.
- Rollback is flag-only. Keep D1 rows so a later retry can be audited; do not drop tables, reset users, or restore local account writes.

## Related bug audit

- Native registration now sends the existing Task 12 `confirm_secret` field; without it, every App registration was rejected before account creation.
- Preview builds derive every in-App route from `BuildConfig.THEWYJ_BASE_URL`; they no longer escape to the Production origin when navigation state changes.
- Network recovery is single-flight and an already-online session ignores availability replays. Only a changed access credential advances the WebView session epoch.
- A logout carrying a refresh credential whose rotation response was lost follows the used-token receipt back to the current device session and revokes it instead of returning a false success.
- Pending logout records survive only retryable transport failures. Unexpected Keystore, decryption, serialization or persistence errors preserve the encrypted record and key; they show a retryable recovery screen instead of silently deleting credentials. Permanent key loss still requires explicit recovery, not an automatic account reset.
- Release signing inputs are process-environment only. Keystores, passwords, unsigned release outputs, APKs, and AABs remain outside Git; CI distributes only the debug acceptance APK until the release certificate is provisioned.

## Automated acceptance

- D1/Miniflare: stable user ID, non-App rejection, login failure, digest-only storage, header/cookie identity, rotation, idempotent retry, replay revoke, session generation, device mismatch, logout, account switch, missing secret.
- JVM: startup policy, valid/expired token decisions, offline retention, terminal revocation, stable rotation ID, account switch cleanup, deferred logout, strict navigation origin/custom actions.
- Android: Compose compile, unit tests, lint, debug APK, manifest permission contract, Keystore/static security gate.
- Web: native UA returns an in-memory cookie sentinel, removes legacy/canonical browser tokens, never emits sentinel as an auth header, and signals refresh/logout through fixed custom URIs.

## Physical-device gate

Task 20 is not complete until the 17 mandatory persistence scenarios in the task specification pass on a physical Android device. CI and emulator-like browser tests are supporting evidence only. Record device model, Android/WebView versions, network transitions, APK versions, result, and any retained test account cleanup outside the repository.

## 2026-09-05 device remediation (acceptance still in progress)

Device: Samsung SM-S9360, Android 16 / API 36, WebView 151.0.7922.199.
Debug package: `uk.thewyj.app.debug`, version `1.0.0-debug` / code 1.
Verified installed APK hash matched the locally built APK; its configured origin is
`https://7fce0a47.thewyj-uk.pages.dev`. Preview status reports Task 20 schema v1,
enabled and secret configured. Production remains disabled, with schema/secret not enabled.

### Findings and fixes

- Login wrongly shared registration's seven-character minimum. Existing-account login now accepts a nonempty secret; registration retains the seven-character rule. No existing account password was modified.
- Native errors read `message` only, while the API emits `error`. The UI now preserves error text and code. Debug logs contain method/path/HTTP status/error code only, never credentials or response bodies. A real fixture failure was `403 invalid_credentials`: the phone's Pinyin IME had converted the ASCII username. After correcting input, the same native Preview login returned 200. This does not establish the cause of a different user's earlier login failure.
- Browser history updated the same route state consumed by the native `loadUrl` effect; old nonzero refresh epochs could also replay on WebView recreation. Native navigation commands now have a separate epoch, browser history is observation only, and one edge-triggered load policy consumes navigation/refresh. Ordinary navigation does not rotate credentials.
- An expired-access cold start previously published `Authenticated(RECOVERING)` before refresh/cookie completion. That mounted WebView with missing/expired authentication and could request a second native refresh. Cold start now remains `Initializing` until credentials and cookie are ready; a suspended-refresh regression test enforces the ordering.
- Broad credential-read catches previously erased stored ciphertext; broad save catches erased the key and all records. These destructive fallbacks were removed. A real Keystore test verifies reconstruction by a new store, full JSON round-trip, encrypted-only storage and preservation on a corrupted read. Account membership labels now round-trip too.
- Cookie persistence now waits for the accepted `setCookie` callback before flushing. Cookie operations dispatch onto the main Looper, including WorkManager calls; rejection retains the saved device credential and offers retry.
- Web file inputs now have a scoped system file-picker callback, including cancel/disposal handling. Actual file selection acceptance remains a separate device check.
- A night Android window theme makes WebView `prefers-color-scheme` match the native dark theme. The new-secret field uses a password keyboard without autocorrect.

### Evidence and remaining gates

- D1/Miniflare: 18 tests pass, including a six-character historical PBKDF2 fixture, unchanged new-password minimum, cookie/header identity, revocation and rotating refresh.
- Physical instrumentation: encrypted storage, safe read failure, Cookie callback and backend error contract checks are implemented in `DeviceCredentialTest` (3 tests).
- Physical smoke: six native route transitions each produced exactly one main-document navigation; Home-return retained the live document. `am kill` and `am force-stop` produced new processes that restored the same fixture identity. Access/refresh credentials never appeared in JS cookies or localStorage. The 384 CSS-pixel viewport had no horizontal overflow.
- A test-driver race attached CDP before the recreated document finished loading; the runner now waits for document readiness before evaluating identity. No product delay or extra reload was added.
- The original reported loss of login has not been reproduced deterministically on the retained fixture. A successful force-stop recovery was observed before and after these fixes. Do not claim an exclusive root cause or all reboot/network scenarios passed from these results.
- Still required: the user's actual six-character admin login on the intended Preview, recents swipe, phone reboot/unlock, Wi-Fi/mobile and VPN transitions, remaining mandatory long-session scenarios. No Task 20 DONE claim and no Production rollout yet.

### Repeatable commands

From `android`, run `gradlew testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest -PTHEWYJ_BASE_URL=<Preview HTTPS origin>`.
Install both debug APKs, then run `adb shell am instrument -w -e class uk.thewyj.app.DeviceCredentialTest uk.thewyj.app.debug.test/androidx.test.runner.AndroidJUnitRunner`.
The instrumentation test uses its own random preference/Keystore namespace and never replaces the user's credentials.

For the physical flow runner, sign in an isolated Preview fixture first. Set `ADB`, `ANDROID_SERIAL`, `TASK20_PREVIEW_URL`, `TASK20_FIXTURE_USER_ID` and optionally an outside-repository `TASK20_REPORT` path, then run `node qa/task20_device_smoke.mjs`.
This intentionally backgrounds and stops only the debug app; it never clears app data. It checks ownership, cookie isolation, navigation document counts and cold-process restoration.
