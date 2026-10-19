package uk.thewyj.app.task21.store

import androidx.room.Entity

/** Recovery bridge between a Room commit, the existing disk outbox and HTTP. */
@Entity(tableName = "payment_reconciliations", primaryKeys = ["accountId", "operationId"])
data class PaymentReconciliationEntity(
    val accountId: String, val operationId: String, val payloadDigest: String, val payloadJson: String,
    val state: String, val reason: String, val beforeJson: String, val resultJson: String,
    val createdAtMs: Long, val updatedAtMs: Long,
)

/** Effective association only. The original recognition and archive remain evidence. */
@Entity(tableName = "payment_effective_recognitions", primaryKeys = ["accountId", "recognitionId"])
data class PaymentEffectiveRecognitionEntity(
    val accountId: String, val recognitionId: String, val canonicalRecognitionId: String,
    val amountMinor: Long, val financialPhase: String, val lifecycleOperation: String,
    val lifecycleRevision: Long, val lifecycleReference: String, val providerReference: String,
    val referenceNamespace: String, val operationId: String, val excluded: Int,
)

@Entity(tableName = "payment_user_decisions", primaryKeys = ["accountId", "recognitionId"])
data class PaymentUserDecisionEntity(val accountId: String, val recognitionId: String, val decision: String, val createdAtMs: Long)

/** One mistaken delivery can be detached without moving its entire recognition. */
@Entity(tableName = "payment_reconciliation_aliases", primaryKeys = ["accountId", "sourceEventId"])
data class PaymentReconciliationAliasEntity(val accountId: String, val sourceEventId: String, val canonicalRecognitionId: String, val excluded: Int, val operationId: String)
