package uk.thewyj.app.task21.payment

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import uk.thewyj.app.task21.*
import uk.thewyj.app.task21.store.*

/** Durable outbox recovery. Never needs a network response to finish local booking. */
object LocalPaymentLedger {
    fun recover(context: Context, accountId: String, deviceId: String) {
        val database = NotificationDatabase.get(context)
        val store = RoomPaymentRecognitionStore(database)
        val archive = RoomNotificationStore(database)
        val coordinator = AndroidPaymentRecognitionHook.get(context).coordinator()
        var changed = false
        val ignored = CanonicalPendingCache(context, accountId).read()?.records.orEmpty()
            .filter { it.state in setOf("ignored", "rejected", "superseded", "expired") }.flatMap { it.eventIds }.toSet()
        for (record in database.paymentDao().unbookedRecognitions(accountId).map { it.toModel() }) {
            val exact = archive.structuredEventIdsForRecognition(accountId, record.sourceEventId).distinct()
            // Never guess between multiple archived events. Existing upload identity
            // wins only if the archive does not prove a different unique identity.
            if (exact.size > 1 && record.uploadEventId !in exact) continue
            val id = exact.singleOrNull() ?: record.uploadEventId
            if (id in ignored) continue
            if (id.isNotBlank() && id != record.uploadEventId) store.saveRecognition(record.copy(uploadEventId = id))
            val instance = id.takeIf(String::isNotBlank)?.let { eventId ->
                database.notificationDao().instanceIdForEventId(accountId, eventId)
                    ?.let { database.notificationDao().instance(accountId, it) }
            }
            // The archive can already own a real receipt even when the legacy
            // recognition failed to link to it. Reuse it before any new outbox work.
            if (instance?.financeState == "confirmed" && instance.financeTransactionId.isNotBlank()) {
                store.candidateForRecognition(accountId, record.recognitionId)?.let {
                    store.saveCandidate(it.copy(financeTransactionId = instance.financeTransactionId))
                }
            }
            val receipt = instance?.takeIf { it.financeState == "confirmed" }?.financeTransactionId.orEmpty()
            if (coordinator.autoBook(accountId, record.recognitionId, receipt) != null) changed = true
        }
        if (changed) PaymentReviewSignals.publish()
        val queue = NotificationOfflineQueue.inDirectory(context.filesDir, accountId)
        val queued = queue.peekRequests().map { it.operationId }.toSet()
        for (booking in store.localBookings(accountId).filter { it.syncState != "synced" }) {
            if (booking.eventId in queued) continue
            val event = StructuredNotificationEvent(
                eventId = booking.eventId,
                fingerprint = NotificationFingerprint.fingerprint(booking.sourcePackage, booking.eventId,
                    booking.direction, booking.amountMinor.toString(), booking.merchant),
                sourcePackage = booking.sourcePackage,
                eventType = if (booking.direction == "REFUND") NotificationEventType.REFUND else NotificationEventType.TRANSACTION,
                parserVersion = "local-autobook-v1", parseStatus = ParseStatus.PARSED,
                direction = FinanceDirection.valueOf(booking.direction), amountMinor = booking.amountMinor,
                currency = booking.currency, merchant = booking.merchant, counterparty = booking.merchant,
                paymentChannel = booking.paymentChannel, providerReference = booking.providerReference,
                confidence = 950, occurredAtMs = booking.occurredAtMs, receivedAtMs = booking.occurredAtMs,
            )
            queue.enqueue(booking.eventId, StructuredEventJson.ingestPayload("1", deviceId, booking.eventId, event))
        }
    }

    /** Minimized account-scoped projection; no notification bodies, cookies or tokens. */
    fun snapshot(context: Context): String {
        val account = NotificationSessionProvider(context).currentAccount()
        if (account == null || !account.financeEntitled) return "null"
        val store = RoomPaymentRecognitionStore(NotificationDatabase.get(context))
        val transactions = JSONArray()
        for (booking in store.localBookings(account.accountId)) transactions.put(JSONObject()
            .put("event_id", booking.eventId).put("sync_state", booking.syncState)
            .put("local_id", PaymentAutoBook.transactionId(booking.accountId, booking.eventId))
            .put("id", booking.transactionId).put("amount_minor", booking.amountMinor)
            .put("direction", booking.direction.lowercase()).put("currency", booking.currency)
            .put("merchant", booking.merchant).put("occurred_at_ms", booking.occurredAtMs)
            .put("source_kind", "automatic").put("status", "active").put("reconciliation_state", "automatic"))
        val reviews = JSONArray()
        for (record in store.recognitionsByState(account.accountId, PaymentVerificationCenter.ATTENTION_STATES, 5000)) {
            val candidate = store.candidateForRecognition(account.accountId, record.recognitionId)
            val amount = candidate?.effectiveAmountMinor ?: record.amountMinor
            val direction = candidate?.effectiveDirection?.takeIf(String::isNotBlank) ?: record.direction
            if (PaymentAutoBook.eligible(amount, direction)) continue
            val id = PaymentAutoBook.eventId(record)
            reviews.put(JSONObject().put("id", id).put("event_id", id).put("event_ids", JSONArray().put(id))
                .put("state", "pending").put("kind", "hint").put("amount_minor", amount ?: JSONObject.NULL)
                .put("direction", direction.lowercase()).put("merchant", candidate?.effectiveMerchant ?: record.merchant)
                .put("source_package", record.sourcePackage).put("app_label", PaymentAppLabels.resolve(context, record.sourcePackage))
                .put("occurred_at_ms", candidate?.effectiveOccurredAtMs ?: record.createdAtMs).put("local_only", true))
        }
        return JSONObject().put("account_id", account.accountId).put("transactions", transactions).put("reviews", reviews).toString()
    }
}
