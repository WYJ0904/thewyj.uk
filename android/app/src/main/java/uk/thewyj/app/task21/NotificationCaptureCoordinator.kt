package uk.thewyj.app.task21

/**
 * Device-local notification capture pipeline. Full notification content is
 * archived locally and only the structured parser output is queued for backend
 * ingest. Capture is gated on the current account's notification entitlement
 * and pauses when notification access is no longer granted.
 */
class NotificationCaptureCoordinator(
    private val archiveFor: (accountId: String) -> NotificationArchiveStore,
    private val queueFor: (accountId: String) -> OfflineNotificationQueue,
    private val transport: NotificationIngestTransport,
    private val ingestPath: String = "/api/notification/ingest",
    private val account: () -> CaptureAccount?,
) {
    data class CaptureAccount(
        val accountId: String,
        val deviceId: String,
        val sessionToken: String,
        val notificationEntitled: Boolean,
    )

    fun onNotification(
        sourcePackage: String,
        title: String,
        text: String,
        bigText: String,
        subText: String,
        receivedAtMs: Long,
    ) {
        val current = account() ?: return
        if (!current.notificationEntitled) return

        val archive = archiveFor(current.accountId)
        val ingestQueue = queueFor(current.accountId)
        val fingerprint = NotificationFingerprint.fingerprint(sourcePackage, title, text, bigText, subText)
        val eventId = NotificationFingerprint.stableEventId()
        val parser = NotificationParserRegistry.parserFor(sourcePackage)
        val output = parser?.parse(
            ParserInput(sourcePackage, title, text, bigText, subText),
            receivedAtMs,
        ) ?: ParserOutput(
            NotificationEventType.OTHER, ParseStatus.UNPARSED, FinanceDirection.UNKNOWN,
            0, "CNY", "", "", "", 0, receivedAtMs,
        )

        val record = LocalNotificationRecord(
            id = eventId,
            eventId = eventId,
            fingerprint = fingerprint,
            sourcePackage = sourcePackage,
            title = title,
            text = text,
            bigText = bigText,
            subText = subText,
            receivedAtMs = receivedAtMs,
            parseStatus = output.parseStatus,
            direction = output.direction,
            amountMinor = output.amountMinor,
            currency = output.currency,
            merchant = output.merchant,
            confidence = output.confidence,
        )
        archive.append(record)

        if (output.parseStatus == ParseStatus.UNPARSED && output.eventType !in setOf(
                NotificationEventType.TRANSACTION, NotificationEventType.REFUND,
            )
        ) {
            return
        }
        val structured = StructuredNotificationEvent(
            eventId = eventId,
            fingerprint = fingerprint,
            sourcePackage = sourcePackage,
            eventType = output.eventType,
            parserVersion = parser?.version ?: "unknown",
            parseStatus = output.parseStatus,
            direction = output.direction,
            amountMinor = output.amountMinor,
            currency = output.currency,
            paymentChannel = output.paymentChannel,
            merchant = output.merchant,
            counterparty = output.counterparty,
            confidence = output.confidence,
            occurredAtMs = output.occurredAtMs,
            receivedAtMs = receivedAtMs,
        )
        val payload = StructuredEventJson.ingestPayload("1", current.deviceId, eventId, structured)
        ingestQueue.enqueue(eventId, payload)
    }

    /** Drains the current account's offline queue. Retryable failures stay queued. */
    fun flush(): Int {
        val current = account() ?: return 0
        if (!current.notificationEntitled) return 0
        val ingestQueue = queueFor(current.accountId)
        var uploaded = 0
        for ((operationId, payload) in ingestQueue.peekAll()) {
            val response = transport.post(ingestPath, current.sessionToken, payload)
            if (response.ok || response.status == 400 || response.status == 401 || response.status == 403) {
                ingestQueue.remove(operationId)
                if (response.ok) uploaded += 1
            }
        }
        return uploaded
    }
}
