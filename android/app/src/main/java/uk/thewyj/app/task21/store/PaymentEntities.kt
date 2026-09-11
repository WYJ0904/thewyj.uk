package uk.thewyj.app.task21.store

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Persisted payment recognition state (schema v2). Everything is account
 * scoped; raw notification/SMS/accessibility text never leaves the device and
 * is not duplicated here beyond the minimal evidence fields.
 */
@Entity(
    tableName = "payment_recognitions",
    indices = [
        Index(value = ["accountId", "updatedAtMs"]),
        Index(value = ["accountId", "sourceEventId"]),
    ],
)
data class PaymentRecognitionEntity(
    @PrimaryKey val recognitionId: String,
    val accountId: String,
    /** PaymentRecognitionState name. */
    val state: String,
    val notificationId: Int,
    val sourcePackage: String,
    val sourceType: String,
    val sourceEventId: String,
    /** Structured-event id that was uploaded for finance, or blank when local-only. */
    val uploadEventId: String,
    val paymentChannel: String,
    val amountMinor: Long,
    val hasAmount: Int,
    val currency: String,
    val direction: String,
    val merchant: String,
    val providerReference: String,
    val createdAtMs: Long,
    val updatedAtMs: Long,
)

@Entity(
    tableName = "payment_tickets",
    indices = [
        Index(value = ["accountId", "state"]),
        Index(value = ["recognitionId"]),
        Index(value = ["accountId", "sourcePackage", "state"]),
    ],
)
data class PaymentTicketEntity(
    @PrimaryKey val ticketId: String,
    val accountId: String,
    val recognitionId: String,
    val sourcePackage: String,
    val sourceEventId: String,
    val paymentChannel: String,
    val amountHintMinor: Long,
    val hasAmountHint: Int,
    /** Comma separated field names. */
    val missingFields: String,
    val state: String,
    val attempts: Int,
    val createdAtMs: Long,
    val expiresAtMs: Long,
    val enrichedAmountMinor: Long,
    val hasEnrichedAmount: Int,
    val enrichedDirection: String,
    val enrichedMerchant: String,
    val enrichedProviderReference: String,
    val enrichedAtMs: Long,
)

@Entity(
    tableName = "payment_candidates",
    indices = [
        Index(value = ["accountId", "status", "createdAtMs"]),
        Index(value = ["recognitionId"]),
    ],
)
data class PaymentCandidateEntity(
    @PrimaryKey val candidateId: String,
    val accountId: String,
    val recognitionId: String,
    /** pending | confirmed | rejected */
    val status: String,
    // Machine recognised values (original evidence, never overwritten).
    val amountMinor: Long,
    val hasAmount: Int,
    val direction: String,
    val category: String,
    val merchant: String,
    val occurredAtMs: Long,
    val channel: String,
    val confidence: Int,
    val reason: String,
    // User edited values applied on confirm.
    val editedAmountMinor: Long,
    val hasEditedAmount: Int,
    val editedDirection: String,
    val editedCategory: String,
    val editedMerchant: String,
    val editedOccurredAtMs: Long,
    val hasEditedOccurredAt: Int,
    val editedNote: String,
    val financeTransactionId: String,
    val createdAtMs: Long,
    val updatedAtMs: Long,
)
