package uk.thewyj.app.core.network

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingReviewCompatibilityTest {
    @Test fun canonicalSummaryRecordKeepsSafeDisplayFieldsAndExactAliases() {
        val row = PendingReviewIdentity.fromJson(JSONObject(
            """{"kind":"hint","id":"hint-wechat","event_id":"evt-first", "event_ids":["evt-first","evt-update"],"device_id":"device-a","state":"pending","source_package":"com.tencent.mm","app_label":"微信","amount_minor":10200,"direction":null,"merchant":"","occurred_at_ms":1789000000000,"confidence":720}""",
        ))!!
        assertEquals("hint:hint-wechat", row.canonicalId)
        assertEquals(setOf("evt-first", "evt-update"), row.eventIds)
        assertEquals("com.tencent.mm", row.sourcePackage)
        assertEquals("微信", row.appLabel)
        assertEquals(10_200L, row.amountMinor)
        assertEquals("", row.direction)
        assertEquals("", row.merchant)
        assertEquals(1_789_000_000_000L, row.occurredAtMs)
        assertEquals(720, row.confidence)
    }

    @Test fun legacyProductionEndpointsComposePendingAndTerminalIdentities() {
        val result = PendingReviewCompatibility.fromLegacy(
            hintPending = JSONObject(
                """{"hints":[{"id":"hint-p","source_event_id":"evt-h-p","device_id":"d1","state":"pending"}]}""",
            ),
            hintAll = JSONObject(
                """{"hints":[{"id":"hint-p","source_event_id":"evt-h-p","device_id":"d1","state":"pending"},{"id":"hint-i","source_event_id":"evt-h-i","device_id":"d1","state":"ignored"}]}""",
            ),
            candidatePending = JSONObject(
                """{"candidates":[{"id":"cand-p","event_id":"evt-c-p","status":"pending","evidence":[{"event_id":"evt-c-p"}]}]}""",
            ),
            candidateConfirmed = JSONObject(
                """{"candidates":[{"id":"cand-c","event_id":"evt-c-c","status":"confirmed","finance_transaction_id":"txn-1","evidence":[{"event_id":"evt-c-c"},{"event_id":"evt-c-alias"}]}]}""",
            ),
            candidateRejected = JSONObject("""{"candidates":[]}"""),
            requested = setOf("evt-h-i", "evt-c-alias"),
        )

        assertTrue(result is ApiCall.Success)
        val summary = (result as ApiCall.Success).value
        assertEquals(2, summary.totalCount)
        assertEquals(1, summary.hintCount)
        assertEquals(1, summary.candidateCount)
        assertFalse(summary.truncated)
        assertTrue(summary.records.any { it.id == "hint-i" && it.state == "ignored" })
        assertTrue(summary.records.any {
            it.id == "cand-c" && it.state == "confirmed" &&
                it.transactionId == "txn-1" && "evt-c-alias" in it.eventIds
        })
    }

    @Test fun legacyObservationWithoutLocalIdsOnlyReturnsActionableRows() {
        val result = PendingReviewCompatibility.fromLegacy(
            hintPending = JSONObject("""{"hints":[]}"""),
            hintAll = null,
            candidatePending = JSONObject(
                """{"candidates":[{"id":"cand-p","event_id":"evt-p","status":"pending","evidence":[]}]}""",
            ),
            candidateConfirmed = null,
            candidateRejected = null,
            requested = emptySet(),
        )

        val summary = (result as ApiCall.Success).value
        assertEquals(1, summary.totalCount)
        assertEquals(listOf("pending"), summary.records.map { it.state })
    }
}
