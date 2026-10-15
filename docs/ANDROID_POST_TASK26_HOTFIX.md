# Android post-Task26 Hotfix — in progress

Started2026-10-15 Asia/Hong_Kong from released main74eadf589b0a6ffe1e5ab7a9564115891c4ef2dc on independent branch codex/android-accessibility-accounting-hotfix. Task26 is CLOSED_WITH_OWNER_WAIVER in the actual Windows release report, serving deployment566292b3-3c7f-4ef5-93b5-6977e606c14a, exact candidate/main CI8/8, Git auto deployment restored. The two owner rollout waivers and original App50 isolated-write waiver remain distinct from PASS.

## Baseline and verified source findings

- Connected Samsung SM-S9360 / Android16, original packageuk.thewyj.app1.3.37/50. Existing Users0/95/150 remain; no User10. No app data, permissions, Cookie, Room, account, APK, signing or Stable pointer changed by this audit.
- PaymentPageContext.pendingOutgoing matches any exact 待…收款 line. Together with transfer-time context this incorrectly classifies 待你收款 as outgoing.
- PaymentAutoBook.eligible checks only amount and direction. Coordinator uses it on notification, enrichment, replay and recovery; it does not persist a separate completion proof in recognition schema9. A pending transfer may therefore become an automatic ledger entry. Completion must be independent from amount/direction, durable across restart, and UNKNOWN for old unproven records.
- WeChatPaymentParser promotes payment-channel title plus amount/direction to CONFIRMED_PAYMENT even without completion evidence. Pending wording must prevent that promotion.
- OCR missing-currency recovery requires exact detail title and transfer-time labels before its geometry and second-scale confirmation. A redacted pending receipt without the optional title is a regression case; the actual failed Samsung OCR output has not yet been observed. Do not claim its missing glyph as a proven device root cause.
- Scan budget is8 attempts /12 seconds under a90-second ticket. Same-key late events reuse an exhausted scan; read coalescing drops a trailing event while a worker read is queued. Targeted lifecycle/retry reproduction remains required.

## Safety and validation scope

Keep existing event/account identities, source matching, amount conflict rejection, exact minor units, second-scale OCR confirmation, local-first persistence, real cloud receipts and manual confirmation. Preserve existing booked ledger identities; do not reinterpret old records as completed or delete them. Any durable new field needs an additive Room migration and preservation tests. Continue auditing notification/accessibility/OCR to local candidate, ledger, cloud receipt and UI; do not assume all later stages are correct.

PendingTransferSafetyRegressionTest contains synthetic parser cases only. It is not WeChat/clone/Alipay device acceptance. No real transfer or purchase is authorized. Real acceptance must use existing lawful receipts or owner interaction, without modifying historical data to manufacture a result.

Hotfix release is NOT COMPLETE. Native code fixes, targeted tests, ordinary original-signature candidate, real Samsung scope, source/receipt/sync/UI regression and independent release remain pending. Financial AI is NOT STARTED and must wait for this Hotfix Closure.

## Implemented candidate changes (not released)

- Separate completion from amount/direction in parsers, the capture queue, coordinator, durable recognition and server ingest/hints. Awaiting-my-receipt is income evidence, not outgoing or settled money. Both monetary fields remain available for manual review.
- Room9 to10 adds completionConfirmed=false and sourceUid=-1. Old unknown recognitions cannot acquire settlement proof from their monetary fields. Already booked ledger and real cloud receipt identities are preserved.
- Parser4 / local-autobook-v2 identify the new completion contract. Older parsed notifications and old CONFIRMED hints remain reviewable unless an actual ledger receipt already exists. Explicit authenticated manual confirmation still works. New settled hint proof cannot borrow a legacy high-ranked status or depend on confidence alone.
- Pending-summary recovery only repairs projections from an existing account/event ledger receipt. A refresh no longer calls the manual-confirm transaction-creation path.
- A later settled notification keeps the original candidate/event. Its settlement proof is durably queued separately, and an old ingest replay returns the actual newer ledger receipt. An old candidate acknowledgement can no longer leave a locally booked outbox stuck forever.
- Eight bounded accessibility reads now span the90-second ticket; window changes share the same budget. The latest queued foreground read is retained. Unbind/destroy cancel stale work.
- Source UID comes from StatusBarNotification and stays local. The launch button uses public LauncherApps profile APIs for the exact origin, with no main-app fallback when a clone launch is denied. Unknown/ambiguous clone pages require manual source confirmation unless the exact provider reference matches. Conflicting reference, amount or direction is rejected.
- Missing-currency pending-page OCR retains geometry, uniqueness and second-scale confirmation. It does not imply completion. No model/financial-AI change is included.

## Actual verification and remaining release gates

Windows logs under the existing outputs directory preserve the initial red pending-transfer regression, broader failures and subsequent results. ANDROID_HOTFIX_FULL_NATIVE_REGRESSION.log and ANDROID_HOTFIX_COMPLETION_CONTRACT_NATIVE_TEST.log passed the full561-test Android suite and Lint. The latter includes compilation of the opt-in real-receipt instrumentation. ANDROID_HOTFIX_NOTIFICATION_V4_CONTRACT_TEST.log and ANDROID_HOTFIX_HINT_V4_CONTRACT_TEST.log pass the complete server suites, including legacy-client review, manual confirmation, receipt-only recovery, account boundaries and idempotence. Existing payment/entitlement checks also passed. These are computer/local tests.

The owner selected an existing WeChat-clone receipt:120CNY, received. Actual ADB metadata confirmed User95 and RemittanceDetailUI. The USB/ADB interface then disappeared, including after a reported reconnect and normal ADB-server restart. The opt-in OwnerSelectedReceiptTest is built but NOT RUN. It reads only the selected foreground page, runs actual on-device MLKit without saving/uploading screenshots, and uses an in-memory coordinator. It does not count as a new notification, an ordinary signed APK test, cloud synchronization or full service lifecycle acceptance.

No debug/test package has been installed in this round, no funds operation was executed, and the original App50 / accounts / Cookie / Room / permission state / profiles / signing / Stable pointer have not been changed. No Hotfix Production deployment or release has occurred.

Required next gates: exact-HEAD CI/review and hosted Preview API tests; ordinary original-signature candidate51/1.3.38 with protected data and genuine Samsung main-WeChat/clone/Alipay lifecycle/offline/dedupe/manual/sync/UI acceptance; immutable APK and independent release health/Closure. Recheck actual Stable version before staging any signed candidate.

Deploy the fixed backend before a Production-connected new native candidate. If cloud recognition must be stopped, disable its existing cloud write gates and retain the local outbox; do not roll back to the old money-only auto-booking implementation. Room10 needs a forward-compatible repair, not an App50 downgrade, reset or destructive migration. No existing account/price/entitlement changes are required.
