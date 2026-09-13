package uk.thewyj.app.task21.payment

/**
 * Task 24 reopen #4: how long may a device keep asking the server about the
 * records the user is looking at?
 *
 * Audit result of the previous implementation:
 *  - a pull happens on app foreground (`MainActivity.onStart`), on every
 *    `items()` refresh and after every local confirm/flush, so nothing is lost;
 *  - there is **no periodic poll**, which was correct;
 *  - but if the user confirmed a record on the Web while the Android screen
 *    stayed open, the local row kept showing 「待确认」 until the user left and
 *    came back. That wait was unbounded.
 *
 * This policy closes that gap with a bounded catch-up instead of a permanent
 * timer: a few pulls with a growing delay, then stop. It only runs while a
 * record still needs the server (queued upload / failed upload); terminal or
 * purely local records never trigger a pull.
 */
object PendingReconciliationPolicy {
    /** Growing delays between catch-up pulls. Sum = [windowMs]. */
    val BACKOFF_MS: LongArray = longArrayOf(1_500L, 3_000L, 6_000L, 12_000L)

    /** Total worst-case catch-up window: 22.5 seconds, then the device stops. */
    val windowMs: Long get() = BACKOFF_MS.sum()

    /** One reconciliation attempt is worth it only for these states. */
    fun needsReconciliation(syncStates: Collection<String>): Boolean =
        syncStates.any { state -> state == NEEDS_SERVER || state == NEEDS_RETRY }

    /**
     * Delay before the next pull, or null when the device must stop: nothing to
     * reconcile any more, or the bounded window is over.
     */
    fun nextDelayMs(attempt: Int, syncStates: Collection<String>): Long? {
        if (!needsReconciliation(syncStates)) return null
        if (attempt <= 0) return BACKOFF_MS.first()
        return BACKOFF_MS.getOrNull(attempt)
    }

    /** [PaymentVerificationCenter.SyncState.PENDING_SYNC]: the server owns it. */
    const val NEEDS_SERVER: String = "PENDING_SYNC"

    /** [PaymentVerificationCenter.SyncState.SYNC_FAILED]: a retry may fix it. */
    const val NEEDS_RETRY: String = "SYNC_FAILED"
}
