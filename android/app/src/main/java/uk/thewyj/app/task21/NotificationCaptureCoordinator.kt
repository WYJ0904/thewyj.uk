package uk.thewyj.app.task21

/**
 * Device-local notification capture pipeline.
 *
 * Capability split (Task 21 final closure):
 *  - finance_access: memory-only classification for financial recognition,
 *    enrichment and Task 16/17 Finance. Ordinary chat is discarded and never
 *    written to the notification archive.
 *  - notification_archive_access: full local notification history (search,
 *    filters, retention). It does not create finance transactions.
 *  - both / all_features_access: archive + finance together.
 *
 * Full notification content is only ever stored locally; only the structured
 * parser output is queued for backend ingest.
 */
class NotificationCaptureCoordinator(
    private val archiveFor: (accountId: String) -> NotificationArchiveStore,
    private val queueFor: (accountId: String) -> OfflineNotificationQueue,
    private val transport: NotificationIngestTransport,
    private val account: () -> CaptureAccount?,
    private val archiveSink: NotificationArchiveSink? = null,
    private val paymentHook: PaymentRecognitionHook? = null,
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
        /** finance_access / all_features_access. */
        val financeEntitled: Boolean,
        /** notification_archive_access; defaults to the finance flag. */
        val archiveEntitled: Boolean = financeEntitled,
    ) {
        val anyEntitled: Boolean get() = financeEntitled || archiveEntitled
    }

    /** Legacy positional entry point kept for existing callers and tests. */
    fun onNotification(
        sourcePackage: String,
        title: String,
        text: String,
        bigText: String,
        subText: String,
        receivedAtMs: Long,
    ) = onNotification(
        NotificationCaptureInput(
            sourcePackage = sourcePackage,
            title = title,
            text = text,
            bigText = bigText,
            subText = subText,
            postTime = receivedAtMs,
            receivedAtMs = receivedAtMs,
        ),
    )

    fun onNotification(input: NotificationCaptureInput) {
        val current = account() ?: return
        if (!current.anyEntitled) return
        if (input.sourcePackage.isBlank()) return

        val fingerprint = NotificationFingerprint.fingerprint(
            input.sourcePackage, input.title, input.text, input.bigText, input.subText,
        )
        val eventId = NotificationFingerprint.stableEventId()
        val parser = if (current.financeEntitled) {
            NotificationParserRegistry.parserFor(input.sourcePackage)
        } else {
            null
        }
        val output = if (current.financeEntitled) {
            parser?.parse(
                ParserInput(
                    sourcePackage = input.sourcePackage,
                    title = input.title,
                    text = input.text,
                    bigText = input.bigText,
                    subText = input.subText,
                    infoText = input.infoText,
                    summaryText = input.summaryText,
                    textLines = input.textLines,
                ),
                input.receivedAtMs,
            ) ?: ParserOutput(
                NotificationEventType.OTHER, ParseStatus.UNPARSED, FinanceDirection.UNKNOWN,
                0, "CNY", "", "", "", 0, input.receivedAtMs,
            )
        } else {
            null
        }

        val structured = StructuredNotificationEvent(
            eventId = eventId,
            fingerprint = fingerprint,
            sourcePackage = input.sourcePackage,
            eventType = output?.eventType ?: NotificationEventType.OTHER,
            parserVersion = parser?.version ?: "unknown",
            parseStatus = output?.parseStatus ?: ParseStatus.UNPARSED,
            direction = output?.direction ?: FinanceDirection.UNKNOWN,
            amountMinor = output?.amountMinor ?: 0,
            currency = output?.currency ?: "CNY",
            paymentChannel = output?.paymentChannel ?: "",
            merchant = output?.merchant ?: "",
            counterparty = output?.counterparty ?: "",
            confidence = output?.confidence ?: 0,
            occurredAtMs = output?.occurredAtMs ?: input.receivedAtMs,
            receivedAtMs = input.receivedAtMs,
        )

        if (current.archiveEntitled) {
            if (archiveSink != null) {
                archiveSink.store(current.accountId, input, structured)
            } else {
                archiveFor(current.accountId).append(
                    LocalNotificationRecord(
                        id = eventId,
                        eventId = eventId,
                        fingerprint = fingerprint,
                        sourcePackage = input.sourcePackage,
                        title = input.title,
                        text = input.text,
                        bigText = input.bigText,
                        subText = input.subText,
                        receivedAtMs = input.receivedAtMs,
                        parseStatus = structured.parseStatus,
                        direction = structured.direction,
                        amountMinor = structured.amountMinor,
                        currency = structured.currency,
                        merchant = structured.merchant,
                        confidence = structured.confidence,
                    ),
                )
            }
        }

        // Finance pipeline: only for finance-entitled accounts, and only for
        // events the parser considers transaction-like. Ordinary chat never
        // becomes an ingest payload.
        if (!current.financeEntitled || output == null) return
        // Payment recognition runs on every finance-entitled capture (memory
        // only): chat is classified and discarded, payment-like events become
        // hints/candidates/notifications.
        paymentHook?.onCapture(current.accountId, input, "")
        if (output.parseStatus == ParseStatus.UNPARSED && output.eventType !in setOf(
                NotificationEventType.TRANSACTION, NotificationEventType.REFUND,
            )
        ) {
            return
        }
        val payload = StructuredEventJson.ingestPayload("1", current.deviceId, eventId, structured)
        queueFor(current.accountId).enqueue(eventId, payload)
    }

    /**
     * A system notification disappeared. History keeps whatever was captured;
     * only the lifecycle state changes.
     */
    fun onRemoved(input: NotificationCaptureInput) {
        val current = account() ?: return
        if (!current.archiveEntitled) return
        archiveSink?.markRemoved(current.accountId, input)
    }

    /** Drains the current account's offline queue. Retryable failures stay queued. */
    fun flushDetailed(): FlushResult {
        val current = account() ?: return FlushResult(0, 0, 0, authenticationRequired = true, retryableFailures = 0)
        val ingestQueue = queueFor(current.accountId)
        if (!current.financeEntitled) {
            return FlushResult(0, ingestQueue.pendingCount(), 0, authenticationRequired = false, retryableFailures = 0)
        }
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
