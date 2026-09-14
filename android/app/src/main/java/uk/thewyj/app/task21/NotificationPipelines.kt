package uk.thewyj.app.task21

/**
 * Task 24.1 architecture: one raw Android notification, two independent
 * consumers.
 *
 * ```
 * NotificationListenerService
 *   └── raw event
 *         ├── NotificationArchivePipeline   (NotiStar-style history, classifier, retention)
 *         └── PaymentRecognitionPipeline    (amount/direction/merchant → Finance)
 * ```
 *
 * The archive pipeline never creates Finance rows, and the payment pipeline
 * never depends on the archive having stored the notification: a finance-only
 * account still recognises payments while an archive-only account never books
 * one.
 */
class NotificationArchivePipeline(
    private val archiveFor: (accountId: String) -> NotificationArchiveStore,
    private val sink: NotificationArchiveSink?,
) {
    data class Result(val stored: Boolean, val classification: NotificationClass, val reason: String)

    fun consume(
        accountId: String,
        archiveEntitled: Boolean,
        input: NotificationCaptureInput,
        structured: StructuredNotificationEvent?,
        identityKey: String,
    ): Result {
        if (!archiveEntitled) {
            return Result(false, NotificationClass.MESSAGE, "no_archive_entitlement")
        }
        val classified = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = input.sourcePackage,
                channelId = input.channelId,
                title = input.title,
                text = input.text,
                bigText = input.bigText,
                subText = input.subText,
                isOngoing = input.isOngoing,
                isForegroundService = input.isForegroundService,
                isGroupSummary = input.isGroupSummary,
                hasMedia = input.mediaState == "available" || input.mediaState == "unavailable",
                // B-5: only a readable picture may override the live-source
                // filter; "unavailable" media on a live status notification must
                // stay filtered instead of appending a revision per tick.
                mediaAvailable = input.mediaState == "available",
                // Coalescing is only safe with a real Android identity. Calls
                // that carry no key/id/tag (legacy entry points) must never be
                // treated as a repeating readout.
                identityKey = if (
                    input.notificationKey.isNotBlank() ||
                    input.notificationId != 0 ||
                    input.tag.isNotBlank()
                ) {
                    "$accountId\u001F$identityKey"
                } else {
                    ""
                },
                occurredAtMs = if (input.postTime > 0) input.postTime else input.receivedAtMs,
            ),
        )
        // A payment candidate and its notification history are two views of the
        // same raw notification. Some payment/banking apps mark receipt notices
        // ongoing or put them on a progress-like channel; the generic archive
        // classifier may legitimately filter those flags, but it must not make
        // the evidence disappear while Finance still shows a candidate. An
        // explicit per-app "off" policy remains authoritative in the sink.
        val paymentEvidence = structured != null &&
            structured.eventType in setOf(NotificationEventType.TRANSACTION, NotificationEventType.REFUND) &&
            structured.parseStatus != ParseStatus.UNPARSED
        val classification = if (paymentEvidence && !classified.storeInArchive) {
            NotificationClassification(
                kind = NotificationClass.MESSAGE,
                storeInArchive = true,
                reason = "payment_evidence",
            )
        } else {
            classified
        }
        if (!classification.storeInArchive) {
            CaptureTrace.stage(
                CaptureTrace.traceId(input.notificationKey, input.sourcePackage, input.notificationId),
                "archive-skipped",
                "reason=${classification.reason} class=${classification.kind.name.lowercase()}",
            )
            return Result(false, classification.kind, classification.reason)
        }
        if (sink != null) {
            // #5: an updating readout carries the coalesce decision into the
            // store, where the existing row is rewritten instead of appended.
            val stored = sink.store(
                accountId,
                input.copy(coalesceWithPrevious = classification.coalesceWithPrevious),
                structured,
            )
            return Result(stored, classification.kind, classification.reason)
        }
        archiveFor(accountId).append(
            LocalNotificationRecord(
                id = structured?.eventId.orEmpty(),
                eventId = structured?.eventId.orEmpty(),
                fingerprint = structured?.fingerprint.orEmpty(),
                sourcePackage = input.sourcePackage,
                title = input.title,
                text = input.text,
                bigText = input.bigText,
                subText = input.subText,
                receivedAtMs = input.receivedAtMs,
                parseStatus = structured?.parseStatus ?: ParseStatus.UNPARSED,
                direction = structured?.direction ?: FinanceDirection.UNKNOWN,
                amountMinor = structured?.amountMinor ?: 0,
                currency = structured?.currency ?: "CNY",
                merchant = structured?.merchant.orEmpty(),
                confidence = structured?.confidence ?: 0,
            ),
        )
        return Result(true, classification.kind, classification.reason)
    }
}

class PaymentRecognitionPipeline(
    private val hook: PaymentRecognitionHook?,
) {
    /**
     * Returns the parse outcome for this capture, or null when the message is
     * not payment-like. The archive is never touched here.
     */
    fun consume(
        accountId: String,
        financeEntitled: Boolean,
        input: NotificationCaptureInput,
        uploadEventId: String,
    ): PaymentIngestOutcome? {
        if (!financeEntitled) return null
        val outcome = hook?.outcomeFor(input)
        hook?.onCapture(accountId, input, "", uploadEventId)
        return outcome
    }
}
