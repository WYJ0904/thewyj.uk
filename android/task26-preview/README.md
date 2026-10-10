# Task 26 isolated Preview acceptance app

This debug-only Android module opens the controlled Task 26 hosted Preview for acceptance testing. It is not the production Aeris APK and does not establish acceptance of installed Stable 1.3.37/50.

- Application ID: `uk.thewyj.app.preview`; label: `Aeris Task26 Preview`.
- Fixed origin: `https://codex-task26-adaptive-learni.thewyj-uk.pages.dev`.
- Separate Android sandbox, WebView cookies, DOM storage and cache. No dependency on `:app`, no production account/session bridge and no shared user ID.
- No notification, accessibility, SMS, finance, Room, background worker, FileProvider, APK installer or update component. Library providers and receivers are removed from the merged manifest.
- HTTPS only; external origins, native deep links, finance/payment/notification/update APIs, downloads, file/content access and ambiguous paths are blocked. Service Worker requests follow the same policy.
- The visible network-test control blocks network loads only inside this app's WebView and Service Worker. It does not change the phone's Wi-Fi, mobile network or the production app. Record this as targeted network-failure injection, not a physical radio disconnect.
- Release variants are disabled. The debug signer is a local test signer and must not be described as the original production signer or uploaded to Stable/R2 distribution.

Build and verify:

```text
./gradlew :task26-preview:testDebugUnitTest :task26-preview:lintDebug :task26-preview:assembleDebug
```

The existing root CI command also selects this module's debug tests, lint and assembly. Production `:app` source, manifest, signing inputs and release metadata remain separate.

Before an explicitly authorized device install, inspect the final APK package/version/label/signature and the merged manifest. Install only `uk.thewyj.app.preview`; never uninstall, replace, clear or redirect `uk.thewyj.app`. Use dedicated Preview accounts and restore the five Task 26 flag definitions after acceptance. ADB installation, lifecycle/network/cache/account-isolation observations and the later production WebView test in the original App 50 remain distinct evidence gates.
