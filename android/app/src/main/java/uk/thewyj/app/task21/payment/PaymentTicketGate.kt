package uk.thewyj.app.task21.payment

import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

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
 * Task 24 reopen #10: process-wide, memory-only hint that a package just
 * received a verification ticket.
 *
 * The accessibility gate is refreshed from Room on a short cadence, so a
 * brand-new ticket could be created *after* the last refresh and the first
 * accessibility event (the only one that carries the amount for some pages)
 * would be dropped as `no_active_ticket`. Publishing the package the moment the
 * ticket is created removes that race without widening the gate: the Room ticket
 * itself is still the authority and is re-checked on the worker thread before
 * anything is parsed or enriched.
 */
object PaymentTicketPackageSignal {
    /** How long a signal may keep one package eligible for a first look. */
    const val WINDOW_MS = 120_000L

    private val published = ConcurrentHashMap<String, Long>()

    fun publish(sourcePackage: String, nowMs: Long = System.currentTimeMillis()) {
        val key = normalize(sourcePackage)
        if (key.isEmpty()) return
        published[key] = nowMs
    }

    fun recentlySignalled(sourcePackage: String, nowMs: Long = System.currentTimeMillis()): Boolean {
        val key = normalize(sourcePackage)
        if (key.isEmpty()) return false
        val at = published[key] ?: return false
        if (nowMs - at > WINDOW_MS) {
            published.remove(key)
            return false
        }
        return true
    }

    /** Account switch / session reset: never carry another account's hint over. */
    fun clear() {
        published.clear()
    }

    fun size(): Int = published.size

    private fun normalize(value: String): String = value.trim().lowercase(Locale.ROOT)
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
