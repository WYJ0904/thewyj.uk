# Ordinary signed R8 device acceptance

The payment-device candidate used for PR97 live repetitions is historical evidence. Final Task25 acceptance uses the ordinary `uk.thewyj.app` release, `PAYMENT_DEVICE_TEST=false`, `PAYMENT_DIAGNOSTICS=false`, R8 and resource shrinking enabled, and the original signing certificate. The reviewed target is 1.3.36/49, advancing in place from the installed bugfix 1.3.35/48. Stable remains 1.3.33/46 until the final publication gates pass.

`THEWYJ_RELEASE_ACCEPTANCE=true` selects the release instrumentation target only. It changes neither payment BuildConfig value nor release shrinking. `FormalReleaseDeviceTest` refuses a debug package, an enabled test/diagnostic flag, a non-Samsung device or an Android API other than36. It never installs `PaymentAccessibilityDeviceTest` or a replacement gateway.

The first minified external Runner failed before test execution because app R8 had inlined and removed shared dependency entry points (`androidx.tracing.Trace`, then `kotlin.LazyKt`). The app's normal shrink rules and the external test dependency deduplication required explicit retained public references. `proguard-runtime-contracts.pro` contains exact references inferred from the compiled formal test and the pinned AndroidJUnitRunner using the R8 TraceReferences embedded in AGP9.2.1. It retains112 named classes and specific referenced members; there are no package wildcard rules and no payment injection gateway. Unrelated code and resources remain optimized. The only test-specific `dontwarn` covers the Error Prone annotation's JDK compiler enum; it does not alter the main app's rules.

Reference analysis also reports SDK-stub omissions for Runner hidden instrumentation methods, and an unused test view-capture adapter. These diagnostics are retained as diagnostics; they are not physical acceptance. Every newly referenced app method must be included by regenerating the inferred rules after compiling the test. Actual signed-package execution is the acceptance authority.

The read-only baseline verifies the preserved encrypted session and the original account's Room bookings. Live acceptance normally registers and logs in a new synthetic account, uses the existing authenticated administrator to grant only that account temporary Finance access through `/api/admin/entitlement`, and retains the real phone's device identity. It temporarily switches encrypted native credentials to that account, seeds account-scoped synthetic notification tickets, and drives the actual framework-bound service against an existing real WeChat one-cent detail. Capture, OCR, ticket lookup, verification, real status notifications and local bookings use the production gateway. No new real payment is performed.

Ten iterations assert exact1 cent, once-only booking and consumed-ticket rejection, including a return to Aeris, Home and the same WeChat detail. Only fixture notification IDs are cancelled. The original account's booking values must remain identical. The `finally` path restores the original encrypted credentials and revokes the fixture Finance entitlement. An encrypted on-device original-session backup remains available during acceptance; it is never exported to a report. Failed or unexecuted checks remain blockers. The original recording and previous evidence are preserved.

Build and select only the opted-in methods:

```text
THEWYJ_PAYMENT_DEVICE_TEST=false
THEWYJ_PAYMENT_DIAGNOSTICS=false
THEWYJ_RELEASE_ACCEPTANCE=true
:app:assembleRelease :app:bundleRelease :app:assembleReleaseAndroidTest
formalAcceptance=true
class=uk.thewyj.app.FormalReleaseDeviceTest#originalAccountAndRoomBaseline
class=uk.thewyj.app.FormalReleaseDeviceTest#tenLiveOneCentEntriesThroughOrdinaryProductionGateway
livePaymentPage=true
wechatTask=<observed current detail task id>
```

This payment test does not substitute for the remaining29-item Samsung receipt, hosted Preview, Production, main CI or final download acceptance. No release pointer may move on the basis of a successful test build alone.

References: [Android keep rules](https://developer.android.com/topic/performance/app-optimization/keep-rules-overview), [R8 reference-derived test rules](https://source.android.com/docs/core/perf/r8-optimization).
