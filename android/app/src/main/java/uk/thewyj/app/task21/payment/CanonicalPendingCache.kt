package uk.thewyj.app.task21.payment

import android.content.Context
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONArray
import org.json.JSONObject
import uk.thewyj.app.core.network.PendingReviewIdentity
import uk.thewyj.app.core.network.PendingReviewSummary

/** Account-scoped cache of complete server summaries, never a union with Room. */
class CanonicalPendingCache(context: Context, private val accountId: String) {
    private val prefs = context.applicationContext.getSharedPreferences("canonical-payment-reviews-v1", Context.MODE_PRIVATE)
    private val lock = locks.computeIfAbsent(context.applicationContext.filesDir.absolutePath + "/" + accountId) { Any() }
    private val key = "summary/$accountId"
    private val epochKey = "epoch/$accountId"
    private val revisionKey = "revision/$accountId"
    private val savedAtKey = "saved-at/$accountId"
    private val closedKey = "closed/$accountId"
    private data class ClosedIdentity(val state: String, val transactionId: String)

    private fun identities(row: PendingReviewIdentity): Set<String> =
        (row.eventIds + row.eventId + row.canonicalId).filter(String::isNotBlank).toSet()

    /** Minimal durable tombstones, without keeping historical money or prose. */
    private fun closedIdentities(): MutableMap<String, ClosedIdentity> {
        val result = mutableMapOf<String, ClosedIdentity>()
        runCatching {
            val rows = JSONArray(prefs.getString(closedKey, "[]"))
            for (index in 0 until rows.length()) {
                val row = rows.getJSONObject(index)
                val id = row.optString("id")
                val state = row.optString("state")
                if (id.isNotBlank() && state in TERMINAL_STATES)
                    result[id] = ClosedIdentity(state, row.optString("transaction_id"))
            }
        }
        // Preserve acknowledgements from the older cache format on upgrade.
        read()?.records.orEmpty().filter { it.state in TERMINAL_STATES }.forEach { row ->
            identities(row).forEach { result.putIfAbsent(it, ClosedIdentity(row.state, row.transactionId)) }
        }
        return result
    }

    private fun encodeClosed(closed: Map<String, ClosedIdentity>): String = JSONArray().also { rows ->
        closed.forEach { (id, value) -> rows.put(JSONObject().put("id", id)
            .put("state", value.state).put("transaction_id", value.transactionId)) }
    }.toString()
    fun epoch(): Long = synchronized(lock) { prefs.getLong(epochKey, 0) }
    fun revision(): Long = synchronized(lock) { prefs.getLong(revisionKey, 0) }

    /** Allocate BEFORE transport. A newer request invalidates every older one. */
    fun beginObservation(): Long = synchronized(lock) {
        (epoch() + 1).also { prefs.edit().putLong(epochKey, it).commit() }
    }

    fun read(): PendingReviewSummary? = synchronized(lock) {
        runCatching {
            val data = JSONObject(prefs.getString(key, "") ?: "")
            val rows = data.getJSONArray("records")
            val records = (0 until rows.length()).mapNotNull { PendingReviewIdentity.fromJson(rows.getJSONObject(it)) }
            val total = data.getInt("total_count")
            if (records.count { it.state == "pending" } != total) return@synchronized null
            PendingReviewSummary(data.optString("observed_at"), total,
                records.count { it.state == "pending" && it.kind == "hint" },
                records.count { it.state == "pending" && it.kind == "candidate" }, false, records)
        }.getOrNull()
    }

    fun save(summary: PendingReviewSummary, expectedEpoch: Long = epoch()): Boolean = synchronized(lock) {
        if (epoch() != expectedEpoch || summary.truncated ||
            summary.records.count { it.state == "pending" } != summary.totalCount) return@synchronized false
        // A server acknowledgement is stronger than a later stale pending
        // response. Keep its exact aliases, without inventing a local terminal.
        val closed = closedIdentities()
        summary.records.filter { it.state in TERMINAL_STATES }.forEach { row ->
            identities(row).forEach { closed[it] = ClosedIdentity(row.state, row.transactionId) }
        }
        val records = summary.records.map { row ->
            val terminal = identities(row).firstNotNullOfOrNull { closed[it] }
            val accepted = if (row.state == "pending" && terminal != null)
                row.copy(state = terminal.state, transactionId = terminal.transactionId) else row
            if (accepted.state in TERMINAL_STATES)
                identities(accepted).forEach { closed[it] = ClosedIdentity(accepted.state, accepted.transactionId) }
            accepted
        }
        val accepted = summary.copy(records = records,
            totalCount = records.count { it.state == "pending" },
            hintCount = records.count { it.state == "pending" && it.kind == "hint" },
            candidateCount = records.count { it.state == "pending" && it.kind == "candidate" })
        // Consume the token as well: two saves with the same old epoch cannot
        // both commit. Network retries allocate a new token, never reuse one.
        write(accepted, epoch() + 1, System.currentTimeMillis(), closed)
        true
    }

    /** Only a server-acknowledged exact identity can terminalize cached rows. */
    fun terminalize(ids: Set<String>, state: String, transactionId: String = ""): Boolean = synchronized(lock) {
        if (state !in TERMINAL_STATES || ids.none(String::isNotBlank)) return@synchronized false
        val previous = read()
        val closed = closedIdentities()
        val before = closed.toMap()
        ids.filter(String::isNotBlank).forEach { closed[it] = ClosedIdentity(state, transactionId) }
        val records = previous?.records.orEmpty().map { row ->
            if (row.state == "pending" && (row.canonicalId in ids || row.id in ids || row.eventId in ids || row.eventIds.any { it in ids }))
                row.copy(state = state, transactionId = transactionId).also { terminal ->
                    identities(terminal).forEach { closed[it] = ClosedIdentity(state, transactionId) }
                } else row
        }
        if (closed == before && records == previous?.records.orEmpty()) return@synchronized false
        if (previous != null) {
            write(previous.copy(totalCount = records.count { it.state == "pending" }, records = records),
                epoch() + 1, prefs.getLong(savedAtKey, 0), closed)
        } else {
            // An acknowledgement can precede the first summary. Invalidate old
            // requests, but do not fabricate a complete empty cloud observation.
            val next = epoch() + 1
            prefs.edit().putLong(epochKey, next).putLong(revisionKey, next)
                .putString(closedKey, encodeClosed(closed)).commit()
        }
        true
    }

    private fun write(summary: PendingReviewSummary, revision: Long, savedAt: Long, closed: Map<String, ClosedIdentity>) {
        val rows = JSONArray()
        summary.records.forEach { row -> rows.put(JSONObject()
            .put("kind", row.kind).put("id", row.id).put("event_id", row.eventId)
            .put("event_ids", JSONArray(row.eventIds.toList())).put("device_id", row.deviceId)
            .put("state", row.state).put("transaction_id", row.transactionId)
            .put("source_package", row.sourcePackage).put("app_label", row.appLabel)
            .put("amount_minor", row.amountMinor ?: JSONObject.NULL).put("currency", row.currency).put("amount_exponent", row.amountExponent ?: JSONObject.NULL).put("direction", row.direction)
            .put("merchant", row.merchant).put("occurred_at_ms", row.occurredAtMs).put("confidence", row.confidence)) }
        prefs.edit().putLong(epochKey, revision).putLong(revisionKey, revision).putLong(savedAtKey, savedAt)
            .putString(closedKey, encodeClosed(closed))
            .putString(key, JSONObject().put("observed_at", summary.observedAt)
            .put("total_count", summary.totalCount).put("records", rows).toString()).commit()
    }

    fun observation(): PaymentHintSync.Result? = snapshot()?.second

    /** Payload and revision must come from the same locked read. */
    fun snapshot(): Pair<PendingReviewSummary, PaymentHintSync.Result>? = synchronized(lock) { read()?.let { summary ->
        summary to PaymentHintSync.Result(summary.records.size, 0, 0, true, completeObservation = true,
            accountId = accountId, observationVersion = revision(), observedAtMs = prefs.getLong(savedAtKey, 0), fromCache = true,
            observedStates = summary.records.flatMap { row -> identities(row).map { it to row.state } }.toMap() +
                closedIdentities().mapValues { it.value.state },
            pendingCount = summary.totalCount,
            pendingEventIds = summary.records.filter { it.state == "pending" }.flatMap { it.eventIds }.toSet(),
            pendingRecords = summary.records.filter { it.state == "pending" })
    } }

    companion object {
        private val locks = ConcurrentHashMap<String, Any>()
        private val TERMINAL_STATES = setOf("confirmed", "ignored", "rejected", "superseded", "expired", "deleted")
    }
}
