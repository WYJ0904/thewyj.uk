package uk.thewyj.app.task21.payment

import androidx.room.Room
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.core.network.PendingReviewIdentity
import uk.thewyj.app.core.network.PendingReviewSummary
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomNotificationStore
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore
import uk.thewyj.app.ui.PaymentVerificationState

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class CanonicalPendingCacheTest {
    private fun nine() = PendingReviewSummary("2026-09-30T08:00:00Z", 9, 9, 0, false,
        (1..9).map { PendingReviewIdentity("hint", "hint-cache-$it", "event-cache-$it", "device-a",
            sourcePackage = "com.tencent.mm", appLabel = "微信", occurredAtMs = 1_789_000_000_000L + it) })

    @Test fun restartedScreenPaintsNineServerRecordsWithNoLocalRecognition() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val account = "cache-nine-account"
        assertTrue(CanonicalPendingCache(app, account).save(nine()))
        val db = Room.inMemoryDatabaseBuilder(app, NotificationDatabase::class.java).allowMainThreadQueries().build()
        try {
            val center = PaymentVerificationCenter(app, hintedStore = RoomPaymentRecognitionStore(db),
                hintedArchive = RoomNotificationStore(db), hintedQueuedRequests = { emptyList() })
            val state = PaymentVerificationState(app, account, center)
            state.refresh()
            assertEquals(9, state.items.count { !it.recoveryOnly })
            assertEquals(nine().records.map { it.canonicalId }.toSet(), state.items.map { it.canonicalIdentity }.toSet())
            assertTrue(state.canonicalObserved)
            assertFalse(state.canonicalCurrent)
            assertNull(CanonicalPendingCache(app, "another-account").read())
        } finally { db.close() }
    }

    @Test fun terminalAckRejectsOlderSnapshotAndSurvivesRestart() {
        val app = RuntimeEnvironment.getApplication()
        val cache = CanonicalPendingCache(app, "cache-terminal-account")
        assertTrue(cache.save(nine()))
        val started = cache.epoch()
        assertTrue(cache.terminalize(setOf("event-cache-1"), "confirmed", "transaction-one"))
        assertFalse(cache.save(nine(), started))
        val restarted = CanonicalPendingCache(app, "cache-terminal-account")
        assertEquals(8, restarted.read()!!.totalCount)
        assertEquals("confirmed", restarted.read()!!.records.first().state)
        assertEquals("transaction-one", restarted.read()!!.records.first().transactionId)
    }

    @Test fun cachedCloudAmountMissingDoesNotHideLocallyVerifiedOneCent() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val account = "cache-cent-account"
        val summary = nine().copy(totalCount = 1, hintCount = 1, records = listOf(nine().records.first()))
        CanonicalPendingCache(app, account).save(summary)
        val db = Room.inMemoryDatabaseBuilder(app, NotificationDatabase::class.java).allowMainThreadQueries().build()
        try {
            val store = RoomPaymentRecognitionStore(db)
            store.saveRecognition(PaymentRecognitionRecord("rec-cache-cent", account,
                PaymentRecognitionState.ENRICHMENT_VERIFIED.name, 1, "com.tencent.mm", "notification",
                "notification#event#event-cache-1", "event-cache-1", "wechat", 1L, "CNY", "UNKNOWN", "", "", 1000, 1000))
            val center = PaymentVerificationCenter(app, hintedStore = store, hintedArchive = RoomNotificationStore(db),
                hintedQueuedRequests = { emptyList() })
            val state = PaymentVerificationState(app, account, center)
            state.refresh()
            assertEquals(1, state.items.count { !it.recoveryOnly })
            assertNull(state.items.first { !it.recoveryOnly }.amountMinor)
            assertEquals(1L, state.items.first { it.recoveryOnly }.amountMinor)
        } finally { db.close() }
    }
}
