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
        val coordinator = AndroidPaymentRecognitionHook.get(context).coordinator()
        recover(context, accountId, deviceId, database, coordinator)
    }

    internal fun recover(context: Context, accountId: String, deviceId: String,
        database: NotificationDatabase, coordinator: PaymentRecognitionCoordinator) {
        val store = RoomPaymentRecognitionStore(database)
        val archive = RoomNotificationStore(database)
        var changed = false
        val ignored = CanonicalPendingCache(context, accountId).read()?.records.orEmpty()
            .filter { it.state in setOf("ignored", "rejected", "superseded", "expired") }.flatMap { it.eventIds }.toSet()
        for (record in database.paymentDao().unbookedRecognitions(accountId).map { it.toModel() }) {
            val exact = archive.structuredEventIdsForRecognition(accountId, record.sourceEventId).distinct()
            // Never guess between multiple archived events. Existing upload identity
            // wins only if the archive does not prove a different unique identity.
            if (exact.size > 1 && record.uploadEventId !in exact) {
                // A paid amount is not a transaction identity. Existing durable
                // bookings remain, but new ambiguous rows wait for exact proof.
                if (coordinator.autoBook(accountId, record.recognitionId, syncState = "identity_pending") != null) changed = true
                continue
            }
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
        for (booking in store.localBookings(accountId).filter { it.syncState == "identity_pending" }) {
            val recognition = store.recognition(accountId, booking.recognitionId) ?: continue
            val aliases = archive.structuredEventIdsForRecognition(accountId, recognition.sourceEventId).distinct()
            val revisions = aliases.mapNotNull { database.notificationDao().revisionForEventId(accountId, it) }
            if (revisions.any { (it.amountMinor > 0 && it.amountMinor != booking.amountMinor) ||
                    (it.direction in setOf("INCOME", "EXPENSE", "REFUND") && it.direction != booking.direction) }) continue
            val proofs = aliases.map { archive.archivedLifecycleIdentity(accountId, it) }.filter(String::isNotBlank).distinct()
            if (proofs.size != 1 || aliases.isEmpty()) continue
            // Existing hint reconciliation accepts exact archived lifecycle proof
            // and complete money, merges aliases and books once on the server.
            // It rejects conflicting evidence rather than guessing a new event.
            for (alias in aliases) queue.enqueueHint("hint:$alias", StructuredEventJson.hintPayload(
                deviceId = deviceId, sourceEventId = alias, sourceType = "notification",
                sourcePackage = booking.sourcePackage, appLabel = PaymentAppLabels.resolve(context, booking.sourcePackage),
                amountMinor = booking.amountMinor, direction = booking.direction, merchant = booking.merchant,
                currency = booking.currency, confidence = store.candidateForRecognition(accountId, booking.recognitionId)?.confidence ?: 0,
                recognitionStatus = if (recognition.completionConfirmed) "CONFIRMED_PAYMENT" else "PAYMENT_LIKELY",
                reasons = listOf("exact_archive_identity_recovery"),
                parserVersion = if (recognition.completionConfirmed) "payment-settled-4" else "payment-evidence-4",
                providerReference = booking.providerReference,
                paymentChannel = booking.paymentChannel, lifecycleIdentity = proofs.single(), occurredAtMs = booking.occurredAtMs,
            ))
        }
        val queued = queue.peekRequests().map { it.operationId }.toSet()
        for (booking in store.localBookings(accountId).filter { it.syncState == "pending" }) {
            val recognition = store.recognition(accountId, booking.recognitionId)
            val proven = recognition?.completionConfirmed == true
            if (proven && recognition?.financialPhase.isNullOrBlank()) {
                // A former candidate may already own this event's ingest receipt.
                // Persist the later settlement independently; retries must survive
                // process death and close that same canonical event, not fork it.
                queue.enqueueHint("hint:${booking.eventId}", StructuredEventJson.hintPayload(
                    deviceId = deviceId, sourceEventId = booking.eventId, sourceType = "notification",
                    sourcePackage = booking.sourcePackage, appLabel = PaymentAppLabels.resolve(context, booking.sourcePackage),
                    amountMinor = booking.amountMinor, direction = booking.direction, merchant = booking.merchant,
                    currency = booking.currency, confidence = store.candidateForRecognition(accountId, booking.recognitionId)?.confidence ?: 0,
                    recognitionStatus = "CONFIRMED_PAYMENT", reasons = listOf("durable_settlement_recovery"),
                    parserVersion = "payment-settled-4", providerReference = booking.providerReference,
                    paymentChannel = booking.paymentChannel, occurredAtMs = booking.occurredAtMs,
                ))
            }
            if (booking.eventId in queued) continue
            val event = StructuredNotificationEvent(
                eventId = booking.eventId,
                fingerprint = NotificationFingerprint.fingerprint(booking.sourcePackage, booking.eventId,
                    booking.direction, booking.amountMinor.toString(), booking.merchant),
                sourcePackage = booking.sourcePackage,
                eventType = if (booking.direction == "REFUND") NotificationEventType.REFUND else NotificationEventType.TRANSACTION,
                parserVersion = if (proven) "local-autobook-v2" else "local-autobook-legacy-review",
                parseStatus = if (proven) ParseStatus.PARSED else ParseStatus.CANDIDATE,
                direction = FinanceDirection.valueOf(booking.direction), amountMinor = booking.amountMinor,
                currency = booking.currency, merchant = booking.merchant, counterparty = booking.merchant,
                lifecycleOperation = recognition?.lifecycleOperation.orEmpty(), lifecycleRevision = recognition?.lifecycleRevision ?: 0,
                financialPhase = recognition?.financialPhase.orEmpty(), lifecycleReference = recognition?.lifecycleReference.orEmpty(),
                referenceNamespace = recognition?.referenceNamespace.orEmpty(), currencyEvidence = recognition?.currencyEvidence.orEmpty(),
                identityReviewReason = recognition?.identityReviewReason.orEmpty(),
                paymentChannel = booking.paymentChannel, providerReference = booking.providerReference,
                confidence = store.candidateForRecognition(accountId, booking.recognitionId)?.confidence?.coerceIn(0, 1000) ?: 0,
                occurredAtMs = booking.occurredAtMs, receivedAtMs = booking.occurredAtMs,
            )
            queue.enqueue(booking.eventId, StructuredEventJson.ingestPayload("1", deviceId, booking.eventId, event))
        }
    }

    /** Minimized account-scoped projection; no notification bodies, cookies or tokens. */
    fun snapshot(context: Context): String {
        val account = NotificationSessionProvider(context).currentAccount()
        if (account == null || !account.financeEntitled) return "null"
        val store = RoomPaymentRecognitionStore(NotificationDatabase.get(context))
        val archive = RoomNotificationStore(NotificationDatabase.get(context))
        val transactions = JSONArray()
        for (booking in store.localBookings(account.accountId)) {
            val aliases = store.recognition(account.accountId, booking.recognitionId)?.let {
                archive.structuredEventIdsForRecognition(account.accountId, it.sourceEventId)
            }.orEmpty() + store.eventAliases(account.accountId, booking.recognitionId).filterNot {
                it.startsWith("proof:") || it.startsWith("observation:") }.map { it.removePrefix("notification#event#") } + booking.eventId
            transactions.put(JSONObject()
            .put("event_ids", JSONArray(aliases.distinct()))
            .put("event_id", booking.eventId).put("sync_state", booking.syncState)
            .put("local_id", PaymentAutoBook.transactionId(booking.accountId, booking.eventId))
            .put("id", booking.transactionId).put("amount_minor", booking.amountMinor)
            .put("source_package", booking.sourcePackage).put("payment_channel", booking.paymentChannel)
            .put("direction", booking.direction.lowercase()).put("currency", booking.currency)
            .put("merchant", booking.merchant).put("occurred_at_ms", booking.occurredAtMs)
            .put("source_kind", "automatic").put("status", "active").put("reconciliation_state", "automatic"))
        }
        val reviews = JSONArray()
        for (record in store.recognitionsByState(account.accountId, PaymentVerificationCenter.ATTENTION_STATES, 5000)) {
            val candidate = store.candidateForRecognition(account.accountId, record.recognitionId)
            val amount = candidate?.effectiveAmountMinor ?: record.amountMinor
            val direction = candidate?.effectiveDirection?.takeIf(String::isNotBlank) ?: record.direction
            if (store.localBooking(account.accountId, PaymentAutoBook.eventId(record)) != null) continue
            val id = PaymentAutoBook.eventId(record)
            val aliases = (archive.structuredEventIdsForRecognition(account.accountId, record.sourceEventId) +
                store.eventAliases(account.accountId, record.recognitionId).filterNot { it.startsWith("proof:") || it.startsWith("observation:") }
                    .map { it.removePrefix("notification#event#") } + id)
                .filter(String::isNotBlank).distinct()
            reviews.put(JSONObject().put("id", id).put("event_id", id).put("event_ids", JSONArray(aliases))
                .put("state", "pending").put("kind", "hint").put("amount_minor", amount ?: JSONObject.NULL)
                .put("direction", direction.lowercase()).put("merchant", candidate?.effectiveMerchant ?: record.merchant)
                .put("source_package", record.sourcePackage).put("app_label", PaymentAppLabels.resolve(context, record.sourcePackage))
                .put("occurred_at_ms", candidate?.effectiveOccurredAtMs ?: record.createdAtMs).put("local_only", true))
        }
        return JSONObject().put("account_id", account.accountId).put("transactions", transactions).put("reviews", reviews).toString()
    }
}
