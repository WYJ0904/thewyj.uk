package uk.thewyj.app.task21.payment

import android.content.Context
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
) : PaymentRecognitionHook {

    /** Test-only constructor so the archive ordering rule can be verified. */
    internal constructor(
        appContext: Context,
        archiveSink: uk.thewyj.app.task21.NotificationArchiveSink,
        recognitionStore: uk.thewyj.app.task21.store.PaymentRecognitionStoreContract? = null,
        testing: Boolean,
    ) : this(appContext, archiveSink, recognitionStore)

    private val store: uk.thewyj.app.task21.store.PaymentRecognitionStoreContract
        get() = recognitionStore ?: RoomPaymentRecognitionStore(NotificationDatabase.get(appContext))

    private val sink: uk.thewyj.app.task21.NotificationArchiveSink
        get() = archiveSink ?: NotificationArchiveSinkFactory.forContext(appContext)
    private val coordinator: PaymentRecognitionCoordinator by lazy {
        PaymentRecognitionCoordinator(
            store = RoomPaymentRecognitionStore(NotificationDatabase.get(appContext)),
            notifier = AndroidPaymentStatusNotifier(appContext),
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
        coordinator.onSourceEvent(
            accountId = accountId,
            sourcePackage = input.sourcePackage,
            sourceType = sourceType,
            sourceEventId = sourceEventIdOf(input),
            title = input.title,
            text = input.text,
            bigText = input.bigText,
            subText = input.subText,
            sourceAppLabel = label,
            uploadEventId = uploadEventId,
            occurredAtMs = if (input.postTime > 0) input.postTime else input.receivedAtMs,
        )
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
        val parsed = PaymentParserRegistry.parse(
            sourcePackage = input.sourcePackage,
            sourceType = sourceType,
            title = input.title,
            text = input.text,
            bigText = input.bigText,
            subText = input.subText,
            capturedAtMs = if (input.postTime > 0) input.postTime else input.receivedAtMs,
        )
        if (parsed.status == PaymentRecognitionStatus.NOT_PAYMENT ||
            parsed.status == PaymentRecognitionStatus.PARSE_ERROR
        ) {
            return null
        }
        val confirmed = parsed.status == PaymentRecognitionStatus.CONFIRMED_PAYMENT &&
            (parsed.amountMinor ?: 0) > 0
        return PaymentIngestOutcome(
            confirmed = confirmed,
            amountMinor = parsed.amountMinor ?: 0,
            direction = parsed.direction ?: uk.thewyj.app.task21.FinanceDirection.UNKNOWN,
            confidence = parsed.confidence,
            merchant = parsed.merchant.orEmpty(),
            counterparty = parsed.counterparty.orEmpty(),
            paymentChannel = parsed.paymentChannel.orEmpty(),
            parserVersion = "payment-" + parsed.paymentChannel.ifBlank { "generic" },
        )
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
        )
    }

    fun onAccessibilityEnrichment(accountId: String, enrichment: PaymentEnrichment): EnrichmentOutcome =
        coordinator.onAccessibilityEnrichment(accountId, enrichment)

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
        // T24.3-03: the archive link is keyed by the structured event id and must
        // close BEFORE the local recognition/candidate lookups. A payment the
        // server booked automatically has no local candidate row, and the old
        // order returned early - leaving the notification side stuck on
        // 「等待确认记账」 even though Finance already owned the transaction.
        runCatching {
            sink.markFinanceOutcome(accountId, eventId, "confirmed", transactionId)
        }
        // Local recognition/candidate bookkeeping is best-effort and must never
        // take the archive terminal state down with it.
        runCatching {
            val recognition = store.recognitionByUploadEvent(accountId, eventId) ?: return@runCatching
            val candidate = store.candidateForRecognition(accountId, recognition.recognitionId) ?: return@runCatching
            coordinator.markFinanceRecorded(accountId, candidate.candidateId, transactionId)
        }
    }

    override fun appLabelFor(input: NotificationCaptureInput): String =
        PaymentAppLabels.resolve(appContext, input.sourcePackage)

    fun coordinator(): PaymentRecognitionCoordinator = coordinator

    companion object {
        @Volatile
        private var instance: AndroidPaymentRecognitionHook? = null

        fun get(context: Context): AndroidPaymentRecognitionHook =
            instance ?: synchronized(this) {
                instance ?: AndroidPaymentRecognitionHook(context.applicationContext).also { instance = it }
            }

        /**
         * Stable per notification lifecycle: replays of the same notification
         * share the id while a repost after removal gets a new postTime.
         */
        fun sourceEventIdOf(input: NotificationCaptureInput): String {
            val key = input.notificationKey.ifBlank {
                "${input.sourcePackage}|${input.notificationId}|${input.tag}"
            }
            val postTime = if (input.postTime > 0) input.postTime else input.receivedAtMs
            return "notification#$key#$postTime"
        }
    }
}
