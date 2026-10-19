package uk.thewyj.app.task21.payment

import android.content.Context
import android.util.Log
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import uk.thewyj.app.task21.NotificationCaptureInput
import uk.thewyj.app.task21.PaymentIngestOutcome
import uk.thewyj.app.task21.PaymentRecognitionHook
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.NotificationArchiveSinkFactory
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore

/**
 * Android wiring for the payment pipeline: notification captures, SMS and
 * accessibility evidence all end up in the same coordinator instance.
 */
class AndroidPaymentRecognitionHook private constructor(
    private val appContext: Context,
    /** Injectable for tests; production always uses the Room-backed sink. */
    private val archiveSink: uk.thewyj.app.task21.NotificationArchiveSink? = null,
    private val recognitionStore: uk.thewyj.app.task21.store.PaymentRecognitionStoreContract? = null,
    private val publishOverride: ((String, String) -> Boolean)? = null,
    private val enrichmentExecutor: Executor = ENRICHMENT_EXECUTOR,
    private val notifierOverride: PaymentStatusNotifier? = null,
) : PaymentRecognitionHook {

    /** Test-only constructor so the archive ordering rule can be verified. */
    internal constructor(
        appContext: Context,
        archiveSink: uk.thewyj.app.task21.NotificationArchiveSink,
        recognitionStore: uk.thewyj.app.task21.store.PaymentRecognitionStoreContract? = null,
        testing: Boolean,
        publishOverride: ((String, String) -> Boolean)? = null,
        enrichmentExecutor: Executor = Executor { it.run() },
        notifierOverride: PaymentStatusNotifier? = null,
    ) : this(appContext, archiveSink, recognitionStore, publishOverride, enrichmentExecutor, notifierOverride)

    private val store: uk.thewyj.app.task21.store.PaymentRecognitionStoreContract
        get() = recognitionStore ?: RoomPaymentRecognitionStore(NotificationDatabase.get(appContext))

    private val sink: uk.thewyj.app.task21.NotificationArchiveSink
        get() = archiveSink ?: NotificationArchiveSinkFactory.forContext(appContext)
    private val coordinator: PaymentRecognitionCoordinator by lazy {
        PaymentRecognitionCoordinator(
            store = store,
            notifier = notifierOverride ?: AndroidPaymentStatusNotifier(appContext),
        )
    }

    override fun onCapture(
        accountId: String,
        input: NotificationCaptureInput,
        sourceAppLabel: String,
        uploadEventId: String,
    ) {
        val sourceType = when {
            input.sourceType == "sms" -> PaymentSourceType.SMS
            input.sourceType == "bank" -> PaymentSourceType.BANK_NOTIFICATION
            else -> PaymentSourceType.NOTIFICATION
        }
        // The user must always see the real app name ("微信"), never the package
        // name and never the generic 「该应用」 the notifications used to show.
        val label = sourceAppLabel.ifBlank { PaymentAppLabels.resolve(appContext, input.sourcePackage) }
        val preview = PaymentParserRegistry.parse(input.sourcePackage, sourceType, input.title,
            (listOf(input.text) + input.textLines).filter(String::isNotBlank).joinToString(" "), input.bigText, input.subText, input.receivedAtMs)
        val messageProof = uk.thewyj.app.task21.paymentMessageProof(input)
        val messageRecords = if (messageProof.isBlank()) emptyList() else store.recognitionsByMessageProof(accountId, messageProof)
            .filter { PaymentEventSafety.role(it.financialPhase) == PaymentEventSafety.role(preview.financialPhase) }
        val review = if (preview.providerReference.isNullOrBlank() && messageRecords.size > 1) "message_identity_ambiguous" else identityReviewReason(input)
        val declaredSourceId = sourceEventIdOf(input)
        val previousMessage = messageRecords.singleOrNull()?.takeIf { preview.providerReference.isNullOrBlank() }
        val outcome = coordinator.onSourceEvent(
            accountId = accountId,
            sourcePackage = input.sourcePackage,
            sourceType = sourceType,
            sourceEventId = previousMessage?.sourceEventId ?: declaredSourceId,
            title = input.title,
            text = (listOf(input.text) + input.textLines).filter(String::isNotBlank).joinToString(" "),
            bigText = input.bigText,
            subText = input.subText,
            sourceAppLabel = label,
            uploadEventId = uploadEventId,
            occurredAtMs = if (input.postTime > 0) input.postTime else input.receivedAtMs,
            sourceUid = input.sourceUid,
            identityReviewReason = review,
        )
        if (outcome.recognitionId.isNotBlank()) {
            store.saveEventAlias(accountId, declaredSourceId, outcome.recognitionId)
            if (messageProof.isNotBlank()) store.saveEventAlias(accountId, "proof:$messageProof:${outcome.recognitionId}", outcome.recognitionId)
            // An observation hash is evidence provenance, never a transaction ID.
            val evidence = uk.thewyj.app.task21.NotificationFingerprint.sha256Hex(listOf(input.sourcePackage,
                input.sourceUid.toString(), input.notificationKey, input.title, input.text, input.bigText, input.subText,
                input.textLines.joinToString("\u001E"), input.messageIdentity).joinToString("\u001F"))
            store.saveEventAlias(accountId, "observation:$evidence", outcome.recognitionId)
        }
        if (outcome.recognitionId.isNotBlank() && outcome.state != null) PaymentReviewSignals.publish()
    }

    /**
     * The structured event uploaded for finance uses the same payment parser as
     * the local recognition pipeline, so the two can never disagree about a
     * payment (the previous duplicate term lists caused "已支付 ¥1000" to be
     * recognised locally but only become a candidate upstream).
     */
    override fun outcomeFor(input: NotificationCaptureInput): PaymentIngestOutcome? {
        val sourceType = when {
            input.sourceType == "sms" -> PaymentSourceType.SMS
            input.sourceType == "bank" -> PaymentSourceType.BANK_NOTIFICATION
            else -> PaymentSourceType.NOTIFICATION
        }
        // MessagingStyle notifications (WeChat chat/payment messages) put the
        // real bodies in EXTRA_TEXT_LINES and often leave EXTRA_TEXT empty, so
        // the payment parser used to see nothing and answered「暂未识别到金额」
        // for a literal「已支付¥100」(real device 2026-09-13).
        val bodyLines = buildList {
            if (input.text.isNotBlank()) add(input.text)
            input.textLines.mapNotNullTo(this) { line -> line.takeIf { it.isNotBlank() } }
        }
        val parseText = if (bodyLines.isEmpty()) input.text else bodyLines.joinToString(" ")
        val parser = PaymentParserRegistry.parserFor(input.sourcePackage, sourceType)
        val parsed = PaymentParserRegistry.parse(input.sourcePackage, sourceType, input.title, parseText,
            input.bigText, input.subText, if (input.postTime > 0) input.postTime else input.receivedAtMs)
        // Auditable evidence without ever logging the message itself.
        Log.i(
            "ThewyjPayment",
            "parse pkg=${input.sourcePackage} titleChars=${input.title.length} " +
                "textChars=${input.text.length} lineCount=${input.textLines.size} " +
                "status=${parsed.status} amountKnown=${parsed.amountMinor != null} directionKnown=${parsed.direction != null}",
        )
        if (parsed.status == PaymentRecognitionStatus.NOT_PAYMENT ||
            parsed.status == PaymentRecognitionStatus.PARSE_ERROR
        ) {
            return null
        }
        val review = parsed.reviewReason.ifBlank { identityReviewReason(input) }
        // Completion evidence and identity eligibility are separate contracts.
        val confirmed = parsed.reviewReason.isBlank() && PaymentEventSafety.canSettle(parsed.financialPhase) && PaymentAutoBook.eligible(parsed.amountMinor, parsed.direction?.name.orEmpty(),
            parsed.status == PaymentRecognitionStatus.CONFIRMED_PAYMENT &&
                !PaymentText.hasIncompleteStatus(listOf(input.title, parseText, input.bigText, input.subText).joinToString(" ")))
        return PaymentIngestOutcome(
            confirmed = confirmed,
            amountMinor = parsed.amountMinor ?: 0,
            direction = parsed.direction ?: uk.thewyj.app.task21.FinanceDirection.UNKNOWN,
            confidence = parsed.confidence,
            merchant = parsed.merchant.orEmpty(),
            counterparty = parsed.counterparty.orEmpty(),
            paymentChannel = parsed.paymentChannel.orEmpty(),
            parserVersion = parser?.version ?: "payment-generic",
            providerReference = parsed.providerReference.orEmpty(),
            reasons = parsed.reasons,
            missingFields = parsed.missingFields,
            currency = parsed.currency ?: "CNY", financialPhase = parsed.financialPhase,
            lifecycleReference = parsed.lifecycleReference, referenceNamespace = parsed.referenceNamespace,
            currencyEvidence = parsed.currencyEvidence, identityReviewReason = review,
            lifecycleOperation = parsed.lifecycleOperation, lifecycleRevision = parsed.lifecycleRevision,
        )
    }

    override fun prepareIdentity(accountId: String, input: NotificationCaptureInput, payment: PaymentIngestOutcome): PaymentIngestOutcome {
        if (input.paymentEventId.isNotBlank()) {
            val reason = store.recognitionByUploadEvent(accountId, input.paymentEventId)?.identityReviewReason.orEmpty()
            if (reason.isNotBlank()) return payment.copy(identityReviewReason = reason)
        }
        val proof = uk.thewyj.app.task21.paymentMessageProof(input)
        if (payment.providerReference.isBlank() && proof.isNotBlank() && store.recognitionsByMessageProof(accountId, proof)
                .count { PaymentEventSafety.role(it.financialPhase) == PaymentEventSafety.role(payment.financialPhase) } > 1)
            return payment.copy(confirmed = false, identityReviewReason = "message_identity_ambiguous")
        return payment
    }

    fun onSms(accountId: String, sender: String, body: String, receivedAtMs: Long) {
        coordinator.onSourceEvent(
            accountId = accountId,
            sourcePackage = sender.ifBlank { "sms" },
            sourceType = PaymentSourceType.SMS,
            sourceEventId = "sms#${sender.hashCode()}#${body.hashCode()}#$receivedAtMs",
            title = sender,
            text = body,
            sourceAppLabel = sender,
            occurredAtMs = receivedAtMs,
            identityReviewReason = if (PaymentText.providerReference(body).isNullOrBlank()) "identity_unproven_sms" else "",
        )
    }

    fun onAccessibilityEnrichment(accountId: String, enrichment: PaymentEnrichment, expectedTicketId: String? = null): EnrichmentOutcome {
        val outcome = coordinator.onAccessibilityEnrichment(accountId, enrichment, expectedTicketId)
        if (outcome is EnrichmentOutcome.Applied) {
            // Room has the amount now; notify the UI before any network call.
            PaymentReviewSignals.publish()
            val recognitionId = outcome.ticket.recognitionId
            val key = "$accountId|$recognitionId"
            if (PUBLISHING.add(key)) {
                runCatching {
                    enrichmentExecutor.execute {
                        try {
                            runCatching {
                                (publishOverride ?: { account: String, id: String ->
                                    PaymentHintSync(appContext).publishEnrichment(account, id)
                                })(accountId, recognitionId)
                            }.onFailure { error ->
                                Log.w("ThewyjPayment", "enrichment publish unavailable: ${error.javaClass.simpleName}")
                            }
                        } finally {
                            PUBLISHING.remove(key)
                            PaymentReviewSignals.publish()
                        }
                    }
                }.onFailure { PUBLISHING.remove(key) }
            }
        }
        return outcome
    }

    /** The page produced no usable amount; counts toward the honest failure path. */
    fun onAccessibilityMiss(accountId: String, sourcePackage: String): Boolean =
        coordinator.onAccessibilityMiss(accountId, sourcePackage)

    /**
     * P0-2: the backend created the transaction for an uploaded event. The local
     * recognition/candidate must move to "recorded" immediately, otherwise the
     * notification page keeps showing 「等待确认记账」 for a booked payment.
     */
    override fun onFinanceOutcome(accountId: String, eventId: String, transactionId: String) {
        if (accountId.isBlank() || eventId.isBlank() || transactionId.isBlank()) return
        val prior = runCatching {
            val rec = store.recognitionByUploadEvent(accountId, eventId)
            store.localBooking(accountId, rec?.let(PaymentAutoBook::eventId) ?: eventId)
        }.getOrNull()
        if (prior?.syncState == "synced" && prior.transactionId != transactionId) return
        store.acknowledgeLocalBooking(accountId, eventId, transactionId)
        // T24.3-03: the archive link is keyed by the structured event id and must
        // close BEFORE the local recognition/candidate lookups. A payment the
        // server booked automatically has no local candidate row, and the old
        // order returned early - leaving the notification side stuck on
        // 「等待确认记账」 even though Finance already owned the transaction.
        runCatching {
            sink.markFinanceOutcome(accountId, eventId, "confirmed", transactionId)
        }
        // Local recognition/candidate bookkeeping is best-effort and must never
        // take the archive terminal state down with it. A server auto-book can
        // legitimately arrive when the local candidate row is absent/stale, so
        // the recognition itself must still leave ATTENTION_STATES immediately.
        val recognition = runCatching {
            store.recognitionByUploadEvent(accountId, eventId)
                ?: sink.recognitionSourceEventIds(accountId, eventId)
                    .firstNotNullOfOrNull { store.recognitionBySourceEvent(accountId, it) }
        }.getOrNull()
        if (recognition == null) {
            PaymentReviewSignals.publish()
            return
        }
        val candidate = runCatching {
            store.candidateForRecognition(accountId, recognition.recognitionId)
        }.getOrNull()
        val existingBooking = store.localBooking(accountId, PaymentAutoBook.eventId(recognition))
        if (existingBooking?.syncState == "synced" && existingBooking.transactionId != transactionId) return
        if (candidate != null) {
            runCatching {
                coordinator.markFinanceRecorded(accountId, candidate.candidateId, transactionId)
            }
        }
        runCatching {
            store.saveRecognition(
                recognition.copy(
                    state = PaymentRecognitionState.FINANCE_RECORDED.name,
                    updatedAtMs = System.currentTimeMillis(),
                ),
            )
        }
        PaymentReviewSignals.publish()
    }

    override fun onReconciliationReceipt(accountId: String, operationId: String, body: String): Boolean {
        val applied=store.applyReconciliationReceipt(accountId, operationId, body)
        if(applied) PaymentReviewSignals.publish()
        return applied
    }

    override fun appLabelFor(input: NotificationCaptureInput): String =
        PaymentAppLabels.resolve(appContext, input.sourcePackage)

    fun coordinator(): PaymentRecognitionCoordinator = coordinator

    override fun localFinanceTransactionId(accountId: String, eventId: String): String {
        val canonical = store.recognitionByUploadEvent(accountId, eventId)?.let(PaymentAutoBook::eventId) ?: eventId
        return store.localBooking(accountId, canonical)?.transactionId.orEmpty()
    }

    override fun prepareLocalBookings(accountId: String, deviceId: String) {
        if (recognitionStore == null) LocalPaymentLedger.recover(appContext, accountId, deviceId)
    }

    private fun identityReviewReason(input: NotificationCaptureInput): String {
        val body = listOf(input.title, input.text, input.bigText, input.subText, input.textLines.joinToString(" ")).joinToString(" ")
        return if (input.messageIdentity.isBlank() && PaymentText.providerReference(body).isNullOrBlank())
            "identity_unproven_notification" else ""
    }

    companion object {
        private val PUBLISHING = ConcurrentHashMap.newKeySet<String>()
        private val ENRICHMENT_EXECUTOR = Executors.newSingleThreadExecutor { task ->
            Thread(task, "thewyj-payment-enrichment").apply { isDaemon = true }
        }
        @Volatile
        private var instance: AndroidPaymentRecognitionHook? = null

        fun get(context: Context): AndroidPaymentRecognitionHook =
            instance ?: synchronized(this) {
                instance ?: AndroidPaymentRecognitionHook(context.applicationContext).also { instance = it }
            }

        /** Stable per notification lifecycle; postTime is only a legacy fallback. */
        fun sourceEventIdOf(input: NotificationCaptureInput): String {
            if (input.paymentEventId.isNotBlank()) {
                return "notification#event#${input.paymentEventId}"
            }
            val key = input.notificationKey.ifBlank {
                "${input.sourcePackage}|${input.notificationId}|${input.tag}"
            }
            val postTime = if (input.postTime > 0) input.postTime else input.receivedAtMs
            return "notification#$key#$postTime"
        }
    }
}
