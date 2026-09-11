package uk.thewyj.app.task21.payment

import java.util.Locale

/**
 * Cheap in-memory gate for the payment AccessibilityService.
 *
 * Real-device report: the service logged `accessibility-parser result=no_active_ticket`
 * for SystemUI, launcher and IME events dozens of times per second, because
 * every accessibility event performed a Room query even when no 90 second
 * verification ticket existed. The gate keeps the set of packages that really
 * own an active ticket, so noise events cost nothing and the log stays
 * readable.
 */
class PaymentTicketPackageCache(
    private val refreshIntervalMs: Long = DEFAULT_REFRESH_MS,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private var values: Set<String> = emptySet()
    private var refreshedAtMs: Long = Long.MIN_VALUE / 4

    fun contains(sourcePackage: String): Boolean =
        values.contains(sourcePackage.lowercase(Locale.ROOT))

    fun isEmpty(): Boolean = values.isEmpty()

    fun needsRefresh(): Boolean = now() - refreshedAtMs >= refreshIntervalMs

    fun refreshWith(packages: Collection<String>) {
        values = packages.map { it.lowercase(Locale.ROOT) }.toSet()
        refreshedAtMs = now()
    }

    companion object {
        /** Tickets have a 90 second lifetime; a few seconds of cache is plenty. */
        const val DEFAULT_REFRESH_MS = 3_000L
    }
}

/**
 * Repeats one log line at most once per interval for the same key. Used so a
 * continuous stream of identical parser results cannot flood logcat while a
 * state change is still always reported.
 */
class PaymentLogThrottle(
    private val intervalMs: Long = DEFAULT_INTERVAL_MS,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private var lastKey: String = ""
    private var lastAtMs: Long = Long.MIN_VALUE / 4

    fun allow(key: String): Boolean {
        val current = now()
        if (key == lastKey && current - lastAtMs < intervalMs) return false
        lastKey = key
        lastAtMs = current
        return true
    }

    companion object {
        const val DEFAULT_INTERVAL_MS = 15_000L
    }
}
