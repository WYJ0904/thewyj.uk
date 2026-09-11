package uk.thewyj.app.task21.store

import uk.thewyj.app.task21.payment.PaymentCandidate
import uk.thewyj.app.task21.payment.PaymentRecognitionRecord
import uk.thewyj.app.task21.payment.PaymentTicket
import uk.thewyj.app.task21.payment.PaymentTicketState
import uk.thewyj.app.task21.payment.PaymentEnrichment
import uk.thewyj.app.task21.FinanceDirection

/**
 * Persistence contract for payment recognition. Implemented by Room and by an
 * in-memory fake so the whole pipeline is unit testable without a device.
 */
interface PaymentRecognitionStoreContract {
    fun saveRecognition(record: PaymentRecognitionRecord)
    fun recognition(accountId: String, recognitionId: String): PaymentRecognitionRecord?
    fun recognitionBySourceEvent(accountId: String, sourceEventId: String): PaymentRecognitionRecord?

    fun saveTicket(ticket: PaymentTicket)
    fun ticket(accountId: String, ticketId: String): PaymentTicket?
    fun activeTicketForPackage(accountId: String, sourcePackage: String): PaymentTicket?
    fun ticketsForRecognition(accountId: String, recognitionId: String): List<PaymentTicket>

    fun saveCandidate(candidate: PaymentCandidate)
    fun candidate(accountId: String, candidateId: String): PaymentCandidate?
    fun candidateForRecognition(accountId: String, recognitionId: String): PaymentCandidate?
    fun candidates(accountId: String, status: String, limit: Int = 100): List<PaymentCandidate>
    fun pendingCandidateCount(accountId: String): Int

    fun observePendingCandidateCount(accountId: String): kotlinx.coroutines.flow.Flow<Int>

    fun reconciliationMatch(
        accountId: String,
        amountMinor: Long,
        occurredAtMs: Long,
        windowMs: Long,
    ): PaymentCandidate?
}

class RoomPaymentRecognitionStore(private val database: NotificationDatabase) : PaymentRecognitionStoreContract {
    private val dao get() = database.paymentDao()

    override fun saveRecognition(record: PaymentRecognitionRecord) = dao.upsertRecognition(record.toEntity())

    override fun recognition(accountId: String, recognitionId: String): PaymentRecognitionRecord? =
        dao.recognition(accountId, recognitionId)?.toModel()

    override fun recognitionBySourceEvent(accountId: String, sourceEventId: String): PaymentRecognitionRecord? =
        dao.recognitionBySourceEvent(accountId, sourceEventId)?.toModel()

    override fun saveTicket(ticket: PaymentTicket) = dao.upsertTicket(ticket.toEntity())

    override fun ticket(accountId: String, ticketId: String): PaymentTicket? =
        dao.ticket(accountId, ticketId)?.toModel()

    override fun activeTicketForPackage(accountId: String, sourcePackage: String): PaymentTicket? =
        dao.activeTicketForPackage(accountId, sourcePackage)?.toModel()

    override fun ticketsForRecognition(accountId: String, recognitionId: String): List<PaymentTicket> =
        dao.ticketsForRecognition(accountId, recognitionId).map { it.toModel() }

    override fun saveCandidate(candidate: PaymentCandidate) = dao.upsertCandidate(candidate.toEntity())

    override fun candidate(accountId: String, candidateId: String): PaymentCandidate? =
        dao.candidate(accountId, candidateId)?.toModel()

    override fun candidateForRecognition(accountId: String, recognitionId: String): PaymentCandidate? =
        dao.candidateForRecognition(accountId, recognitionId)?.toModel()

    override fun candidates(accountId: String, status: String, limit: Int): List<PaymentCandidate> =
        dao.candidatesByStatus(accountId, status, limit).map { it.toModel() }

    override fun pendingCandidateCount(accountId: String): Int = dao.pendingCandidateCount(accountId)

    override fun observePendingCandidateCount(accountId: String): kotlinx.coroutines.flow.Flow<Int> =
        dao.observePendingCandidateCount(accountId)

    override fun reconciliationMatch(
        accountId: String,
        amountMinor: Long,
        occurredAtMs: Long,
        windowMs: Long,
    ): PaymentCandidate? = dao.reconciliationCandidates(
        accountId = accountId,
        amountMinor = amountMinor,
        occurredAtMs = occurredAtMs,
        fromMs = occurredAtMs - windowMs,
        toMs = occurredAtMs + windowMs,
    ).firstOrNull()?.toModel()
}

internal fun PaymentRecognitionRecord.toEntity() = PaymentRecognitionEntity(
    recognitionId = recognitionId,
    accountId = accountId,
    state = state,
    notificationId = notificationId,
    sourcePackage = sourcePackage,
    sourceType = sourceType,
    sourceEventId = sourceEventId,
    paymentChannel = paymentChannel,
    amountMinor = amountMinor ?: 0L,
    hasAmount = if (amountMinor != null) 1 else 0,
    currency = currency,
    direction = direction,
    merchant = merchant,
    providerReference = providerReference,
    createdAtMs = createdAtMs,
    updatedAtMs = updatedAtMs,
)

internal fun PaymentRecognitionEntity.toModel() = PaymentRecognitionRecord(
    recognitionId = recognitionId,
    accountId = accountId,
    state = state,
    notificationId = notificationId,
    sourcePackage = sourcePackage,
    sourceType = sourceType,
    sourceEventId = sourceEventId,
    paymentChannel = paymentChannel,
    amountMinor = if (hasAmount == 1) amountMinor else null,
    currency = currency,
    direction = direction,
    merchant = merchant,
    providerReference = providerReference,
    createdAtMs = createdAtMs,
    updatedAtMs = updatedAtMs,
)

internal fun PaymentTicket.toEntity() = PaymentTicketEntity(
    ticketId = ticketId,
    accountId = accountId,
    recognitionId = recognitionId,
    sourcePackage = sourcePackage,
    sourceEventId = sourceEventId,
    paymentChannel = paymentChannel,
    amountHintMinor = amountHintMinor ?: 0L,
    hasAmountHint = if (amountHintMinor != null) 1 else 0,
    missingFields = missingFields.joinToString(","),
    state = state.name,
    attempts = attempts,
    createdAtMs = createdAtMs,
    expiresAtMs = expiresAtMs,
    enrichedAmountMinor = enrichment?.amountMinor ?: 0L,
    hasEnrichedAmount = if (enrichment?.amountMinor != null) 1 else 0,
    enrichedDirection = enrichment?.direction?.name.orEmpty(),
    enrichedMerchant = enrichment?.merchant.orEmpty(),
    enrichedProviderReference = enrichment?.providerReference.orEmpty(),
    enrichedAtMs = enrichment?.occurredAtMs ?: 0L,
)

internal fun PaymentTicketEntity.toModel() = PaymentTicket(
    ticketId = ticketId,
    accountId = accountId,
    recognitionId = recognitionId,
    sourcePackage = sourcePackage,
    sourceEventId = sourceEventId,
    paymentChannel = paymentChannel,
    amountHintMinor = if (hasAmountHint == 1) amountHintMinor else null,
    missingFields = if (missingFields.isBlank()) emptySet() else missingFields.split(",").toSet(),
    createdAtMs = createdAtMs,
    expiresAtMs = expiresAtMs,
    state = runCatching { PaymentTicketState.valueOf(state) }.getOrDefault(PaymentTicketState.CREATED),
    attempts = attempts,
    enrichment = if (hasEnrichedAmount == 1) {
        PaymentEnrichment(
            sourcePackage = sourcePackage,
            amountMinor = enrichedAmountMinor,
            currency = "CNY",
            direction = runCatching { FinanceDirection.valueOf(enrichedDirection) }.getOrNull(),
            merchant = enrichedMerchant.ifBlank { null },
            counterparty = null,
            providerReference = enrichedProviderReference.ifBlank { null },
            occurredAtMs = enrichedAtMs,
            confidence = 800,
        )
    } else {
        null
    },
)

internal fun PaymentCandidate.toEntity() = PaymentCandidateEntity(
    candidateId = candidateId,
    accountId = accountId,
    recognitionId = recognitionId,
    status = status,
    amountMinor = amountMinor ?: 0L,
    hasAmount = if (amountMinor != null) 1 else 0,
    direction = direction,
    category = category,
    merchant = merchant,
    occurredAtMs = occurredAtMs,
    channel = channel,
    confidence = confidence,
    reason = reason,
    editedAmountMinor = editedAmountMinor ?: 0L,
    hasEditedAmount = if (editedAmountMinor != null) 1 else 0,
    editedDirection = editedDirection,
    editedCategory = editedCategory,
    editedMerchant = editedMerchant,
    editedOccurredAtMs = editedOccurredAtMs ?: 0L,
    hasEditedOccurredAt = if (editedOccurredAtMs != null) 1 else 0,
    editedNote = editedNote,
    financeTransactionId = financeTransactionId,
    createdAtMs = createdAtMs,
    updatedAtMs = updatedAtMs,
)

internal fun PaymentCandidateEntity.toModel() = PaymentCandidate(
    candidateId = candidateId,
    accountId = accountId,
    recognitionId = recognitionId,
    status = status,
    amountMinor = if (hasAmount == 1) amountMinor else null,
    direction = direction,
    category = category,
    merchant = merchant,
    occurredAtMs = occurredAtMs,
    channel = channel,
    confidence = confidence,
    reason = reason,
    editedAmountMinor = if (hasEditedAmount == 1) editedAmountMinor else null,
    editedDirection = editedDirection,
    editedCategory = editedCategory,
    editedMerchant = editedMerchant,
    editedOccurredAtMs = if (hasEditedOccurredAt == 1) editedOccurredAtMs else null,
    editedNote = editedNote,
    financeTransactionId = financeTransactionId,
    createdAtMs = createdAtMs,
    updatedAtMs = updatedAtMs,
)
