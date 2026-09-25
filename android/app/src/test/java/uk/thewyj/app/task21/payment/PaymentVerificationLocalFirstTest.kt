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
}
