package uk.thewyj.app.task21.payment

import android.content.Context
import uk.thewyj.app.task21.NotificationCaptureInput
import uk.thewyj.app.task21.PaymentIngestOutcome
import uk.thewyj.app.task21.PaymentRecognitionHook
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore

/**
 * Android wiring for the payment pipeline: notification captures, SMS and
 * accessibility evidence all end up in the same coordinator instance.
 */
class AndroidPaymentRecognitionHook private constructor(private val appContext: Context) : PaymentRecognitionHook {
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
        val store = RoomPaymentRecognitionStore(NotificationDatabase.get(appContext))
        val recognition = runCatching { store.recognitionByUploadEvent(accountId, eventId) }.getOrNull() ?: return
        val candidate = runCatching {
            store.candidateForRecognition(accountId, recognition.recognitionId)
        }.getOrNull() ?: return
        runCatching { coordinator.markFinanceRecorded(accountId, candidate.candidateId, transactionId) }
    }

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
