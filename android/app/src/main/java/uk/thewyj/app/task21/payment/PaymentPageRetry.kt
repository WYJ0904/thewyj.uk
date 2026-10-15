package uk.thewyj.app.task21.payment

/** One finite budget per ticket and foreground window, shared by events and timers. */
class PaymentPageRetry(val key: String, val startedAtMs: Long) {
    var attempts = 0
        private set
    var cancelled = false
        private set
    private var lastAttemptAtMs = Long.MIN_VALUE / 4
    fun beginAttempt(nowMs: Long, scheduledRetryPending: Boolean = false): Boolean {
        if (scheduledRetryPending) return false
        if (cancelled || attempts >= MAX_ATTEMPTS || nowMs - startedAtMs > MAX_WINDOW_MS || nowMs - lastAttemptAtMs < MIN_ATTEMPT_INTERVAL_MS) return false
        attempts++; lastAttemptAtMs = nowMs
        return true
    }
    fun nextDelayMs(nowMs: Long, requestedDelayMs: Long? = null): Long? {
        if (cancelled || attempts >= MAX_ATTEMPTS || nowMs - startedAtMs >= MAX_WINDOW_MS) return null
        val requested = requestedDelayMs ?: DELAYS.getOrElse((attempts - 1).coerceAtLeast(0)) { 2_000L }
        // A screenshot cooldown can leave only1–249ms. A timer that fires in
        // that interval would be dropped by beginAttempt with no successor.
        val debounceRemaining = (MIN_ATTEMPT_INTERVAL_MS - (nowMs - lastAttemptAtMs)).coerceAtLeast(0)
        val delay = maxOf(requested.coerceAtLeast(1), debounceRemaining)
        return delay.takeIf { nowMs - startedAtMs + it <= MAX_WINDOW_MS }
    }
    fun cancel() { cancelled = true }
    companion object {
        const val MAX_ATTEMPTS = 8
        // A finite eight reads span the real ticket lifetime, including slow
        // clone/detail loads. The coordinator still enforces ticket expiry.
        const val MAX_WINDOW_MS = PaymentTicketEngine.DEFAULT_TTL_MS
        private const val MIN_ATTEMPT_INTERVAL_MS = 250L
        private val DELAYS = longArrayOf(250, 750, 2_000, 5_000, 12_000, 25_000, 35_000)
    }
}

/** One bounded read budget per account/ticket, shared across window changes. */
internal class PaymentPageRetryPool(private val capacity: Int = 8) {
    private val values = linkedMapOf<String, PaymentPageRetry>()
    fun budget(accountId: String, ticketId: String, nowMs: Long): PaymentPageRetry {
        val key = "$accountId|$ticketId"
        values.entries.removeAll { nowMs - it.value.startedAtMs > PaymentPageRetry.MAX_WINDOW_MS }
        return values[key] ?: PaymentPageRetry(key, nowMs).also {
            if (values.size >= capacity) values.remove(values.keys.first())?.cancel()
            values[key] = it
        }
    }
    fun clear() { values.values.forEach(PaymentPageRetry::cancel); values.clear() }
}
