package uk.thewyj.app.task21.payment

import uk.thewyj.app.core.network.PendingReviewIdentity
import uk.thewyj.app.task21.NotificationArchiveSink
import uk.thewyj.app.task21.store.PaymentRecognitionStoreContract

/** Resolve sparse legacy upload identities only from a complete exact receipt set. */
object LocalPaymentReceiptReconciler {
    fun apply(accountId: String, store: PaymentRecognitionStoreContract, archive: NotificationArchiveSink,
        records: List<PendingReviewIdentity>): Int {
        var resolved = 0
        for (booking in store.localBookings(accountId).filter { it.syncState == "identity_pending" }) {
            val recognition = store.recognition(accountId, booking.recognitionId) ?: continue
            val aliases = archive.structuredEventIdsForRecognition(accountId, recognition.sourceEventId).toSet()
            if (aliases.isEmpty()) continue
            val matches = records.filter { row -> (row.eventIds + row.eventId).any(aliases::contains) }
            val covered = matches.flatMap { it.eventIds + it.eventId }.toSet()
            val transactions = matches.map { it.transactionId }.filter(String::isNotBlank).toSet()
            if (!covered.containsAll(aliases) || matches.any { it.state != "confirmed" } || transactions.size != 1) continue
            val transactionId = transactions.single()
            store.acknowledgeLocalBooking(accountId, booking.eventId, transactionId)
            store.candidateForRecognition(accountId, recognition.recognitionId)?.let {
                store.saveCandidate(it.copy(status = "confirmed", financeTransactionId = transactionId))
            }
            store.saveRecognition(recognition.copy(state = "FINANCE_RECORDED"))
            aliases.forEach { archive.markFinanceOutcome(accountId, it, "confirmed", transactionId) }
            resolved += 1
        }
        return resolved
    }
}
