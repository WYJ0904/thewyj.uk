# thewyj Android

This directory contains the formal Android client for the same `thewyj.uk` product. The fixed release identity is `uk.thewyj.app`; future release and Task 23 work must preserve that application ID, Keystore aliases, device ID namespace, and local storage namespace so in-place updates keep sessions and unsynced browser data.

## Architecture

- Kotlin and Jetpack Compose provide secure authentication, startup/session recovery, the five-item app navigation, account/update surfaces, network recovery, and low-frequency background session maintenance.
- One hardened WebView runs the existing production learning, toolbox, finance, membership/payment, temporary sharing, admin, and in-app message experiences. It accepts only the configured HTTPS origin, blocks mixed/file/content/JavaScript navigation, disables third-party cookies, and does not expose `addJavascriptInterface`.
- Native and WebView requests use the same Task 12 stable user ID. Native receives a short access token plus rotating device refresh credential. The refresh credential is encrypted with an Android Keystore AES-GCM key and is never written to WebView storage. The WebView receives only a short-lived `HttpOnly; Secure; SameSite=Strict` cookie.
- Ambiguous refresh retries persist one rotation request ID, allowing the server to return the same result without creating a second rotation. Replay with another ID revokes the token family.
- Android-specific notification, SMS, accessibility, and automatic transaction capture behavior is not implemented in Task 20. `task21/AndroidCaptureContracts.kt` is an interface-only extension point, and the manifest requests none of those permissions.

## Local build and tests

Install JDK 21 and Android SDK Platform 36, then set `ANDROID_HOME` or `ANDROID_SDK_ROOT`.

```powershell
Set-Location android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

The debug APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk` and is intentionally ignored by Git. To test against a Preview deployment without changing source:

```powershell
.\gradlew.bat assembleDebug -PTHEWYJ_BASE_URL=https://<preview>.thewyj-uk.pages.dev
```

The configured URL must use HTTPS. Debug uses `uk.thewyj.app.debug`; release keeps `uk.thewyj.app`. A local release APK is unsigned unless all four signing values below are supplied from the process environment. Keep the keystore and passwords outside the repository and CI logs.

```powershell
$env:THEWYJ_ANDROID_KEYSTORE_FILE = '<absolute path outside the repository>'
$env:THEWYJ_ANDROID_KEYSTORE_PASSWORD = '<secret>'
$env:THEWYJ_ANDROID_KEY_ALIAS = '<alias>'
$env:THEWYJ_ANDROID_KEY_PASSWORD = '<secret>'
.\gradlew.bat assembleRelease bundleRelease
```

The same signing certificate must be retained for every in-place update. Task 20 CI publishes only the debug acceptance APK; it does not receive release signing credentials.

## Cloudflare Preview

1. Apply `cloudflare/migrations/0015_android_device_sessions.sql` to Preview D1.
2. Create an independent random Preview encrypted secret of at least 32 bytes named `WYJ_TASK20_DEVICE_SESSION_SECRET`.
3. Keep `TASK20_ANDROID_APP_ENABLED=true` only in Preview while testing.
4. Verify `/api/status?source=cloud` reports Task 20 schema ready and its secret configured.
5. Use an isolated account to test login, process death, refresh rotation, revocation, account switch, WebView identity, and every existing web product route.

Production remains `TASK20_ANDROID_APP_ENABLED=false` until CI, Preview, and the mandatory physical-device matrix pass. A rollback disables that flag. The D1 tables and audit-safe digests remain in place; do not drop tables or restore a second account source of truth.

## Update and deep links

`/api/app/config` provides version metadata and an optional HTTPS download page. The app opens that page in the system browser and never silently installs an APK. `thewyj://` is reserved for the internal session refresh/logout bridge and explicit route links. HTTPS links for `thewyj.uk` are declared without auto-verification until a release signing certificate is available; Task 23 can publish `assetlinks.json` for that exact certificate without changing the application ID.

## Required physical-device acceptance

Automation cannot replace the Task 20 device gate. Install an APK on a physical Android device and verify close/reopen, force stop, reboot, Wi-Fi/5G/Wi-Fi switching, VPN on/off, ten-minute airplane mode, access expiry and silent refresh, temporary refresh 5xx, server revoke, logout, clear data, logout-all from another device, and in-place upgrade. Also verify the five tabs, login/register, learning, tools, finance, account, membership/payment, admin/messages where authorized, downloads, back navigation, dark/light system themes, keyboard, and small-screen layout.
