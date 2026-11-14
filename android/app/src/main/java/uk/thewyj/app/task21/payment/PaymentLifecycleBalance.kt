package uk.thewyj.app.task21.payment

/** Source facts, not available cash or an FX valuation. Null means unproven. */
data class PaymentLifecycleBalance(
    val authorizedMinor: Long?,
    val clearedMinor: Long,
    val releasedMinor: Long?,
    val remainingFrozenMinor: Long?,
    val refundedMinor: Long,
    val netExpenseMinor: Long,
    val overCapturedMinor: Long,
    val lastProvenRemainingMinor: Long?,
    val closed: Boolean,
    val reviewReasons: List<String>,
)

/** Rebuildable projection over existing recognition/ledger IDs, never another ledger. */
internal object PaymentLifecycleAccounting {
    private const val MAX_TOTAL = 9_007_199_254_740_991L
    val recoverable = setOf("lifecycle_capture_missing", "lifecycle_authorization_missing",
        "lifecycle_refund_exceeds_capture", "lifecycle_release_exceeds_remaining")

    fun project(records: List<PaymentRecognitionRecord>, bookings: List<LocalPaymentBooking>): PaymentLifecycleBalance {
        var outOfRange = false
        fun total(amounts: List<Long>): Long {
            var sum = 0L
            for (amount in amounts) {
                if (amount < 0 || amount > MAX_TOTAL - sum) { outOfRange = true; return 0 }
                sum += amount
            }
            return sum
        }
        val trusted = records.filter { it.identityReviewReason.isBlank() }
        val byRecognition = records.associateBy { it.recognitionId }
        // Aliases with the same canonical receipt can never multiply the money.
        val booked = bookings.filter { byRecognition.containsKey(it.recognitionId) }.distinctBy { it.transactionId }
        val cleared = total(booked.filter { byRecognition[it.recognitionId]?.financialPhase == "SETTLED" }.map { it.amountMinor })
        val refunded = total(booked.filter { byRecognition[it.recognitionId]?.financialPhase == "REFUNDED" }.map { it.amountMinor })
        val authorizations = trusted.filter { it.financialPhase == "AUTHORIZED" }.mapNotNull { it.amountMinor }.distinct()
        val authorized = authorizations.singleOrNull()
        val closed = trusted.any { it.financialPhase == "EXPIRED" || (it.financialPhase == "RELEASED" && it.lifecycleOperation != "RELEASE") }
        val partialReleased = trusted.filter { it.financialPhase == "RELEASED" && it.lifecycleOperation == "RELEASE" }
            .distinctBy { it.providerReference }.let { total(it.map { row -> row.amountMinor ?: 0 }) }
        // A full close releases the residual, not the originally displayed limit again.
        val released = if (closed && authorized != null) maxOf(authorized - cleared, partialReleased, 0) else partialReleased
        val remaining = authorized?.let { maxOf(it - cleared - released, 0) }
        val reasons = records.map { it.identityReviewReason }.filter(String::isNotBlank).distinct().toMutableList()
        if (authorizations.size > 1) reasons.add("lifecycle_authorization_conflict")
        if (records.map { it.currency }.distinct().size > 1) reasons.add("lifecycle_currency_conflict")
        if (outOfRange || (authorized != null && authorized !in 0..MAX_TOTAL)) reasons.add("lifecycle_total_out_of_range")
        if (closed && authorized == null) reasons.add("lifecycle_authorization_missing")
        val knownReleased = released.takeUnless { closed && (authorized == null || reasons.isNotEmpty()) }
        return PaymentLifecycleBalance(authorized, cleared, knownReleased,
            remaining.takeIf { reasons.isEmpty() }, refunded, maxOf(cleared - refunded, 0),
            authorized?.let { maxOf(cleared + partialReleased - it, 0) } ?: 0,
            if (knownReleased == null) authorized?.let { maxOf(it - cleared - partialReleased, 0) } else remaining,
            closed, reasons.distinct())
    }

    fun guard(record: PaymentRecognitionRecord, related: List<PaymentRecognitionRecord>, bookings: List<LocalPaymentBooking>): String {
        if (record.financialPhase.isBlank()) return ""
        if (record.lifecycleRevision > 1) return "lifecycle_revision_requires_reconciliation"
        val prior = related.filter { it.recognitionId != record.recognitionId }
        if (prior.any { it.sourcePackage == record.sourcePackage && it.sourceUid != null && record.sourceUid != null && it.sourceUid != record.sourceUid })
            return "source_instance_unverified"
        if (prior.any { it.identityReviewReason.isBlank() && it.currency != record.currency }) return "lifecycle_currency_conflict"
        val b = project(prior, bookings)
        val amount = record.amountMinor ?: return "lifecycle_amount_missing"
        if ("lifecycle_total_out_of_range" in b.reviewReasons || amount !in 0..MAX_TOTAL ||
            (record.financialPhase == "SETTLED" && amount > MAX_TOTAL - b.clearedMinor)) return "lifecycle_total_out_of_range"
        if (record.financialPhase == "REFUNDED" && (record.providerReference != record.lifecycleReference ||
                prior.any { it.financialPhase in setOf("AUTHORIZED", "SETTLED") })) {
            if (b.clearedMinor == 0L) return "lifecycle_capture_missing"
            if (amount > b.clearedMinor - b.refundedMinor) return "lifecycle_refund_exceeds_capture"
        }
        if (record.lifecycleOperation == "RELEASE") {
            if (b.authorizedMinor == null) return "lifecycle_authorization_missing"
            if (b.closed || amount > (b.lastProvenRemainingMinor ?: 0)) return "lifecycle_release_exceeds_remaining"
        }
        return ""
    }
}
