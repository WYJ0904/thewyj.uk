# Payment amount / accessibility device regression

This change starts from Task 25 HEAD `6ddc7eb8d4f9ad173170919567c94a8992a1d613`; it does not promote Android, change Stable metadata or continue Task 26.

The reported historical Samsung recording shows a real WeChat ¥0.01 transfer detail followed by a ¥10.00 verified notification. The original recording stays on the phone and a byte-identical local copy has SHA-256 `8749a9913f62109e9fbacb0e02697dd67925ca2c9b6bf0b72be4e7f4c511af39`. It is private evidence and is not checked into Git.

An unmodified current-HEAD signed build was upgraded in place before any business-code changes. It accepted a WeChat home preview for an unrelated ¥50.00 transaction while a detail-verification ticket was active. A hardware OCR probe of the historical ¥0.01 frame read the monetary text correctly, but rejected the traditional transfer template; the old flattened parser also found 58.00 by joining a time node to a subsequent payment word. This is evidence of unsafe page/amount attribution, not proof of a particular missing-decimal transformation in the historical event: that event's original OCR input/logcat is unavailable.

## Change

- Parse currency using exact decimal-to-integer minor units. Reject excess precision, malformed grouping and leading-zero integers that could be an OCR-damaged decimal.
- Preserve logical text/node boundaries. Reconstruct a separate decimal point only from a proven parent token group. Currency-only + complete-number adjacency is constrained; arbitrary numeric siblings are never joined.
- Rank explicit actual-payment labels and isolated currency amounts. Conflicting primary amounts remain pending. Dates, references, discounts, fees and balances cannot win.
- Identify actual detail templates, including the traditional pending outgoing transfer. A future conditional return is not a completed refund. WeChat home/chat activities and summary templates cannot satisfy a detail ticket.
- Pin account, ticket, window and page generation before capturing evidence; validate that identity again after OCR and in the coordinator. Consumed tickets stop accepting evidence and stop appearing in Room's active-package gate.
- Share a finite 8-attempt / 12-second retry budget between events and timers. Content storms cannot consume a scheduled retry early. Null/late roots, OCR cooldown and misses retry within that budget; leaving the foreground page, interruption or destruction cancels it.
- Real ML Kit OCR must agree with an independently scaled reading of the selected monetary region. A disagreement stays pending; it never repairs a number by guessing a scale.
- Diagnostic builds log event/window metadata, counts, monetary candidates, exact minor units, ranking/rejection, retries and opaque transaction/ticket identities. They never log page prose, counterparties, passwords, OTPs or full trees.

## Validation / device procedure

Unit fixtures cover every requested amount from 0.01 through 1000.01, Unicode/full-width/space/locale forms, split nodes, time/order/discount/original-price interference, ambiguity, stale tickets, consumed-ticket replay, low confidence, retry exhaustion, content storms, cancellation and resume.

Build an explicitly instrumentable in-place candidate with the existing signing identity:

```text
./gradlew testReleaseUnitTest lintRelease assembleRelease assembleReleaseAndroidTest \
  -PTHEWYJ_CANDIDATE_VERSION_NAME=1.3.35 -PTHEWYJ_CANDIDATE_VERSION_CODE=48 \
  -PTHEWYJ_PAYMENT_DEVICE_TEST=true -PTHEWYJ_PAYMENT_DIAGNOSTICS=true
```

Normal builds default both flags to false and retain R8/resource shrinking. The test gateway is not an exported component and cannot be installed in an ordinary signed build.

The live instrumentation test uses the actual bound Aeris service, real Samsung accessibility events/window screenshots, the real foreground WeChat ¥0.01 detail, bundled ML Kit, real coordinator, Room implementation and native notification publisher. Only the ticket/ledger fixtures use a separate in-memory Room database; no synthetic transaction is sent to the cloud or written into the real account's ledger. Each iteration leaves/re-enters the same detail via the notification shade, checks one successful verification and exact one-cent booking, then replays the source/ticket to assert idempotence. Between repetitions five and six it returns to Aeris, backgrounds the app, and restores the same WeChat detail task without rebinding the service. The test checks the real user's ledger count and authenticated identity before/after.

`am instrument` first stops the target process. The test explicitly rebinds only the already-enabled Aeris service, restores the exact original secure setting, and sets `FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES`. This setup is separate from product trigger results. Android documents the [UiAutomation suppression flag](https://developer.android.com/reference/android/app/UiAutomation#FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES) and [window screenshot API](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#takeScreenshotOfWindow(int,%20java.util.concurrent.Executor,%20android.accessibilityservice.AccessibilityService.TakeScreenshotCallback)).

```text
adb install -r <same-signer-test-candidate.apk>
adb install -r <same-signer-androidTest.apk>
adb shell am instrument -w -e class uk.thewyj.app.PaymentLivePageRegressionTest \
  -e livePaymentPage true -e repetitions 10 uk.thewyj.app.test/androidx.test.runner.AndroidJUnitRunner
```

Historical-frame hardware OCR and rendered synthetic other-amount OCR are separate tests; neither is labelled as a live accessibility repetition. Final per-case results, hashes, installed version, preserved-data counts and CI state belong to the local closure report. Original user data, original video and Stable pointers are retained.
# Formal R8 follow-up: screenshot cooldown and page debounce

The ordinary signed1.3.36/49 candidate (both payment test flags false) completed the first two live one-cent entries through the production gateway, with exactly one system-observed verification each and one fixture booking each. Entry3 did not trigger. The original account's97 bookings and normal server session were retained.

The actual log showed its empty-tree read at18:49:42.664, at the4,000ms boundary after the previous empty-tree read at18:49:38.670 and successful OCR. The normal log did not record the exact screenshot-request tick; the source and timestamps identify a remaining cooldown below250ms as the failure mechanism. The page retry budget separately debounces reads for250ms. Such a timer fires too early, is rejected by `beginAttempt`, and schedules no successor. The87ms unit fixture represents that short-delay interval; it is not a claim that the failing device's unlogged delay was exactly87ms. This is a cooldown/debounce interaction, not an amount-parser failure.

`PaymentPageRetry.nextDelayMs` now accepts the screenshot delay and raises it to the remaining page debounce before checking the unchanged12-second budget. The service routes every scheduled delay through that decision and emits only a non-sensitive retry reason/count/delay in its existing status log. The8-attempt limit, page/account/ticket/window identity, confidence thresholds and cancellation rules remain. Added tests reproduce the87ms boundary and verify that adjustment cannot extend the deadline. Final hardware acceptance remains unvalidated until all ten entries pass on the rebuilt ordinary R8 artifact; earlier failed evidence is retained.

