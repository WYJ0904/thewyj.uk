# Aeris V6.2 Samsung Preview verification

Final readback: 2026-10-30 HKT. **Scoped Preview verification PASS; full Android/financial release HELD.** Actual SM-S9360, Android16/API36, with ordinary hardware acceleration and the existing screen-lock policy. No payment application, private chat, real notification, production account, formal ledger or external AI endpoint was used.

## Candidate and isolation

The product source is UI candidate `80139a03b5b655b4f4d7ba4e865778c7654bb91d`. An external Gradle init changes only the Debug application suffix to `uk.thewyj.app.v62spatialqa`; the existing `THEWYJ_BASE_URL` build property targets `https://ac8cec2c.thewyj-p07-ui-rc.pages.dev`. Device injection and payment diagnostics are false. Product Kotlin/Java, official package/version/signing and production bindings are unchanged.

Installed APK SHA-256: `46769e902842e6e9e9ef00969328a0eddb5f02833c2fd84a90a7383e51f3b168`,82,625,833 bytes. AAPT2, generated BuildConfig and a new-install marker were verified before installation. The existing official app and any previous QA installation were not replaced or cleared. A second independently named `uk.thewyj.app.v62spatialqa.test` package provides only ordinary UI input; it does not inject a session, alter membership or call a product test backdoor.

Build command from `android/`:

```powershell
.\gradlew.bat -I ..\qa\aeris-release\android-preview.init.gradle -PTHEWYJ_BASE_URL=https://ac8cec2c.thewyj-p07-ui-rc.pages.dev :app:assembleDebug --no-daemon --console=plain
```

The original compile and later external input-test builds pass. A later test build without a new execution is not counted as another executed test. The private device serial is supplied at runtime, not embedded in committed QA source.

## Actual results and retained failures

| Collection | Actual result | Boundary |
| --- | --- | --- |
| Initial ADB text entry | FAIL: Samsung Chinese IME changed the ASCII username; real authentication safely rejected it | Original XML/image retained; this is not a correct-credential authentication failure |
| First UI-input instrumentation |1 FAIL before submitting credentials: an unnecessary Back left the auth screen | The failed log/APK remain; no second authentication is claimed for this attempt |
| Corrected UI-input instrumentation r3 |1 PASS; exact ASCII preserved, normal native submit reaches authenticated shell in4,442ms within the unchanged20s assertion | ACTION_SET_TEXT is normal Android UI automation; credential file deleted; session injection false |
| First read-only WebView probe | FAIL at its socket guard | Windows ADB CRLF left a trailing carriage return; the same own-process socket matches after trimming. Only QA parsing changed |
| Native/WebView identity | PASS: ordinary same-origin `/api/me` returns200 and the separate validation identity | HTTP-only native cookie; absent localStorage raw token is expected, not authentication failure |
| Actual Preview rendering | PASS: owned origin, initialized document, P07 enabled, native user agent,384px CSS width/384px document width, all three cards in the document | Actual phone screenshot plus own-process DevTools. It is not simultaneous visibility of all three stacked mobile cards |
| Three mobile card editors |3 PASS: actual CDP touch opens learning/finance/tools settings and cancels back home |8s action spacing, real hit-testing, no mock handlers, no monetary operation |
| Layout storage after cancel |1 PASS, unchanged | Same synthetic account; no new settings saved |
| Lifecycle r1 |1 PASS background recovery /1 FAIL early restart observation | At about8s, cold WebView was still on `/select` with UI policy unresolved. The first driver asserted then; it did not observe the entire20s window. The raw failure is retained |
| Lifecycle r2 |2 PASS within the same20s observation deadline: background2,551ms, cold restart11,955ms | Passive readiness samples, no action retries or deadline extension. Cold samples show `/select`/disabled at8,375ms, `/`/enabled at11,955ms |
| Device cleanup | PASS, both newly installed QA packages absent | Formal app1.3.37/code50 and two sensitive-permission configuration digests unchanged |

These collections overlap and are not added into a new independent business-case total. Failed intermediate observer results remain present; transient readiness samples are not separate successful user scenarios. `am start -W`180ms means Activity startup, not the11,955ms document-ready observation. The initial snapshot labelled `restore-observed-20s` was a late diagnostic, not a measured20s acceptance; the controlled r2 timings establish that bound.

The old native-input Kotlin-only/source-discovery and Java assertion iterations are disclosed by the separate build/test logs. A later PASS never erases those failures. This exercise does not close the original intermittent renderer problem by speculation, and does not reopen D-01/D-02 without new direct evidence. No HardwareRenderer/driver root cause was inferred.

## Cleanup and evidence

Both packages were uninstalled using the exact new-install records; no formal app force-stop, clear-data, uninstall or sensitive-permission grant occurred. The private QA credential file was removed in the instrumentation finally block before uninstall. The temporary UI hierarchy file was removed. DevTools forwarding is removed in each observer's finally block. No unrelated forwarding/profile or system security setting was changed. Ordinary keyboard language-switch attempts were paired; this is not a byte-for-byte proof of all phone settings.

Evidence under `docs/migration-evidence/aeris-p03-p07/`:

- `v62-samsung-preview-r1/`: candidate hash, BuildConfig, original failures, r3 login proof, actual screenshot, scoped WebView identity and cleanup readback.
- `v62-samsung-touch-r1/`: four assertions and three actual editor screenshots.
- `v62-samsung-recovery-r1/`: original1 PASS/1 FAIL.
- `v62-samsung-recovery-r2/`: unchanged20s contract, every readiness sample,2 PASS.

Necessary APKs, raw results and screenshots remain private local evidence. This is not an APK publication. Real notification/accessibility/profile isolation, full Room/outbox business acceptance, real transfer settlement, screen-off behavior, long-run stability and W01–W10 are **NOT_TESTED by this collection**. The actual full financial candidate is a separate held branch; this device package validates the UI/main-baseline behavior rather than all unmerged P03–P06 fixes.
