package uk.thewyj.app.task21.payment

/** Display only. Business ticket expiry remains independently enforced. */
class PaymentCountdown {
    private val deadlines = mutableMapOf<String, Long>()

    fun remainingMs(ticketId: String, expiresAtMs: Long, wallMs: Long, elapsedMs: Long): Long {
        if (ticketId.isBlank() || expiresAtMs <= 0) return 0
        val wallRemaining = (expiresAtMs - wallMs).coerceAtLeast(0)
        val proposed = elapsedMs + wallRemaining
        // Recomposition, refresh and a backwards wall-clock adjustment cannot
        // extend a ticket already observed by this screen state.
        val deadline = minOf(deadlines[ticketId] ?: proposed, proposed)
        deadlines[ticketId] = deadline
        return minOf(wallRemaining, (deadline - elapsedMs).coerceAtLeast(0))
    }
}
