package uk.thewyj.app.task21.payment

import android.content.Context
import uk.thewyj.app.task21.NotificationCaptureInput
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

    override fun onCapture(accountId: String, input: NotificationCaptureInput, sourceAppLabel: String) {
        val sourceType = when {
            input.sourceType == "sms" -> PaymentSourceType.SMS
            input.sourceType == "bank" -> PaymentSourceType.BANK_NOTIFICATION
            else -> PaymentSourceType.NOTIFICATION
        }
        coordinator.onSourceEvent(
            accountId = accountId,
            sourcePackage = input.sourcePackage,
            sourceType = sourceType,
            sourceEventId = sourceEventIdOf(input),
            title = input.title,
            text = input.text,
            bigText = input.bigText,
            subText = input.subText,
            sourceAppLabel = sourceAppLabel,
            occurredAtMs = if (input.postTime > 0) input.postTime else input.receivedAtMs,
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
