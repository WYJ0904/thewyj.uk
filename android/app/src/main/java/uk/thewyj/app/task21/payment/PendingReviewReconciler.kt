package uk.thewyj.app.task21.payment

import uk.thewyj.app.core.network.PendingReviewSummary

/**
 * Set reconciliation for the native notification banner.
 *
 * A local recognition and a cloud hint/candidate describe the same item only
 * when they share the structured event id. Counts are never added blindly:
 * equal amounts, close timestamps and application names are not identities.
 */
object PendingReviewReconciler {
    data class Snapshot(
        val total: Int,
        val local: Int,
        val remote: Int,
        val overlap: Int,
        val localOnly: Int,
        val remoteOnly: Int,
        val observedAt: String,
        val complete: Boolean,
        val unresolved: Int = 0,
    )

    fun reconcile(
        localRecognitions: List<PaymentRecognitionRecord>,
        remoteSummary: PendingReviewSummary,
    ): Snapshot {
        val local = localRecognitions.filter { it.state in PaymentVerificationCenter.ATTENTION_STATES }
        val localIds = local.map { it.uploadEventId.trim() }.filter(String::isNotEmpty).toSet()
        val unresolved = local.count { it.uploadEventId.isBlank() }
        val pending = remoteSummary.records.filter { it.state == "pending" }.distinctBy { it.id }
        val terminalIds = remoteSummary.records.filter { it.state != "pending" }.flatMap { it.eventIds }.toSet()
        val pendingIds = pending.flatMap { it.eventIds }.toSet()
        val overlap = pending.count { it.eventIds.any(localIds::contains) }
        val localOnly = (localIds - pendingIds - terminalIds).size
        val remoteOnly = (remoteSummary.totalCount - overlap).coerceAtLeast(0)
        return Snapshot(
            // The user-visible count is the server's canonical actionable set.
            // Local-only rows remain in Room for offline recovery, but cannot
            // inflate the normal notification/Finance pending count.
            total = remoteSummary.totalCount,
            local = (localIds - terminalIds).size + unresolved,
            remote = remoteSummary.totalCount,
            overlap = overlap,
            localOnly = localOnly,
            remoteOnly = remoteOnly,
            observedAt = remoteSummary.observedAt,
            complete = !remoteSummary.truncated && pending.size == remoteSummary.totalCount,
            unresolved = unresolved,
        )
    }
}

/** Keeps unsent device work visible without adding it to the server pending set. */
object PendingReviewVisibility {
    enum class Placement { CANONICAL, RECOVERY, HIDDEN }

    fun classify(
        eventIds: Set<String>,
        bookingEventId: String,
        serverPendingIds: Set<String>?,
        queuedOperationIds: Set<String>,
    ): Placement = when {
        serverPendingIds != null && eventIds.any(serverPendingIds::contains) -> Placement.CANONICAL
        eventIds.any { it in queuedOperationIds || "hint:$it" in queuedOperationIds } ||
            bookingEventId in queuedOperationIds -> Placement.RECOVERY
        else -> Placement.HIDDEN
    }
}
