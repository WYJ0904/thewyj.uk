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
    private val account: () -> CaptureAccount?,
) {
    data class FlushResult(
        val uploaded: Int,
        val pending: Int,
        val discardedInvalid: Int,
        val authenticationRequired: Boolean,
        val retryableFailures: Int,
    )

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
    fun flushDetailed(): FlushResult {
        val current = account() ?: return FlushResult(0, 0, 0, authenticationRequired = true, retryableFailures = 0)
        if (!current.notificationEntitled) return FlushResult(0, 0, 0, authenticationRequired = false, retryableFailures = 0)
        val ingestQueue = queueFor(current.accountId)
        var uploaded = 0
        var discardedInvalid = 0
        var authenticationRequired = false
        var retryableFailures = 0
        for (request in ingestQueue.peekRequests()) {
            val response = runCatching {
                transport.post(request.path, current.sessionToken, request.body)
            }.getOrElse {
                retryableFailures += 1
                break
            }
            when {
                response.ok -> {
                    ingestQueue.remove(request.operationId)
                    uploaded += 1
                }
                response.status in setOf(400, 404, 409) -> {
                    ingestQueue.remove(request.operationId)
                    discardedInvalid += 1
                }
                response.status in setOf(401, 403) -> {
                    authenticationRequired = true
                    break
                }
                else -> {
                    retryableFailures += 1
                    break
                }
            }
        }
        return FlushResult(
            uploaded = uploaded,
            pending = ingestQueue.pendingCount(),
            discardedInvalid = discardedInvalid,
            authenticationRequired = authenticationRequired,
            retryableFailures = retryableFailures,
        )
    }

    fun flush(): Int = flushDetailed().uploaded
}
