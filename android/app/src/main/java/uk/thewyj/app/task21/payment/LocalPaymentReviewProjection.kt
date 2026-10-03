package uk.thewyj.app.task21.payment

import uk.thewyj.app.core.network.PendingReviewSummary

/** A persisted local transaction removes manual review, without inventing a cloud receipt. */
object LocalPaymentReviewProjection {
    fun apply(summary: PendingReviewSummary, bookedEventIds: Set<String>): PendingReviewSummary {
        val removed = summary.records.filter { it.state == "pending" && (it.eventIds + it.eventId).any(bookedEventIds::contains) }
        if (removed.isEmpty()) return summary
        return summary.copy(records = summary.records - removed.toSet(),
            totalCount = (summary.totalCount - removed.size).coerceAtLeast(0),
            hintCount = (summary.hintCount - removed.count { it.kind == "hint" }).coerceAtLeast(0),
            candidateCount = (summary.candidateCount - removed.count { it.kind == "candidate" }).coerceAtLeast(0))
    }
}
