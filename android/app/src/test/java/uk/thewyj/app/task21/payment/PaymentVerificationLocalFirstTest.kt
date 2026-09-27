package uk.thewyj.app.task21.payment

import androidx.room.Room
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.IngestResponse
import uk.thewyj.app.task21.NotificationCaptureCoordinator
import uk.thewyj.app.task21.NotificationIngestTransport
import uk.thewyj.app.task21.QueuedNotificationRequest
import uk.thewyj.app.core.network.PendingReviewIdentity
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomNotificationStore
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore
import uk.thewyj.app.ui.PaymentVerificationState

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class PaymentVerificationLocalFirstTest {
    private lateinit var database: NotificationDatabase

    @Before fun setUp() {
        database = Room.inMemoryDatabaseBuilder(
            RuntimeEnvironment.getApplication(), NotificationDatabase::class.java,
        ).allowMainThreadQueries().build()
    }

    @After fun tearDown() { database.close() }

    @Test fun oneCentRoomItemPaintsWhileTransportHangs() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val accountId = "account-a"
        val store = RoomPaymentRecognitionStore(database)
        store.saveRecognition(PaymentRecognitionRecord(
            recognitionId = "rec-one-cent", accountId = accountId,
            state = PaymentRecognitionState.ENRICHMENT_VERIFIED.name,
            notificationId = 1, sourcePackage = "com.tencent.mm", sourceType = "notification",
            sourceEventId = "notification#event#evt-one-cent", uploadEventId = "evt-one-cent",
            paymentChannel = "wechat", amountMinor = 1L, currency = "CNY",
            direction = "UNKNOWN", merchant = "", providerReference = "",
            createdAtMs = 1_000L, updatedAtMs = 1_000L,
        ))
        // Older local rows can have no candidate; the recognition alone must
        // still show the verified amount before any server reply.
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val hangingTransport = object : NotificationIngestTransport {
            override fun post(path: String, sessionToken: String, body: String) = IngestResponse(false, 503, "{}")
            override fun get(path: String, sessionToken: String): IngestResponse {
                entered.countDown()
                release.await(10, TimeUnit.SECONDS)
                return IngestResponse(false, 503, "{}")
            }
        }
        val sync = PaymentHintSync(
            app, hintedTransport = hangingTransport, hintedStore = store,
            accountOverride = { NotificationCaptureCoordinator.CaptureAccount(
                accountId = accountId, deviceId = "device-a", sessionToken = "token-a", financeEntitled = true,
            ) },
        )
        val center = PaymentVerificationCenter(
            app, hintedStore = store, hintedArchive = RoomNotificationStore(database),
            hintedQueuedRequests = { emptyList() }, hintedHintSync = sync,
        )
        val state = PaymentVerificationState(app, accountId, center)
        val cloudJob = launch(Dispatchers.Default) { state.reconcile() }
        try {
            assertTrue(entered.await(3, TimeUnit.SECONDS))
            withTimeout(3_000L) { state.refresh() }
            assertFalse(state.loading)
            assertEquals(1L, state.items.single().amountMinor)
            assertEquals("0.01", PaymentVerificationState.formatMinor(state.items.single().amountMinor!!))
        } finally {
            release.countDown()
            cloudJob.cancelAndJoin()
        }
    }

    @Test fun onlineCardsUseExactlyTheFinanceIdentitySetAndKeepQueuedRecoverySeparate() {
        val app = RuntimeEnvironment.getApplication()
        val accountId = "account-a"
        val store = RoomPaymentRecognitionStore(database)
        fun save(id: String, uploadId: String, state: String = PaymentRecognitionState.ENRICHMENT_VERIFIED.name,
            sourcePackage: String = "com.tencent.mm", amountMinor: Long = 1L) =
            store.saveRecognition(PaymentRecognitionRecord(
            recognitionId = id, accountId = accountId,
            state = state,
            notificationId = 1, sourcePackage = sourcePackage, sourceType = "notification",
            sourceEventId = "notification#event#$id", uploadEventId = uploadId,
            paymentChannel = if (sourcePackage == "cmb.pb") "bank_card" else "wechat",
            amountMinor = amountMinor, currency = "CNY",
            direction = "UNKNOWN", merchant = "", providerReference = "",
            createdAtMs = 1_000L, updatedAtMs = 1_000L,
        ))
        save("rec-matched", "event-matched")
        save("rec-legacy-orphan", "", PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION.name,
            sourcePackage = "cmb.pb", amountMinor = 6_034L)
        save("rec-offline", "event-offline")
        val center = PaymentVerificationCenter(
            app, hintedStore = store, hintedArchive = RoomNotificationStore(database),
            hintedQueuedRequests = { listOf(QueuedNotificationRequest("hint:event-offline", "/api/notification/hints", "{}")) },
        )
        assertFalse(center.localItems(accountId).any { it.recognitionId == "rec-legacy-orphan" })
        val records = listOf(
            PendingReviewIdentity("hint", "hint-matched", "event-matched", "device-a",
                sourcePackage = "com.tencent.mm", appLabel = "微信", amountMinor = 10_200L,
                direction = "", merchant = "", occurredAtMs = 1_789_000_000_000L, confidence = 720),
            PendingReviewIdentity("hint", "hint-remote", "event-remote", "device-b",
                sourcePackage = "cmb.pb", appLabel = "招商银行", amountMinor = 6_034L,
                direction = "", merchant = "", occurredAtMs = 1_789_000_002_000L, confidence = 690),
        )
        val items = center.reconciledItems(accountId, PaymentHintSync.Result(
            refreshed = 2, confirmed = 0, ignored = 0, ok = true,
            completeObservation = true, pendingEventIds = setOf("event-matched", "event-remote"),
            pendingCount = 2, pendingRecords = records,
        ))
        assertEquals(setOf("hint:hint-matched", "hint:hint-remote"),
            items.filterNot { it.recoveryOnly }.map { it.canonicalIdentity }.toSet())
        assertEquals(2, items.count { !it.recoveryOnly })
        assertEquals(1, items.count { it.remoteOnly })
        assertEquals(records.map { it.amountMinor }, items.filterNot { it.recoveryOnly }.map { it.amountMinor })
        assertEquals(records.map { it.appLabel }, items.filterNot { it.recoveryOnly }.map { it.appLabel })
        assertEquals(records.map { it.eventIds }, items.filterNot { it.recoveryOnly }.map { it.eventIds })
        assertEquals(records.map { it.state }, items.filterNot { it.recoveryOnly }.map { it.canonicalState })
        assertEquals(listOf("rec-offline"), items.filter { it.recoveryOnly }.map { it.recognitionId })
        assertFalse(items.any { it.recognitionId == "rec-legacy-orphan" })
    }

    @Test fun localRefreshCannotResurrectAnOptimisticallyTerminalizedCanonicalCard() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val accountId = "account-a"
        val store = RoomPaymentRecognitionStore(database)
        store.saveRecognition(PaymentRecognitionRecord(
            recognitionId = "rec-terminal-race", accountId = accountId,
            state = PaymentRecognitionState.ENRICHMENT_VERIFIED.name,
            notificationId = 4, sourcePackage = "com.tencent.mm", sourceType = "notification",
            sourceEventId = "notification#event#evt-terminal-race", uploadEventId = "evt-terminal-race",
            paymentChannel = "wechat", amountMinor = 1L, currency = "CNY",
            direction = "UNKNOWN", merchant = "", providerReference = "",
            createdAtMs = 1_000L, updatedAtMs = 1_000L,
        ))
        val center = PaymentVerificationCenter(app, hintedStore = store,
            hintedArchive = RoomNotificationStore(database), hintedQueuedRequests = { emptyList() })
        var pending = true
        val state = PaymentVerificationState(app, accountId, center, reconcileOverride = {
            PaymentHintSync.Result(refreshed = 1, confirmed = 0, ignored = 0, ok = true,
                completeObservation = true,
                pendingCount = if (pending) 1 else 0,
                pendingEventIds = if (pending) setOf("evt-terminal-race") else emptySet(),
                pendingRecords = if (pending) listOf(PendingReviewIdentity("hint", "hint-terminal-race",
                    "evt-terminal-race", "device-a", amountMinor = 1L)) else emptyList())
        })
        state.reconcile()
        assertEquals(1, state.items.count { !it.recoveryOnly })
        state.items = emptyList() // The server accepted a local ignore/booking.
        state.refresh()
        assertTrue(state.items.isEmpty())
        pending = false
        store.saveRecognition(store.recognition(accountId, "rec-terminal-race")!!.copy(
            state = PaymentRecognitionState.FINANCE_RECORDED.name,
        ))
        state.reconcile()
        assertTrue(state.items.isEmpty())
    }
}
