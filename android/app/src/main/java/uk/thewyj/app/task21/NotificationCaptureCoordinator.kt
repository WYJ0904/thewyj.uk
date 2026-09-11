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
    /**
     * Task 24.1: the raw event feeds two independent pipelines. The archive
     * pipeline owns classification/retention, the payment pipeline owns
     * recognition/Finance. Neither can silently consume the other's decision.
     */
    private val archivePipeline = NotificationArchivePipeline(archiveFor, archiveSink)
    private val paymentPipeline = PaymentRecognitionPipeline(paymentHook)

    data class FlushResult(
        val uploaded: Int,
        val pending: Int,
        val discardedInvalid: Int,
        val authenticationRequired: Boolean,
        val retryableFailures: Int,
        /** One entry per accepted operation: the real ledger identity it produced. */
        val outcomes: List<IngestOutcome> = emptyList(),
        /**
         * Operations the server refused for a non-retryable reason. The payload
         * is kept so nothing is silently lost; the UI reports the reason.
         */
        val rejected: List<RejectedIngest> = emptyList(),
    )

    data class RejectedIngest(val operationId: String, val reason: String, val attempts: Int)

    data class IngestOutcome(
        val operationId: String,
        val eventId: String,
        val transactionId: String,
        val candidateId: String,
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

        // Payment apps are classified by the payment parser (one source of
        // truth). Everything else keeps the notification parser. A confirmed
        // payment therefore reaches the backend with confidence >= 900 and is
        // written to the real finance ledger instead of "recognised but never
        // recorded"; anything weaker becomes a reviewable candidate.
        val payment = if (current.financeEntitled) paymentHook?.outcomeFor(input) else null
        val structured = if (payment != null) {
            val refund = payment.direction == FinanceDirection.REFUND
            val parsedPayment = payment.confirmed && payment.amountMinor > 0 &&
                payment.direction != FinanceDirection.UNKNOWN
            StructuredNotificationEvent(
                eventId = eventId,
                fingerprint = fingerprint,
                sourcePackage = input.sourcePackage,
                eventType = if (refund) NotificationEventType.REFUND else NotificationEventType.TRANSACTION,
                parserVersion = payment.parserVersion,
                parseStatus = if (parsedPayment) ParseStatus.PARSED else ParseStatus.CANDIDATE,
                direction = payment.direction,
                amountMinor = payment.amountMinor,
                currency = "CNY",
                paymentChannel = payment.paymentChannel,
                merchant = payment.merchant,
                counterparty = payment.counterparty,
                confidence = if (parsedPayment) {
                    payment.confidence.coerceAtLeast(900)
                } else {
                    payment.confidence.coerceIn(0, 899)
                },
                occurredAtMs = input.receivedAtMs,
                receivedAtMs = input.receivedAtMs,
            )
        } else {
            StructuredNotificationEvent(
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
        }

        // Pipeline 1 - Notification Archive (NotiStar-style). The classifier
        // drops ongoing/progress/live readouts here; nothing below this line is
        // allowed to influence it, and it never writes Finance data.
        archivePipeline.consume(
            accountId = current.accountId,
            archiveEntitled = current.archiveEntitled,
            input = input,
            structured = structured,
            identityKey = input.notificationKey.ifBlank {
                "${input.sourcePackage}|${input.notificationId}|${input.tag}"
            },
        )

        // Pipeline 2 - Payment Recognition. It runs on every finance-entitled
        // capture, independent of archiving: a finance-only account whose
        // history is not saved still books its payments.
        paymentPipeline.consume(
            accountId = current.accountId,
            financeEntitled = current.financeEntitled,
            input = input,
            // The recognition only learns "this capture was uploaded" when the
            // payload is actually queued below; otherwise the device owns the
            // booking and the user completes it in the pending screen.
            uploadEventId = if (
                payment != null &&
                payment.amountMinor > 0 &&
                payment.direction != FinanceDirection.UNKNOWN
            ) {
                eventId
            } else {
                ""
            },
        )
        if (!current.financeEntitled) return
        if (payment != null) {
            // One trace line per payment event so a real device log shows the
            // exact identity that later has to appear in the finance ledger.
            CaptureTrace.stage(
                CaptureTrace.traceId(input.notificationKey, input.sourcePackage, input.notificationId),
                "finance-parsed",
                "eventId=$eventId pkg=${input.sourcePackage} channel=${input.channelId.ifBlank { "-" }} " +
                    "source=${input.sourceType} amount=${payment.amountMinor} direction=${payment.direction} " +
                    "merchant=${(payment.merchant.ifBlank { payment.counterparty }).take(40).ifBlank { "-" }} " +
                    "status=${if (payment.confirmed) "CONFIRMED_PAYMENT" else "PAYMENT_LIKELY"} " +
                    "confidence=${structured.confidence}",
            )
            // Only a payment with a *complete* money shape may leave the device:
            // the server rejects parsed/candidate events without an amount or a
            // direction (`structured_fields_required`), and an event the server
            // rejects can never become a Finance transaction. Amount-unknown and
            // direction-unknown hints stay local (90 second enrichment ticket)
            // where the user completes them, and the confirmed booking is
            // uploaded afterwards with the real direction.
            if (payment.amountMinor <= 0 || payment.direction == FinanceDirection.UNKNOWN) return
            val payloadForPayment = StructuredEventJson.ingestPayload("1", current.deviceId, eventId, structured)
            queueFor(current.accountId).enqueue(eventId, payloadForPayment)
            return
        }
        if (output == null) return
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
        return flushDetailed(current)
    }

    /**
     * Queues one structured event for the current account. Used by the in-app
     * verification screen when a local-only payment is confirmed; the same
     * queue, transport and idempotency rules apply.
     */
    fun enqueue(operationId: String, payload: String): Boolean {
        if (operationId.isBlank() || payload.isBlank()) return false
        val current = account() ?: return false
        if (!current.financeEntitled) return false
        return runCatching { queueFor(current.accountId).enqueue(operationId, payload) }.isSuccess
    }

    /** Operation ids still waiting for an upload for the current account. */
    fun queuedOperationIds(): Set<String> {
        val current = account() ?: return emptySet()
        return runCatching {
            queueFor(current.accountId).peekRequests().map { it.operationId }.toSet()
        }.getOrDefault(emptySet())
    }

    /** Full queued uploads, including the last server rejection reason. */
    fun queuedRequests(): List<QueuedNotificationRequest> {
        val current = account() ?: return emptyList()
        return runCatching { queueFor(current.accountId).peekRequests() }.getOrDefault(emptyList())
    }

    private fun flushDetailed(current: CaptureAccount): FlushResult {
        val ingestQueue = queueFor(current.accountId)
        if (!current.financeEntitled) {
            return FlushResult(0, ingestQueue.pendingCount(), 0, authenticationRequired = false, retryableFailures = 0)
        }
        var uploaded = 0
        var discardedInvalid = 0
        var authenticationRequired = false
        var retryableFailures = 0
        val outcomes = mutableListOf<IngestOutcome>()
        val rejected = mutableListOf<RejectedIngest>()
        for (request in ingestQueue.peekRequests()) {
            // A payload the server already refused repeatedly would spin on
            // every flush; keep it (nothing is deleted) but stop re-uploading
            // until the app is updated or the user removes the account data.
            if (request.attempts >= OfflineNotificationQueue.MAX_UPLOAD_ATTEMPTS) {
                rejected += RejectedIngest(request.operationId, request.lastError.ifBlank { "反复被服务端拒绝" }, request.attempts)
                continue
            }
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
                    // Record the backend result for the same event id so the
                    // device log ends with the real transaction id.
                    runCatching {
                        val json = org.json.JSONObject(response.body)
                        val result = json.optJSONArray("operation_results")?.optJSONObject(0)
                        val transactionId = result?.optString("transaction_id").orEmpty()
                        val candidateId = result?.optString("candidate_id").orEmpty()
                        val eventId = result?.optJSONObject("event")?.optString("event_id").orEmpty()
                        outcomes.add(
                            IngestOutcome(
                                operationId = request.operationId,
                                eventId = eventId.ifBlank { request.operationId },
                                transactionId = transactionId,
                                candidateId = candidateId,
                            ),
                        )
                        // P0-2: a booked event closes its local pending state.
                        if (transactionId.isNotBlank()) {
                            runCatching {
                                paymentHook?.onFinanceOutcome(
                                    accountId = current.accountId,
                                    eventId = eventId.ifBlank { request.operationId },
                                    transactionId = transactionId,
                                )
                            }
                        }
                        CaptureTrace.stage(
                            eventId.ifBlank { request.operationId },
                            "finance-api-ok",
                            "transactionId=${transactionId.ifBlank { "-" }} candidateId=${candidateId.ifBlank { "-" }}",
                        )
                    }
                }
                response.status in setOf(400, 404, 409) -> {
                    val reason = ingestFailureReason(response)
                    if (ingestWasAlreadyHandled(response.body)) {
                        // The server already has this exact event: nothing to
                        // keep (a replay is not a lost payment).
                        ingestQueue.remove(request.operationId)
                        discardedInvalid += 1
                    } else {
                        // Real client/server contract failure. Never drop the
                        // payload silently: record why and surface it.
                        val updated = ingestQueue.markRejected(request.operationId, reason)
                        rejected += RejectedIngest(
                            operationId = request.operationId,
                            reason = reason,
                            attempts = updated?.attempts ?: (request.attempts + 1),
                        )
                        CaptureTrace.stage(request.operationId, "finance-api-rejected", "status=${response.status} reason=$reason")
                    }
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
            outcomes = outcomes,
            rejected = rejected,
        )
    }

    fun flush(): Int = flushDetailed().uploaded

    companion object {
        /**
         * Reads the stable error code the API returns so the user sees
         * 「同步被拒绝：payment_channel_invalid」 instead of an endless
         * 「等待同步」. Falls back to the HTTP status.
         */
        fun ingestFailureReason(response: IngestResponse): String {
            val code = runCatching {
                org.json.JSONObject(response.body).optString("code").orEmpty()
            }.getOrDefault("")
            if (code.isNotBlank()) return code.take(60)
            val error = runCatching {
                org.json.JSONObject(response.body).optString("error").orEmpty()
            }.getOrDefault("")
            return error.ifBlank { "http_${response.status}" }.take(60)
        }

        /**
         * True when a 4xx answer proves the server already owns this event
         * (idempotent replay or an accepted duplicate), which is the only case
         * where removing the queued payload loses nothing.
         */
        fun ingestWasAlreadyHandled(body: String): Boolean = runCatching {
            val json = org.json.JSONObject(body)
            val result = json.optJSONArray("operation_results")?.optJSONObject(0)
            json.optBoolean("duplicate") ||
                result?.optBoolean("duplicate") == true ||
                result?.optBoolean("idempotent_replay") == true
        }.getOrDefault(false)
    }
}
