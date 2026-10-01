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
    fun epoch(): Long = synchronized(lock) { prefs.getLong(epochKey, 0) }

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
        write(summary)
        true
    }

    /** Only a server-acknowledged exact identity can terminalize cached rows. */
    fun terminalize(ids: Set<String>, state: String, transactionId: String = ""): Boolean = synchronized(lock) {
        val previous = read() ?: return@synchronized false
        val records = previous.records.map { row ->
            if (row.state == "pending" && (row.canonicalId in ids || row.id in ids || row.eventId in ids || row.eventIds.any { it in ids }))
                row.copy(state = state, transactionId = transactionId) else row
        }
        if (records == previous.records) return@synchronized false
        prefs.edit().putLong(epochKey, epoch() + 1).commit()
        write(previous.copy(totalCount = records.count { it.state == "pending" }, records = records))
        true
    }

    private fun write(summary: PendingReviewSummary) {
        val rows = JSONArray()
        summary.records.forEach { row -> rows.put(JSONObject()
            .put("kind", row.kind).put("id", row.id).put("event_id", row.eventId)
            .put("event_ids", JSONArray(row.eventIds.toList())).put("device_id", row.deviceId)
            .put("state", row.state).put("transaction_id", row.transactionId)
            .put("source_package", row.sourcePackage).put("app_label", row.appLabel)
            .put("amount_minor", row.amountMinor ?: JSONObject.NULL).put("direction", row.direction)
            .put("merchant", row.merchant).put("occurred_at_ms", row.occurredAtMs).put("confidence", row.confidence)) }
        prefs.edit().putString(key, JSONObject().put("observed_at", summary.observedAt)
            .put("total_count", summary.totalCount).put("records", rows).toString()).commit()
    }

    fun observation(): PaymentHintSync.Result? = read()?.let { summary ->
        PaymentHintSync.Result(summary.records.size, 0, 0, true, completeObservation = true,
            pendingCount = summary.totalCount,
            pendingEventIds = summary.records.filter { it.state == "pending" }.flatMap { it.eventIds }.toSet(),
            pendingRecords = summary.records.filter { it.state == "pending" })
    }

    companion object { private val locks = ConcurrentHashMap<String, Any>() }
}
