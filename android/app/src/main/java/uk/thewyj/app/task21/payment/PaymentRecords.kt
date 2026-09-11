package uk.thewyj.app.task21.payment

/** Persisted recognition state used by the coordinator and the UI. */
data class PaymentRecognitionRecord(
    val recognitionId: String,
    val accountId: String,
    val state: String,
    val notificationId: Int,
    val sourcePackage: String,
    val sourceType: String,
    val sourceEventId: String,
    /** Structured-event id that was uploaded, or blank when local-only. */
    val uploadEventId: String = "",
    val paymentChannel: String,
    val amountMinor: Long?,
    val currency: String,
    val direction: String,
    val merchant: String,
    val providerReference: String,
    val createdAtMs: Long,
    val updatedAtMs: Long,
)

/**
 * Candidate transaction. Machine values are immutable evidence; the `edited*`
 * fields carry the user's corrections and win when the candidate is confirmed.
 */
data class PaymentCandidate(
    val candidateId: String,
    val accountId: String,
    val recognitionId: String,
    val status: String,
    val amountMinor: Long?,
    val direction: String,
    val category: String,
    val merchant: String,
    val occurredAtMs: Long,
    val channel: String,
    val confidence: Int,
    val reason: String,
    val editedAmountMinor: Long? = null,
    val editedDirection: String = "",
    val editedCategory: String = "",
    val editedMerchant: String = "",
    val editedOccurredAtMs: Long? = null,
    val editedNote: String = "",
    val financeTransactionId: String = "",
    val createdAtMs: Long,
    val updatedAtMs: Long,
) {
    val effectiveAmountMinor: Long? get() = editedAmountMinor ?: amountMinor
    val effectiveDirection: String get() = editedDirection.ifBlank { direction }
    val effectiveCategory: String get() = editedCategory.ifBlank { category }
    val effectiveMerchant: String get() = editedMerchant.ifBlank { merchant }
    val effectiveOccurredAtMs: Long get() = editedOccurredAtMs ?: occurredAtMs
    val hasEdits: Boolean
        get() = editedAmountMinor != null || editedDirection.isNotBlank() || editedCategory.isNotBlank() ||
            editedMerchant.isNotBlank() || editedOccurredAtMs != null || editedNote.isNotBlank()
}

/** What the confirm flow hands to the Task 16/17 Finance pipeline. */
data class FinanceDraft(
    val accountId: String,
    val candidateId: String,
    val recognitionId: String,
    val amountMinor: Long,
    val direction: String,
    val category: String,
    val merchant: String,
    val occurredAtMs: Long,
    val channel: String,
    val note: String,
    val userEdited: Boolean,
)

/** Outgoing user visible state notification. */
interface PaymentStatusNotifier {
    fun notify(message: PaymentStatusNotificationMessage): Boolean
    fun cancel(notificationId: Int)
}
