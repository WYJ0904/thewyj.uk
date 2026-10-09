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
        const val MAX_WINDOW_MS = 12_000L
        private const val MIN_ATTEMPT_INTERVAL_MS = 250L
        private val DELAYS = longArrayOf(250, 500, 1_000, 1_500, 2_000, 2_000, 2_000)
    }
}
