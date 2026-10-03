package uk.thewyj.app.task21.payment

import java.security.MessageDigest
import uk.thewyj.app.task21.FinanceDirection

/** Money completeness is the only auto-book gate, shared by every local path. */
object PaymentAutoBook {
    fun eligible(amountMinor: Long?, direction: String): Boolean =
        amountMinor != null && amountMinor in 1..10_000_000_000_000L &&
            direction.uppercase() in setOf("INCOME", "EXPENSE", "REFUND")

    fun eventId(record: PaymentRecognitionRecord): String = record.uploadEventId.ifBlank {
        if (record.sourceEventId.startsWith("notification#event#"))
            record.sourceEventId.removePrefix("notification#event#")
        else "pay-verify:" + record.recognitionId
    }

    fun transactionId(accountId: String, eventId: String): String {
        val hash = MessageDigest.getInstance("SHA-256").digest("$accountId\n$eventId".toByteArray(Charsets.UTF_8))
        return "txn:notif:" + hash.joinToString("") { "%02x".format(it) }.take(48)
    }
}

/** Durable local transaction/outbox; projected into the existing Finance owner. */
data class LocalPaymentBooking(
    val accountId: String,
    val eventId: String,
    val recognitionId: String,
    val transactionId: String,
    val amountMinor: Long,
    val direction: String,
    val currency: String,
    val merchant: String,
    val occurredAtMs: Long,
    val sourcePackage: String,
    val paymentChannel: String,
    val providerReference: String,
    val syncState: String = "pending",
    val createdAtMs: Long,
)
