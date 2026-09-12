package uk.thewyj.app.task21.payment

import uk.thewyj.app.task21.store.PaymentRecognitionStoreContract
import uk.thewyj.app.task21.FinanceDirection
import java.util.UUID

/**
 * The single payment recognition pipeline: notification / SMS / bank
 * notification / accessibility evidence all flow through here, and every state
 * change is persisted and (once) reported to the user.
 */
class PaymentRecognitionCoordinator(
    private val store: PaymentRecognitionStoreContract,
    private val tickets: PaymentTicketEngine = PaymentTicketEngine(),
    private val statusMachine: PaymentStatusStateMachine = PaymentStatusStateMachine(),
    private val notifier: PaymentStatusNotifier? = null,
    private val now: () -> Long = System::currentTimeMillis,
) {
    data class Outcome(
        val recognitionId: String,
        val state: PaymentRecognitionState?,
        val ticketId: String = "",
        val candidateId: String = "",
        val notificationPosted: Boolean = false,
        val skippedReason: String = "",
    )

    /**
     * Entry point for notification and SMS sources. [sourceEventId] must be a
     * stable identity (notification key + revision, SMS id, ...) so replays do
     * not create a second recognition.
     */
    fun onSourceEvent(
        accountId: String,
        sourcePackage: String,
        sourceType: PaymentSourceType,
        sourceEventId: String,
        title: String,
        text: String,
        bigText: String = "",
        subText: String = "",
        sourceAppLabel: String = "",
        uploadEventId: String = "",
        occurredAtMs: Long = now(),
    ): Outcome {
        if (accountId.isBlank() || sourcePackage.isBlank() || sourceEventId.isBlank()) {
            return Outcome("", null, skippedReason = "invalid_input")
        }
        val existing = store.recognitionBySourceEvent(accountId, sourceEventId)
        if (existing != null) {
            return Outcome(existing.recognitionId, null, skippedReason = "duplicate_source_event")
        }
        val parsed = PaymentParserRegistry.parse(
            sourcePackage = sourcePackage,
            sourceType = sourceType,
            title = title,
            text = text,
            bigText = bigText,
            subText = subText,
            capturedAtMs = occurredAtMs,
        )
        if (parsed.status == PaymentRecognitionStatus.NOT_PAYMENT ||
            parsed.status == PaymentRecognitionStatus.PARSE_ERROR
        ) {
            return Outcome("", null, skippedReason = "not_a_payment")
        }

        val recognitionId = "rec-" + UUID.randomUUID()
        val amountKnown = parsed.amountMinor != null
        var state = if (amountKnown) {
            PaymentRecognitionState.DETECTED_AMOUNT_KNOWN
        } else {
            PaymentRecognitionState.DETECTED_AMOUNT_UNKNOWN
        }
        var notificationPosted = false
        val amountLabel = parsed.amountMinor?.let { formatAmount(it) }.orEmpty()
        val directionLabel = parsed.direction?.let { directionLabel(it) }.orEmpty()

        var transition = statusMachine.transition(
            current = null,
            next = state,
            recognitionId = recognitionId,
            sourceAppLabel = sourceAppLabel,
            amountLabel = amountLabel,
            directionLabel = directionLabel,
            sourcePackage = sourcePackage,
        )
        var record = (transition as PaymentStatusTransition.Updated).record
        notificationPosted = post(transition)

        var ticketId = ""
        var candidateId = ""
        if (!amountKnown || parsed.status == PaymentRecognitionStatus.INSUFFICIENT_INFORMATION) {
            val ticket = tickets.create(
                accountId = accountId,
                recognitionId = recognitionId,
                sourcePackage = sourcePackage,
                sourceEventId = sourceEventId,
                paymentChannel = parsed.paymentChannel,
                amountHintMinor = parsed.amountMinor,
                missingFields = parsed.missingFields,
            )
            store.saveTicket(ticket)
            ticketId = ticket.ticketId
            transition = statusMachine.transition(
                current = record,
                next = PaymentRecognitionState.WAITING_FOR_ENRICHMENT,
                recognitionId = recognitionId,
                sourceAppLabel = sourceAppLabel,
                amountLabel = amountLabel,
                sourcePackage = sourcePackage,
            )
            if (transition is PaymentStatusTransition.Updated) {
                record = transition.record
                notificationPosted = post(transition) || notificationPosted
                state = record.state
            }
        } else {
            // Amount (and usually direction) known: create a candidate that the
            // user can edit before confirming; the backend may auto-record.
            val candidate = candidateFor(
                accountId = accountId,
                recognitionId = recognitionId,
                parsed = parsed,
                occurredAtMs = occurredAtMs,
            )
            store.saveCandidate(candidate)
            candidateId = candidate.candidateId
            transition = statusMachine.transition(
                current = record,
                next = PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION,
                recognitionId = recognitionId,
                sourceAppLabel = sourceAppLabel,
                amountLabel = amountLabel,
                directionLabel = directionLabel,
            )
            if (transition is PaymentStatusTransition.Updated) {
                record = transition.record
                notificationPosted = post(transition) || notificationPosted
                state = record.state
            }
        }

        store.saveRecognition(
            PaymentRecognitionRecord(
                recognitionId = recognitionId,
                accountId = accountId,
                state = state.name,
                notificationId = record.notificationId,
                sourcePackage = sourcePackage,
                sourceType = sourceType.name,
                sourceEventId = sourceEventId,
                uploadEventId = uploadEventId,
                paymentChannel = parsed.paymentChannel,
                amountMinor = parsed.amountMinor,
                currency = parsed.currency ?: "CNY",
                direction = parsed.direction?.name.orEmpty(),
                merchant = parsed.merchant.orEmpty(),
                providerReference = parsed.providerReference.orEmpty(),
                createdAtMs = now(),
                updatedAtMs = now(),
            ),
        )
        return Outcome(
            recognitionId = recognitionId,
            state = state,
            ticketId = ticketId,
            candidateId = candidateId,
            notificationPosted = notificationPosted,
        )
    }

    /** Accessibility evidence for the currently active ticket of that package. */
    fun onAccessibilityEnrichment(accountId: String, enrichment: PaymentEnrichment): EnrichmentOutcome {
        val ticket = store.activeTicketForPackage(accountId, enrichment.sourcePackage)
            ?: return EnrichmentOutcome.Rejected(
                ticket = PaymentTicket(
                    ticketId = "",
                    accountId = accountId,
                    recognitionId = "",
                    sourcePackage = enrichment.sourcePackage,
                    sourceEventId = "",
                    paymentChannel = "",
                    amountHintMinor = null,
                    missingFields = emptySet(),
                    createdAtMs = now(),
                    expiresAtMs = now(),
                    state = PaymentTicketState.FAILED,
                ),
                reason = "no_active_ticket",
            )
        val outcome = tickets.enrich(ticket, enrichment)
        when (outcome) {
            is EnrichmentOutcome.Applied -> {
                store.saveTicket(outcome.ticket)
                val recognition = store.recognition(ticket.accountId, ticket.recognitionId)
                if (recognition != null) {
                    val transition = statusMachine.transition(
                        current = PaymentStatusRecord(
                            recognitionId = recognition.recognitionId,
                            state = runCatching { PaymentRecognitionState.valueOf(recognition.state) }
                                .getOrDefault(PaymentRecognitionState.WAITING_FOR_ENRICHMENT),
                            updatedAtMs = recognition.updatedAtMs,
                            notificationId = recognition.notificationId,
                        ),
                        next = PaymentRecognitionState.ENRICHMENT_VERIFIED,
                        recognitionId = recognition.recognitionId,
                        sourceAppLabel = "",
                        amountLabel = outcome.ticket.amountHintMinor?.let { formatAmount(it) }.orEmpty(),
                    )
                    if (transition is PaymentStatusTransition.Updated) {
                        post(transition)
                        store.saveRecognition(
                            recognition.copy(
                                state = PaymentRecognitionState.ENRICHMENT_VERIFIED.name,
                                amountMinor = outcome.ticket.amountHintMinor,
                                updatedAtMs = now(),
                            ),
                        )
                    }
                    val candidate = PaymentCandidate(
                        candidateId = "cand-" + UUID.randomUUID(),
                        accountId = recognition.accountId,
                        recognitionId = recognition.recognitionId,
                        status = "pending",
                        amountMinor = outcome.ticket.amountHintMinor,
                        direction = enrichment.direction?.name.orEmpty(),
                        category = "",
                        merchant = enrichment.merchant.orEmpty(),
                        occurredAtMs = enrichment.occurredAtMs ?: now(),
                        channel = ticket.paymentChannel,
                        confidence = enrichment.confidence,
                        reason = "accessibility_enrichment",
                        createdAtMs = now(),
                        updatedAtMs = now(),
                    )
                    store.saveCandidate(candidate)
                    val verifiedTicket = tickets.markCandidateCreated(outcome.ticket)
                    store.saveTicket(verifiedTicket)
                }
                return EnrichmentOutcome.Applied(outcome.ticket)
            }
            is EnrichmentOutcome.Insufficient -> {
                store.saveTicket(outcome.ticket)
                return outcome
            }
            is EnrichmentOutcome.Rejected -> {
                if (outcome.ticket.state == PaymentTicketState.EXPIRED) {
                    store.saveTicket(outcome.ticket)
                    expireRecognition(accountId, ticket.recognitionId)
                }
                return outcome
            }
        }
    }

    /** Lazily expires tickets and tells the user once per expired recognition. */
    fun expireTickets(accountId: String): Int {
        var expired = 0
        val recognitions = store.candidates(accountId, "pending", 200)
        // Tickets are expired on access: the coordinator checks the ticket that
        // belongs to each recognition that is still waiting for enrichment.
        for (candidate in recognitions) {
            val recognition = store.recognition(accountId, candidate.recognitionId) ?: continue
            if (recognition.state != PaymentRecognitionState.WAITING_FOR_ENRICHMENT.name) continue
            val ticket = store.ticketsForRecognition(accountId, candidate.recognitionId).firstOrNull() ?: continue
            val expiredTicket = tickets.expireIfNeeded(ticket)
            if (expiredTicket.state == PaymentTicketState.EXPIRED && ticket.state != PaymentTicketState.EXPIRED) {
                store.saveTicket(expiredTicket)
                expireRecognition(accountId, candidate.recognitionId)
                expired += 1
            }
        }
        return expired
    }

    /**
     * The page was read but produced no usable amount (or nothing at all: some
     * apps, WeChat included, expose no text to the accessibility tree at all).
     *
     * Two misses close the automatic attempt honestly: the ticket is marked
     * failed so the service stops reading the package, the recognition becomes
     * VERIFICATION_FAILED and the user is told once, with the manual entry path
     * still available.
     */
    fun onAccessibilityMiss(accountId: String, sourcePackage: String): Boolean {
        val ticket = store.activeTicketForPackage(accountId, sourcePackage) ?: return false
        val missed = ticket.copy(attempts = ticket.attempts + 1)
        if (missed.attempts < MISSES_BEFORE_FAILING) {
            store.saveTicket(missed)
            return false
        }
        store.saveTicket(tickets.markFailed(missed))
        val recognition = store.recognition(accountId, ticket.recognitionId) ?: return true
        val transition = statusMachine.transition(
            current = PaymentStatusRecord(
                recognitionId = recognition.recognitionId,
                state = runCatching { PaymentRecognitionState.valueOf(recognition.state) }
                    .getOrDefault(PaymentRecognitionState.WAITING_FOR_ENRICHMENT),
                updatedAtMs = recognition.updatedAtMs,
                notificationId = recognition.notificationId,
            ),
            next = PaymentRecognitionState.VERIFICATION_FAILED,
            recognitionId = recognition.recognitionId,
            sourceAppLabel = "",
            sourcePackage = sourcePackage,
        )
        if (transition is PaymentStatusTransition.Updated) post(transition)
        store.saveRecognition(
            recognition.copy(state = PaymentRecognitionState.VERIFICATION_FAILED.name, updatedAtMs = now()),
        )
        return true
    }

    private fun expireRecognition(accountId: String, recognitionId: String) {
        val recognition = store.recognition(accountId, recognitionId) ?: return
        val transition = statusMachine.transition(
            current = PaymentStatusRecord(
                recognitionId = recognition.recognitionId,
                state = runCatching { PaymentRecognitionState.valueOf(recognition.state) }
                    .getOrDefault(PaymentRecognitionState.WAITING_FOR_ENRICHMENT),
                updatedAtMs = recognition.updatedAtMs,
                notificationId = recognition.notificationId,
            ),
            next = PaymentRecognitionState.ENRICHMENT_EXPIRED,
            recognitionId = recognition.recognitionId,
            sourceAppLabel = "",
            sourcePackage = recognition.sourcePackage,
        )
        if (transition is PaymentStatusTransition.Updated) {
            post(transition)
            store.saveRecognition(
                recognition.copy(state = PaymentRecognitionState.ENRICHMENT_EXPIRED.name, updatedAtMs = now()),
            )
        }
    }

    /** Manual "核实交易金额" restart: a fresh 90 second ticket for the same event. */
    fun restartVerification(accountId: String, recognitionId: String): PaymentTicket? {
        val recognition = store.recognition(accountId, recognitionId) ?: return null
        val ticket = tickets.create(
            accountId = accountId,
            recognitionId = recognitionId,
            sourcePackage = recognition.sourcePackage,
            sourceEventId = recognition.sourceEventId,
            paymentChannel = recognition.paymentChannel,
            amountHintMinor = recognition.amountMinor,
            missingFields = setOf("amount"),
        )
        store.saveTicket(ticket)
        val transition = statusMachine.transition(
            current = PaymentStatusRecord(
                recognitionId = recognitionId,
                state = runCatching { PaymentRecognitionState.valueOf(recognition.state) }
                    .getOrDefault(PaymentRecognitionState.ENRICHMENT_EXPIRED),
                updatedAtMs = recognition.updatedAtMs,
                notificationId = recognition.notificationId,
            ),
            next = PaymentRecognitionState.WAITING_FOR_ENRICHMENT,
            recognitionId = recognitionId,
            sourceAppLabel = "",
        )
        if (transition is PaymentStatusTransition.Updated) post(transition)
        store.saveRecognition(
            recognition.copy(state = PaymentRecognitionState.WAITING_FOR_ENRICHMENT.name, updatedAtMs = now()),
        )
        return ticket
    }

    /** Applies user edits to a candidate before it is confirmed. */
    fun editCandidate(
        accountId: String,
        candidateId: String,
        amountMinor: Long? = null,
        direction: String = "",
        category: String = "",
        merchant: String = "",
        occurredAtMs: Long? = null,
        note: String = "",
    ): PaymentCandidate? {
        val candidate = store.candidate(accountId, candidateId) ?: return null
        if (candidate.status != "pending") return candidate
        val edited = candidate.copy(
            editedAmountMinor = amountMinor ?: candidate.editedAmountMinor,
            editedDirection = direction.ifBlank { candidate.editedDirection },
            editedCategory = category.ifBlank { candidate.editedCategory },
            editedMerchant = merchant.ifBlank { candidate.editedMerchant },
            editedOccurredAtMs = occurredAtMs ?: candidate.editedOccurredAtMs,
            editedNote = note.ifBlank { candidate.editedNote },
            updatedAtMs = now(),
        )
        store.saveCandidate(edited)
        return edited
    }

    /**
     * Records the user's manual amount for a recognition that never produced a
     * candidate.
     *
     * Amount-unknown captures (real WeChat notifications expose no page text)
     * only get a 90 second enrichment ticket, so `candidateId` stays empty and
     * the「填写金额并记账」flow had nothing to save into: `editCandidate("")`
     * returned null and the UI answered「修改没有保存，请重试」forever
     * (real device, SM-S9360, 2026-09-13). Creating the candidate from the
     * user's values is the only path that can book this payment.
     */
    fun ensureCandidateForRecognition(
        accountId: String,
        recognitionId: String,
        amountMinor: Long? = null,
        direction: String = "",
        merchant: String = "",
        occurredAtMs: Long? = null,
    ): PaymentCandidate? {
        val recognition = store.recognition(accountId, recognitionId) ?: return null
        val existing = store.candidateForRecognition(accountId, recognitionId)
        if (existing != null) {
            return editCandidate(
                accountId = accountId,
                candidateId = existing.candidateId,
                amountMinor = amountMinor,
                direction = direction,
                merchant = merchant,
                occurredAtMs = occurredAtMs,
            )
        }
        val candidate = PaymentCandidate(
            candidateId = "cand-" + UUID.randomUUID(),
            accountId = accountId,
            recognitionId = recognitionId,
            status = "pending",
            // The machine never saw an amount: nothing is frozen as evidence,
            // only the user's values live in the edited fields.
            amountMinor = null,
            direction = FinanceDirection.UNKNOWN.name,
            category = "",
            merchant = "",
            occurredAtMs = occurredAtMs ?: recognition.createdAtMs,
            channel = recognition.paymentChannel,
            confidence = 0,
            reason = "manual_amount",
            editedAmountMinor = amountMinor,
            editedDirection = direction,
            editedMerchant = merchant,
            editedOccurredAtMs = occurredAtMs ?: recognition.createdAtMs,
            createdAtMs = now(),
            updatedAtMs = now(),
        )
        store.saveCandidate(candidate)
        return candidate
    }

    /**
     * Confirms a candidate. The user's edits win; exactly one draft is produced
     * so the Finance pipeline can never create both the original and the edited
     * transaction.
     */
    fun confirmCandidate(
        accountId: String,
        candidateId: String,
        edits: EditRequest? = null,
    ): FinanceDraft? {
        var candidate = store.candidate(accountId, candidateId) ?: return null
        if (candidate.status == "confirmed" && candidate.financeTransactionId.isNotBlank()) {
            return draftOf(candidate)
        }
        if (edits != null) {
            candidate = editCandidate(
                accountId = accountId,
                candidateId = candidateId,
                amountMinor = edits.amountMinor,
                direction = edits.direction,
                category = edits.category,
                merchant = edits.merchant,
                occurredAtMs = edits.occurredAtMs,
                note = edits.note,
            ) ?: return null
        }
        val confirmed = candidate.copy(status = "confirmed", updatedAtMs = now())
        store.saveCandidate(confirmed)
        val recognition = store.recognition(accountId, confirmed.recognitionId)
        if (recognition != null) {
            val currentState = runCatching { PaymentRecognitionState.valueOf(recognition.state) }
                .getOrDefault(PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION)
            val next = if (confirmed.hasEdits) {
                PaymentRecognitionState.FINANCE_MANUALLY_CONFIRMED
            } else {
                PaymentRecognitionState.FINANCE_RECORDED
            }
            val transition = statusMachine.transition(
                current = PaymentStatusRecord(
                    recognitionId = recognition.recognitionId,
                    state = currentState,
                    updatedAtMs = recognition.updatedAtMs,
                    notificationId = recognition.notificationId,
                ),
                next = next,
                recognitionId = recognition.recognitionId,
                sourceAppLabel = "",
                amountLabel = confirmed.effectiveAmountMinor?.let { formatAmount(it) }.orEmpty(),
            )
            if (transition is PaymentStatusTransition.Updated) post(transition)
            store.saveRecognition(
                recognition.copy(state = next.name, updatedAtMs = now()),
            )
        }
        return draftOf(confirmed)
    }

    fun rejectCandidate(accountId: String, candidateId: String): Boolean {
        val candidate = store.candidate(accountId, candidateId) ?: return false
        store.saveCandidate(candidate.copy(status = "rejected", updatedAtMs = now()))
        return true
    }

    /** Called when Task 16/17 reports the canonical transaction id back. */
    fun markFinanceRecorded(accountId: String, candidateId: String, transactionId: String) {
        val candidate = store.candidate(accountId, candidateId) ?: return
        store.saveCandidate(candidate.copy(financeTransactionId = transactionId, updatedAtMs = now()))
        val recognition = store.recognition(accountId, candidate.recognitionId) ?: return
        val transition = statusMachine.transition(
            current = PaymentStatusRecord(
                recognitionId = recognition.recognitionId,
                state = runCatching { PaymentRecognitionState.valueOf(recognition.state) }
                    .getOrDefault(PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION),
                updatedAtMs = recognition.updatedAtMs,
                notificationId = recognition.notificationId,
            ),
            next = PaymentRecognitionState.FINANCE_RECORDED,
            recognitionId = recognition.recognitionId,
            sourceAppLabel = "",
            amountLabel = candidate.effectiveAmountMinor?.let { formatAmount(it) }.orEmpty(),
        )
        if (transition is PaymentStatusTransition.Updated) post(transition)
        store.saveRecognition(recognition.copy(state = PaymentRecognitionState.FINANCE_RECORDED.name, updatedAtMs = now()))
    }

    /** Reports that a user corrected an already recorded transaction. */
    fun markFinanceCorrected(accountId: String, recognitionId: String, amountMinor: Long?) {
        val recognition = store.recognition(accountId, recognitionId) ?: return
        val transition = statusMachine.transition(
            current = PaymentStatusRecord(
                recognitionId = recognition.recognitionId,
                state = runCatching { PaymentRecognitionState.valueOf(recognition.state) }
                    .getOrDefault(PaymentRecognitionState.FINANCE_RECORDED),
                updatedAtMs = recognition.updatedAtMs,
                notificationId = recognition.notificationId,
            ),
            next = PaymentRecognitionState.FINANCE_CORRECTED,
            recognitionId = recognition.recognitionId,
            sourceAppLabel = "",
            amountLabel = amountMinor?.let { formatAmount(it) }.orEmpty(),
        )
        if (transition is PaymentStatusTransition.Updated) post(transition)
        store.saveRecognition(recognition.copy(state = PaymentRecognitionState.FINANCE_CORRECTED.name, updatedAtMs = now()))
    }

    /**
     * Reconciliation: a second source describing the same amount inside a short
     * window becomes evidence for the existing candidate instead of a duplicate.
     * Amount alone is never enough - the window and a pending/confirmed
     * candidate for the same account are both required.
     */
    fun reconcile(
        accountId: String,
        amountMinor: Long,
        occurredAtMs: Long,
        windowMs: Long = RECONCILIATION_WINDOW_MS,
    ): PaymentCandidate? {
        if (amountMinor <= 0) return null
        return store.reconciliationMatch(accountId, amountMinor, occurredAtMs, windowMs)
    }

    data class EditRequest(
        val amountMinor: Long? = null,
        val direction: String = "",
        val category: String = "",
        val merchant: String = "",
        val occurredAtMs: Long? = null,
        val note: String = "",
    )

    private fun draftOf(candidate: PaymentCandidate) = FinanceDraft(
        accountId = candidate.accountId,
        candidateId = candidate.candidateId,
        recognitionId = candidate.recognitionId,
        amountMinor = candidate.effectiveAmountMinor ?: 0L,
        direction = candidate.effectiveDirection,
        category = candidate.effectiveCategory,
        merchant = candidate.effectiveMerchant,
        occurredAtMs = candidate.effectiveOccurredAtMs,
        channel = candidate.channel,
        note = candidate.editedNote,
        userEdited = candidate.hasEdits,
    )

    private fun candidateFor(
        accountId: String,
        recognitionId: String,
        parsed: ParsedPaymentMessage,
        occurredAtMs: Long,
    ) = PaymentCandidate(
        candidateId = "cand-" + UUID.randomUUID(),
        accountId = accountId,
        recognitionId = recognitionId,
        status = "pending",
        amountMinor = parsed.amountMinor,
        direction = parsed.direction?.name.orEmpty(),
        category = "",
        merchant = parsed.merchant.orEmpty(),
        occurredAtMs = parsed.occurredAtMs ?: occurredAtMs,
        channel = parsed.paymentChannel,
        confidence = parsed.confidence,
        reason = parsed.reasons.joinToString(","),
        createdAtMs = now(),
        updatedAtMs = now(),
    )

    private fun post(transition: PaymentStatusTransition): Boolean {
        val updated = transition as? PaymentStatusTransition.Updated ?: return false
        return notifier?.notify(updated.message) ?: false
    }

    companion object {
        /** Two sources within three minutes are treated as the same payment. */
        const val RECONCILIATION_WINDOW_MS = 3 * 60 * 1000L

        /** Failed page reads before the automatic attempt is reported as failed. */
        const val MISSES_BEFORE_FAILING = 2

        fun formatAmount(amountMinor: Long): String {
            val value = amountMinor / 100.0
            return "¥" + String.format(java.util.Locale.US, "%.2f", value)
        }

        fun directionLabel(direction: uk.thewyj.app.task21.FinanceDirection): String = when (direction) {
            uk.thewyj.app.task21.FinanceDirection.EXPENSE -> "支出"
            uk.thewyj.app.task21.FinanceDirection.INCOME -> "收入"
            uk.thewyj.app.task21.FinanceDirection.REFUND -> "退款"
            uk.thewyj.app.task21.FinanceDirection.UNKNOWN -> ""
        }
    }
}
