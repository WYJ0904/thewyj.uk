package uk.thewyj.app.task21.payment

import uk.thewyj.app.task21.FinanceDirection
import java.util.UUID

/**
 * Short lived, package scoped enrichment ticket. The accessibility service may
 * only read a page while a ticket for that account + package is active, which
 * is what keeps the service from becoming a general screen scraper.
 */
enum class PaymentTicketState {
    CREATED,
    WAITING_FOR_ACCESSIBILITY,
    ENRICHED,
    CANDIDATE_CREATED,
    CONFIRMED,
    REJECTED,
    DUPLICATE,
    EXPIRED,
    FAILED,
    ;

    val terminal: Boolean
        get() = this in setOf(CONFIRMED, REJECTED, DUPLICATE, EXPIRED, FAILED)

    val active: Boolean
        get() = this in setOf(CREATED, WAITING_FOR_ACCESSIBILITY, ENRICHED, CANDIDATE_CREATED)
}

data class PaymentTicket(
    val ticketId: String,
    val accountId: String,
    val recognitionId: String,
    val sourcePackage: String,
    val sourceEventId: String,
    val paymentChannel: String,
    val amountHintMinor: Long?,
    val missingFields: Set<String>,
    val createdAtMs: Long,
    val expiresAtMs: Long,
    val state: PaymentTicketState,
    val attempts: Int = 0,
    val enrichment: PaymentEnrichment? = null,
)

data class PaymentEnrichment(
    val sourcePackage: String,
    val amountMinor: Long?,
    val currency: String?,
    val direction: FinanceDirection?,
    val merchant: String?,
    val counterparty: String?,
    val providerReference: String?,
    val occurredAtMs: Long?,
    val confidence: Int,
)

sealed interface EnrichmentOutcome {
    /** Enough evidence to continue towards candidate / Finance. */
    data class Applied(val ticket: PaymentTicket) : EnrichmentOutcome

    /** The page did not contain a reliable amount: nothing is invented. */
    data class Insufficient(val ticket: PaymentTicket) : EnrichmentOutcome

    data class Rejected(val ticket: PaymentTicket, val reason: String) : EnrichmentOutcome
}

class PaymentTicketEngine(
    private val now: () -> Long = System::currentTimeMillis,
    private val ttlMs: Long = DEFAULT_TTL_MS,
) {
    fun create(
        accountId: String,
        recognitionId: String,
        sourcePackage: String,
        sourceEventId: String,
        paymentChannel: String,
        amountHintMinor: Long? = null,
        missingFields: Set<String> = emptySet(),
    ): PaymentTicket {
        val createdAt = now()
        return PaymentTicket(
            ticketId = "ticket-" + UUID.randomUUID(),
            accountId = accountId,
            recognitionId = recognitionId,
            sourcePackage = sourcePackage,
            sourceEventId = sourceEventId,
            paymentChannel = paymentChannel,
            amountHintMinor = amountHintMinor,
            missingFields = missingFields,
            createdAtMs = createdAt,
            expiresAtMs = createdAt + ttlMs,
            state = PaymentTicketState.WAITING_FOR_ACCESSIBILITY,
        )
    }

    /** Tickets expire lazily; an expired ticket never accepts new evidence. */
    fun expireIfNeeded(ticket: PaymentTicket): PaymentTicket {
        if (ticket.state.terminal) return ticket
        if (now() <= ticket.expiresAtMs) return ticket
        return ticket.copy(state = PaymentTicketState.EXPIRED)
    }

    fun isActive(ticket: PaymentTicket): Boolean =
        ticket.state.active && now() <= ticket.expiresAtMs

    /**
     * Applies accessibility evidence. The package must match and the ticket must
     * still be inside its 90 second window; otherwise nothing is applied.
     */
    fun enrich(ticket: PaymentTicket, enrichment: PaymentEnrichment): EnrichmentOutcome {
        if (ticket.state.terminal) {
            return EnrichmentOutcome.Rejected(ticket, "ticket_terminal")
        }
        if (now() > ticket.expiresAtMs) {
            return EnrichmentOutcome.Rejected(ticket.copy(state = PaymentTicketState.EXPIRED), "ticket_expired")
        }
        if (!enrichment.sourcePackage.equals(ticket.sourcePackage, ignoreCase = true)) {
            return EnrichmentOutcome.Rejected(ticket, "package_mismatch")
        }
        val attempts = ticket.attempts + 1
        if (enrichment.amountMinor == null || enrichment.amountMinor <= 0) {
            return EnrichmentOutcome.Insufficient(ticket.copy(attempts = attempts))
        }
        val missing = ticket.missingFields - setOf("amount")
        return EnrichmentOutcome.Applied(
            ticket.copy(
                state = PaymentTicketState.ENRICHED,
                attempts = attempts,
                amountHintMinor = enrichment.amountMinor,
                missingFields = missing,
                enrichment = enrichment,
            ),
        )
    }

    fun markCandidateCreated(ticket: PaymentTicket): PaymentTicket =
        if (ticket.state.terminal) ticket else ticket.copy(state = PaymentTicketState.CANDIDATE_CREATED)

    fun markConfirmed(ticket: PaymentTicket): PaymentTicket =
        if (ticket.state == PaymentTicketState.CONFIRMED) ticket else ticket.copy(state = PaymentTicketState.CONFIRMED)

    fun markRejected(ticket: PaymentTicket): PaymentTicket =
        if (ticket.state.terminal) ticket else ticket.copy(state = PaymentTicketState.REJECTED)

    fun markDuplicate(ticket: PaymentTicket): PaymentTicket =
        if (ticket.state.terminal) ticket else ticket.copy(state = PaymentTicketState.DUPLICATE)

    fun markFailed(ticket: PaymentTicket): PaymentTicket =
        if (ticket.state.terminal) ticket else ticket.copy(state = PaymentTicketState.FAILED)

    companion object {
        const val DEFAULT_TTL_MS = 90_000L
    }
}
