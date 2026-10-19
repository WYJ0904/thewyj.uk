package uk.thewyj.app.task21.payment

import org.json.JSONArray
import org.json.JSONObject
import uk.thewyj.app.task21.OfflineNotificationQueue
import uk.thewyj.app.task21.store.*
import java.security.MessageDigest
import java.util.concurrent.Callable

/** Implemented only after a real provider's account/reference/version semantics
 * have been verified. Authentication or a high parser score is insufficient. */
internal fun interface PaymentAuthorityVerifier {
    fun verify(accountId: String, command: String, immutableLocalSnapshot: String): Boolean
}

/** Durable reconciliation uses the existing outbox. It never changes money
 * before an exact, committed cloud receipt has passed the local CAS check. */
internal class PaymentReconciliation(
    private val db: NotificationDatabase,
    private val authority: PaymentAuthorityVerifier = PaymentAuthorityVerifier { _, _, _ -> false },
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val dao get() = db.reconciliationDao()
    private val payments get() = db.paymentDao()
    private fun <T> atomic(block: () -> T): T = db.runInTransaction(Callable { block() })

    fun stage(account: String, device: String, commandText: String): Boolean = atomic {
        val command = JSONObject(commandText)
        validate(command)
        val op = command.getString("operation_id")
        val digest = digest(command)
        val old = dao.journal(account, op)
        require(old == null || old.payloadDigest == digest) { "operation_id_conflict" }
        if (old?.state == "applied") return@atomic true
        val snapshot = snapshot(account, command)
        val reason = localReason(account, command, snapshot).ifBlank {
            if (authority.verify(account, canonical(command), canonical(snapshot))) "" else "provider_semantics_unverified"
        }
        val body = JSONObject().put("schema_version", 1).put("device_id", device).put("operations", JSONArray().put(command))
        dao.saveJournal(PaymentReconciliationEntity(account, op, digest, body.toString(), if (reason.isBlank()) "staged" else "blocked",
            reason, snapshot.toString(), "{}", old?.createdAtMs ?: now(), now()))
        reason.isBlank()
    }

    /** Rebuild any queue write lost between the Room commit and atomic disk save. */
    fun recover(account: String, queue: OfflineNotificationQueue) {
        for (row in dao.staged(account)) queue.enqueue(row.operationId, row.payloadJson)
    }

    fun applyReceipt(account: String, operationId: String, response: JSONObject): Boolean = atomic {
        val row = dao.journal(account, operationId) ?: return@atomic false
        val result = response.optJSONArray("operation_results")?.optJSONObject(0) ?: return@atomic false
        if (result.optString("account_id") != account || result.optString("operation_id") != operationId || result.optString("payload_digest") != row.payloadDigest ||
            result.optString("reconciliation_status") != "applied") return@atomic false
        if (row.state == "applied") return@atomic true // Never reapply an old receipt over a newer operation.
        if (row.state != "staged") return@atomic false
        val command = JSONObject(row.payloadJson).getJSONArray("operations").getJSONObject(0)
        val current = snapshot(account, command)
        if (canonical(current) != canonical(JSONObject(row.beforeJson)) || localReason(account, command, current).isNotBlank()) {
            dao.saveJournal(row.copy(state = "conflict", reason = "local_state_changed_after_stage", resultJson = result.toString(), updatedAtMs = now()))
            return@atomic false
        }
        val p = command.getJSONObject("payload")
        val reversing = p.getString("kind") == "REVOKE"
        if (canonical(result.getJSONArray("target_event_ids")) != canonical(p.getJSONArray("target_event_ids")) ||
            canonical(result.getJSONArray("detach_event_ids")) != canonical(p.getJSONArray("detach_event_ids")) ||
            result.getString("evidence_event_id") != p.getString("evidence_event_id")) return@atomic false
        val effective = result.getJSONObject("effective")
        val tx = result.getJSONObject("transaction")
        val transactionId = result.getString("transaction_id")
        if (tx.getString("id") != transactionId || tx.optString("status") != "active" ||
            tx.getLong("revision") != (if (reversing) 1L else p.getLong("expected_transaction_revision") + 1) ||
            tx.getLong("amount_minor") != effective.getLong("amount_minor") ||
            tx.getString("currency") != effective.getString("currency") || tx.getString("direction") != effective.getString("direction")) return@atomic false
        val evidence = rawForEvent(account, p.getString("evidence_event_id")) ?: return@atomic false
        if (evidence.amountMinor != effective.getLong("amount_minor") || evidence.currency != effective.getString("currency") ||
            evidence.direction.lowercase() != effective.getString("direction") || evidence.lifecycleRevision != effective.getLong("lifecycle_revision") ||
            evidence.lifecycleReference != effective.getString("lifecycle_reference") || evidence.providerReference != effective.getString("provider_reference") ||
            evidence.referenceNamespace != effective.getString("reference_namespace") ||
            evidence.financialPhase != effective.getString("financial_phase") || evidence.lifecycleOperation != effective.getString("lifecycle_operation")) return@atomic false
        val canonicalRecord = rawForEvent(account, result.getString("canonical_event_id")) ?: return@atomic false
        val prior = payments.localBookings(account).filter { it.recognitionId in (targetRecords(account, command) + evidence).map { r -> r.recognitionId } }
        if (prior.map { it.transactionId }.distinct().size > 1 ||
            (!reversing && prior.any { it.transactionId != transactionId }) ||
            (reversing && (prior.size != 1 || prior[0].transactionId != result.optString("original_transaction_id") || prior[0].transactionId == transactionId))) return@atomic false
        val oldBooking = if (reversing) null else prior.singleOrNull()
        if (prior.size > 1) return@atomic false
        val canonicalEventId = PaymentAutoBook.eventId(canonicalRecord)
        if (oldBooking != null && oldBooking.eventId != canonicalEventId) return@atomic false
        val booking = oldBooking?.copy(amountMinor = effective.getLong("amount_minor"), syncState = "synced") ?: LocalPaymentBookingEntity(
            account, canonicalEventId, canonicalRecord.recognitionId, transactionId, effective.getLong("amount_minor"), evidence.direction,
            evidence.currency, tx.optString("merchant"), tx.getLong("occurred_at_ms"), evidence.sourcePackage, evidence.paymentChannel,
            evidence.providerReference, "synced", now())
        if (oldBooking == null) payments.insertLocalBooking(booking) else dao.updateBooking(booking)
        val detached = strings(p.getJSONArray("detach_event_ids")).toSet()
        val mergeRecords = (targetRecords(account, command) + evidence).distinctBy { it.recognitionId }
        for (record in mergeRecords) {
            if (reversing && record.recognitionId != evidence.recognitionId) {
                val old = requireNotNull(RoomPaymentRecognitionStore(db).recognition(account, record.recognitionId))
                dao.saveEffective(PaymentEffectiveRecognitionEntity(account, record.recognitionId, old.recognitionId,
                    requireNotNull(old.amountMinor), old.financialPhase, old.lifecycleOperation,
                    effective.getLong("lifecycle_revision"), old.lifecycleReference, old.providerReference, old.referenceNamespace, operationId, 0))
                continue
            }
            val excluded = if (PaymentAutoBook.eventId(record) in detached) 1 else 0
            dao.saveEffective(PaymentEffectiveRecognitionEntity(account, record.recognitionId, canonicalRecord.recognitionId,
                effective.getLong("amount_minor"), effective.getString("financial_phase"), effective.getString("lifecycle_operation"),
                effective.getLong("lifecycle_revision"), effective.getString("lifecycle_reference"), effective.getString("provider_reference"),
                effective.getString("reference_namespace"), operationId, excluded))
            payments.candidateForRecognition(account, record.recognitionId)?.let {
                payments.upsertCandidate(it.copy(status = if (excluded == 1) "pending" else "confirmed", financeTransactionId = if (excluded == 1) "" else transactionId, updatedAtMs = now()))
            }
            if (record.recognitionId != canonicalRecord.recognitionId && excluded == 0)
                payments.upsertRecognition(record.copy(state = "FINANCE_CORRECTED").toEntity())
        }
        for (eventId in strings(p.getJSONArray("target_event_ids")) + evidence.uploadEventId) {
            dao.saveAlias(PaymentReconciliationAliasEntity(account,eventId,if (reversing && eventId != evidence.uploadEventId) requireNotNull(rawForEvent(account,eventId)).recognitionId else canonicalRecord.recognitionId,0,operationId))
            db.notificationDao().markFinanceOutcomeByEventId(account,eventId,"confirmed",if(reversing&&eventId!=evidence.uploadEventId)result.getString("original_transaction_id") else transactionId)
        }
        for (eventId in detached) {
            val original = requireNotNull(rawForEvent(account,eventId))
            val detachedId = "rec-detached-" + digest(JSONObject().put("account",account).put("event",eventId)).take(40)
            val review = original.copy(recognitionId=detachedId,state="FINANCE_PENDING_CONFIRMATION",sourceEventId="notification#event#$eventId",
                uploadEventId=eventId,identityReviewReason="reconciliation_detached",financialPhase="REVIEW_REQUIRED",lifecycleOperation="",lifecycleRevision=0)
            payments.upsertRecognition(review.toEntity())
            payments.upsertCandidate(PaymentCandidate("cand-detached-"+detachedId,account,detachedId,"pending",review.amountMinor,review.direction,"",
                review.merchant,review.createdAtMs,review.paymentChannel,0,"reconciliation_detached",createdAtMs=now(),updatedAtMs=now()).toEntity())
            dao.saveAlias(PaymentReconciliationAliasEntity(account,eventId,detachedId,1,operationId))
            db.notificationDao().markFinanceOutcomeByEventId(account,eventId,"candidate","")
        }
        dao.saveJournal(row.copy(state = "applied", reason = "", resultJson = result.toString(), updatedAtMs = now()))
        true
    }

    private fun localReason(account: String, command: JSONObject, snapshot: JSONObject): String {
        val p = command.getJSONObject("payload")
        val records = allRecords(account, command)
        val ids = strings(p.getJSONArray("target_event_ids")) + strings(p.getJSONArray("detach_event_ids")) + p.getString("evidence_event_id")
        if (records.size != ids.size) return "reconciliation_source_missing_or_ambiguous"
        if (strings(p.getJSONArray("detach_event_ids")).any { payments.localBooking(account,it)!=null }) return "detach_requires_alias_proof"
        if (records.any { it.state=="FINANCE_MANUALLY_CONFIRMED" || dao.hasDecision(account, it.recognitionId) > 0 || payments.candidateForRecognition(account, it.recognitionId)?.let { c -> c.status == "rejected" || c.toModel().hasEdits } == true }) return "user_decision_conflict"
        val evidence = rawForEvent(account, p.getString("evidence_event_id")) ?: return "reconciliation_source_missing"
        val reversing = p.getString("kind") == "REVOKE"
        if (!evidence.completionConfirmed && evidence.identityReviewReason !in setOf("lifecycle_revision_requires_reconciliation", "reconciliation_evidence") && p.getString("kind") != "REVOKE") return "completed_operation_unproven"
        if (evidence.currencyEvidence != evidence.currency || records.any { it.currency != evidence.currency || (!reversing && it.direction != evidence.direction) }) return "currency_or_direction_conflict"
        if (records.any { PaymentEventSafety.namespace(it.sourcePackage, it.paymentChannel) != evidence.referenceNamespace ||
                (it.sourceUid != null && evidence.sourceUid != null && it.sourceUid != evidence.sourceUid) }) return "provider_or_instance_conflict"
        if (targetRecords(account, command).any { (dao.effective(account, it.recognitionId)?.lifecycleRevision ?: it.lifecycleRevision) != p.getLong("predecessor_revision") } ||
            evidence.lifecycleRevision != p.getLong("predecessor_revision") + 1) return "stale_or_missing_predecessor"
        val targetIds = (targetRecords(account, command) + evidence).map { it.recognitionId }
        val bookings = payments.localBookings(account).filter { it.recognitionId in targetIds }
        if (bookings.size > 1) return "multiple_formal_transactions"
        val previous = p.optString("predecessor_operation_id")
        if (p.getLong("expected_transaction_revision") > 1) {
            val r = dao.journal(account, previous)
            if (r?.state != "applied" || JSONObject(r.resultJson).getJSONObject("transaction").getLong("revision") != p.getLong("expected_transaction_revision")) return "user_ledger_revision_conflict"
        }
        if (snapshot.getJSONArray("records").length() != ids.size) return "reconciliation_source_missing"
        return ""
    }

    private fun rawForEvent(account: String, event: String): PaymentRecognitionRecord? {
        dao.alias(account,event)?.let { return payments.recognition(account,it.canonicalRecognitionId)?.toModel() }
        val matches = mutableListOf<String>()
        db.openHelper.readableDatabase.query("SELECT DISTINCT r.recognitionId FROM payment_recognitions r LEFT JOIN payment_event_aliases a ON a.accountId=r.accountId AND a.recognitionId=r.recognitionId WHERE r.accountId=? AND (r.uploadEventId=? OR r.sourceEventId=? OR a.sourceEventId=? OR a.sourceEventId=?)",
            arrayOf(account, event, event, event, "notification#event#$event")).use { c -> while (c.moveToNext()) matches += c.getString(0) }
        return matches.singleOrNull()?.let { payments.recognition(account, it)?.toModel() }
    }
    private fun targetRecords(account: String, command: JSONObject) = strings(command.getJSONObject("payload").getJSONArray("target_event_ids")).mapNotNull { rawForEvent(account, it) }
    private fun allRecords(account: String, command: JSONObject): List<PaymentRecognitionRecord> {
        val p = command.getJSONObject("payload")
        return (strings(p.getJSONArray("target_event_ids")) + strings(p.getJSONArray("detach_event_ids")) + p.getString("evidence_event_id")).mapNotNull { rawForEvent(account, it) }
    }
    private fun snapshot(account: String, command: JSONObject): JSONObject {
        val array = JSONArray()
        for (r in allRecords(account, command)) {
            val effective = dao.effective(account, r.recognitionId)
            val candidate = payments.candidateForRecognition(account, r.recognitionId)
            val booking = payments.localBookings(account).filter { it.recognitionId == r.recognitionId }
            // An ACK can advance transport state/timestamps while the staged
            // command waits. Compare money, IDs, evidence, edits and decisions;
            // a same-ID pending->synced ACK is not a new financial decision.
            val moneyBookings = booking.map { it.copy(syncState = if (it.syncState in setOf("pending", "synced", "identity_pending")) "transport" else it.syncState) }
            array.put(JSONObject().put("recognition", r.copy(state = "operational", updatedAtMs = 0L).toString()).put("effective", effective?.toString() ?: "")
                .put("candidate", candidate?.copy(updatedAtMs = 0L)?.toString() ?: "").put("bookings", moneyBookings.toString())
                .put("decision", dao.hasDecision(account, r.recognitionId)))
        }
        return JSONObject().put("account_id", account).put("records", array)
    }

    companion object {
        private val id = Regex("^[A-Za-z0-9._:-]{8,80}$")
        fun isRequest(body: String): Boolean = runCatching { JSONObject(body).optJSONArray("operations")?.optJSONObject(0)?.optString("type") == "payment.reconcile" }.getOrDefault(false)
        fun digest(command: JSONObject): String = MessageDigest.getInstance("SHA-256").digest(canonical(command).toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        fun canonical(value: Any?): String = when (value) {
            is JSONObject -> value.keys().asSequence().sorted().joinToString(",", "{", "}") { JSONObject.quote(it) + ":" + canonical(value.get(it)) }
            is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.get(it)) }
            null, JSONObject.NULL -> "null"
            is String -> JSONObject.quote(value)
            else -> value.toString()
        }
        private fun strings(a: JSONArray) = (0 until a.length()).map { a.getString(it) }
        private fun validate(command: JSONObject) {
            require(command.keys().asSequence().toSet() == setOf("operation_id", "type", "payload"))
            require(id.matches(command.getString("operation_id")) && command.getString("type") == "payment.reconcile")
            val p = command.getJSONObject("payload")
            require(p.keys().asSequence().toSet() == setOf("kind", "evidence_event_id", "target_event_ids", "detach_event_ids", "predecessor_operation_id", "predecessor_revision", "expected_transaction_revision", "proof_id"))
            require(p.getString("kind") in setOf("REPLACE", "MAP", "REASSIGN", "REVOKE"))
            require(listOf("evidence_event_id", "proof_id").all { id.matches(p.getString(it)) })
            val targets = strings(p.getJSONArray("target_event_ids")); val detached = strings(p.getJSONArray("detach_event_ids"))
            require(targets.isNotEmpty() && targets.size <= 8 && detached.size <= 8 && (targets + detached).all { id.matches(it) })
            require((targets + detached + p.getString("evidence_event_id")).distinct().size == targets.size + detached.size + 1)
            require(p.getLong("predecessor_revision") >= 0 && p.getLong("expected_transaction_revision") >= 0)
        }
    }
}
