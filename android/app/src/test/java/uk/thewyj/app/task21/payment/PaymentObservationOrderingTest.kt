package uk.thewyj.app.task21.payment

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.core.network.PendingReviewIdentity
import uk.thewyj.app.core.network.PendingReviewSummary

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class PaymentObservationOrderingTest {
    private fun summary(amount: Long?, state: String = "pending") = PendingReviewSummary(
        "2026-10-16T01:00:00Z", if (state == "pending") 1 else 0, if (state == "pending") 1 else 0, 0, false,
        listOf(PendingReviewIdentity("hint", "review-order", "event-order", "synthetic-device",
            sourcePackage = "com.tencent.mm", appLabel = "微信", state = state, amountMinor = amount)))

    @Test fun sameEpochCannotCommitTwoDifferentObservationsAndRegress() {
        val cache = CanonicalPendingCache(RuntimeEnvironment.getApplication(), "order-same-epoch")
        val epoch = cache.epoch()
        assertTrue(cache.save(summary(123), epoch))
        assertFalse("a consumed observation token must reject its delayed duplicate", cache.save(summary(null), epoch))
        assertEquals(123L, cache.read()!!.records.single().amountMinor)
    }

    @Test fun laterRequestCannotReviveAcknowledgedTerminalIdentity() {
        val cache = CanonicalPendingCache(RuntimeEnvironment.getApplication(), "order-terminal")
        assertTrue(cache.save(summary(null)))
        assertTrue(cache.terminalize(setOf("event-order"), "ignored"))
        assertTrue(cache.save(summary(null)))
        assertEquals(0, cache.read()!!.totalCount)
        assertEquals("ignored", cache.read()!!.records.single().state)
    }

    @Test fun laterStartedRequestWinsWhenEarlierResponseArrivesLast() {
        val cache = CanonicalPendingCache(RuntimeEnvironment.getApplication(), "order-requests")
        val a = cache.beginObservation()
        val b = cache.beginObservation()
        assertTrue(cache.save(summary(123), b))
        assertFalse(cache.save(summary(null), a))
        assertEquals(123L, cache.read()!!.records.single().amountMinor)
    }

    @Test fun timedOutRequestDoesNotPreventLegitimateRetryAndOfflineCacheIsExplicit() {
        val cache = CanonicalPendingCache(RuntimeEnvironment.getApplication(), "order-timeout")
        cache.save(summary(123))
        val before = cache.observation()!!
        cache.beginObservation() // transport times out, no save
        val offline = cache.observation()!!
        assertTrue(offline.fromCache)
        assertEquals(before.observationVersion, offline.observationVersion)
        assertTrue(offline.observedAtMs > 0)
        val retry = cache.beginObservation()
        assertTrue(cache.save(summary(456), retry))
        assertEquals(456L, cache.observation()!!.pendingRecords.single().amountMinor)
    }

    @Test fun accountRequestSequencesAndCachedPayloadsAreIndependent() {
        val app = RuntimeEnvironment.getApplication()
        val a = CanonicalPendingCache(app, "order-account-a")
        val b = CanonicalPendingCache(app, "order-account-b")
        val request = a.beginObservation()
        b.save(summary(456), b.beginObservation())
        assertTrue(a.save(summary(123), request))
        assertEquals("order-account-a", a.observation()!!.accountId)
        assertEquals(123L, a.observation()!!.pendingRecords.single().amountMinor)
        assertEquals(456L, b.observation()!!.pendingRecords.single().amountMinor)
    }

    @Test fun partialObservationCannotReplaceCompleteCachedState() {
        val cache = CanonicalPendingCache(RuntimeEnvironment.getApplication(), "order-partial")
        cache.save(summary(123))
        assertFalse(cache.save(summary(null).copy(truncated = true), cache.beginObservation()))
        assertEquals(123L, cache.read()!!.records.single().amountMinor)
    }

    @Test fun terminalBeforeFirstObservationInvalidatesOldPullWithoutInventingEmptySummary() {
        val app = RuntimeEnvironment.getApplication()
        val cache = CanonicalPendingCache(app, "order-no-summary")
        val old = cache.beginObservation()
        assertTrue(cache.terminalize(setOf("event-order"), "ignored"))
        assertNull(cache.observation())
        assertFalse(cache.save(summary(null), old))
        val restarted = CanonicalPendingCache(app, "order-no-summary")
        assertTrue(restarted.save(summary(null), restarted.beginObservation()))
        assertEquals(0, restarted.read()!!.totalCount)
        assertEquals("ignored", restarted.read()!!.records.single().state)
        restarted.save(summary(null).copy(totalCount = 0, hintCount = 0, records = emptyList()), restarted.beginObservation())
        assertTrue(restarted.read()!!.records.isEmpty())
        assertEquals("ignored", restarted.observation()!!.observedStates["event-order"])
    }

    @Test fun terminalAliasProtectionKeepsReturnedCanonicalIdentity() {
        val cache = CanonicalPendingCache(RuntimeEnvironment.getApplication(), "order-terminal-alias")
        cache.save(summary(null));cache.terminalize(setOf("event-order"), "ignored")
        val aliased = summary(null).copy(records = listOf(summary(null).records.single().copy(
            id = "new-canonical-id", eventId = "new-alias", eventIds = setOf("event-order", "new-alias"))))
        cache.save(aliased, cache.beginObservation())
        assertEquals("new-canonical-id", cache.read()!!.records.single().id)
        assertEquals("ignored", cache.read()!!.records.single().state)
    }
}
