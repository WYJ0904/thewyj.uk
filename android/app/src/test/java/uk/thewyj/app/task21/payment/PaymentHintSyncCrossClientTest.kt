package uk.thewyj.app.task21.payment

import androidx.room.Room
import java.io.File
import java.util.UUID
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.IngestResponse
import uk.thewyj.app.task21.NotificationArchiveSink
import uk.thewyj.app.task21.NotificationCaptureCoordinator
import uk.thewyj.app.task21.NotificationCaptureInput
import uk.thewyj.app.task21.NotificationIngestTransport
import uk.thewyj.app.task21.StructuredNotificationEvent
import uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome
import uk.thewyj.app.task21.ScreenshotMediaEvent
import uk.thewyj.app.task21.store.NotificationCapture
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.NotificationQuery
import uk.thewyj.app.task21.store.PaymentRecognitionStoreContract
import uk.thewyj.app.task21.store.RoomNotificationStore
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore

/**
 * Phase 1 cross-client verification (no mocks of the chain under test):
 * a confirm that happened on the Web is pulled by {@link PaymentHintSync.sync()}
 * and must close the Android notification archive with the server transaction id.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class PaymentHintSyncCrossClientTest {
    private lateinit var database: NotificationDatabase
    private lateinit var store: RoomNotificationStore
    private lateinit var paymentStore: PaymentRecognitionStoreContract
    private lateinit var databaseFile: File
    private val account = "account-a"

    @Before fun setUp() {
        databaseFile = File(RuntimeEnvironment.getApplication().cacheDir, "hint-sync-${UUID.randomUUID()}.db")
        database = Room.databaseBuilder(RuntimeEnvironment.getApplication(), NotificationDatabase::class.java, databaseFile.absolutePath)
            .addMigrations(
                NotificationDatabase.MIGRATION_1_2,
                NotificationDatabase.MIGRATION_2_3,
                NotificationDatabase.MIGRATION_3_4,
                NotificationDatabase.MIGRATION_4_5,
                NotificationDatabase.MIGRATION_5_6,
                NotificationDatabase.MIGRATION_6_7,
            )
            .allowMainThreadQueries()
            .build()
        store = RoomNotificationStore(database)
        paymentStore = RoomPaymentRecognitionStore(database)
    }

    @After fun tearDown() {
        database.close()
        databaseFile.delete()
    }

    private fun sink() = object : NotificationArchiveSink {
        override fun store(
            accountId: String,
            input: NotificationCaptureInput,
            parsed: StructuredNotificationEvent?,
        ): Boolean = false

        override fun markRemoved(accountId: String, input: NotificationCaptureInput) = Unit

        override fun storeMediaStoreScreenshot(accountId: String, event: ScreenshotMediaEvent) =
            ScreenshotArchiveOutcome.SKIPPED

        override fun markFinanceOutcome(
            accountId: String,
            sourceEventId: String,
            state: String,
            transactionId: String,
        ): Boolean = store.markFinanceOutcome(accountId, sourceEventId, state, transactionId)
    }

    private fun archivePayment(eventId: String) = store.record(
        account,
        NotificationCapture(
            sourcePackage = "cmb.pb",
            sourceType = "notification",
            notificationKey = "key:$eventId",
            notificationId = 7,
            tag = "",
            groupKey = "",
            channelId = "bank",
            postTime = 1_000L,
            isGroup = false,
            isGroupSummary = false,
            title = "招商银行",
            text = "已支付 ¥28.00",
            bigText = "",
            subText = "",
            sourceEventId = eventId,
        ),
    )

    private fun financeState(eventId: String): Pair<String, String> {
        val instanceId = database.notificationDao().instanceIdForEventId(account, eventId)!!
        val instance = database.notificationDao().instance(account, instanceId)!!
        return instance.financeState to instance.financeTransactionId
    }

    private fun syncWith(body: String): PaymentHintSync.Result {
        val transport = object : NotificationIngestTransport {
            override fun post(path: String, sessionToken: String, body: String): IngestResponse =
                IngestResponse(false, 404, "{}")

            override fun get(path: String, sessionToken: String): IngestResponse =
                IngestResponse(true, 200, body)
        }
        return PaymentHintSync(
            RuntimeEnvironment.getApplication(),
            hintedTransport = transport,
            hintedStore = paymentStore,
            archiveSink = sink(),
            accountOverride = {
                NotificationCaptureCoordinator.CaptureAccount(
                    accountId = account,
                    deviceId = "device-a",
                    sessionToken = "token-a",
                    financeEntitled = true,
                )
            },
        ).sync()
    }

    @Test fun webConfirmReachesTheAndroidArchiveThroughTheRealPullPath() {
        archivePayment("evt-confirm")
        store.markFinanceOutcome(account, "evt-confirm", "pending")

        val result = syncWith(
            """{"ok":true,"hints":[{"source_event_id":"evt-confirm","state":"confirmed","finance_entry_id":"txn-web-1"}]}""",
        )

        assertEquals(1, result.confirmed)
        assertTrue(result.ok)
        assertEquals("confirmed" to "txn-web-1", financeState("evt-confirm"))
    }

    @Test fun aRepeatedPendingPullCannotResurrectAConfirmedEvent() {
        archivePayment("evt-stable")
        store.markFinanceOutcome(account, "evt-stable", "confirmed", "txn-1")

        // A stale server answer that still lists the event as pending must not
        // rewrite the terminal archive state.
        syncWith("""{"ok":true,"hints":[{"source_event_id":"evt-stable","state":"pending"}]}""")
        assertEquals("confirmed" to "txn-1", financeState("evt-stable"))

        // Nor may a replay of the same confirm change the transaction id.
        syncWith(
            """{"ok":true,"hints":[{"source_event_id":"evt-stable","state":"confirmed","finance_entry_id":"txn-1"}]}""",
        )
        assertEquals("confirmed" to "txn-1", financeState("evt-stable"))
    }

    @Test fun ignoredHintClosesTheArchiveWithoutATransaction() {
        archivePayment("evt-ignored")
        store.markFinanceOutcome(account, "evt-ignored", "pending")
        val result = syncWith("""{"ok":true,"hints":[{"source_event_id":"evt-ignored","state":"ignored"}]}""")
        assertEquals(1, result.ignored)
        assertEquals("ignored" to "", financeState("evt-ignored"))
    }

    @Test fun historyRefreshStillShowsTheTerminalState() {
        archivePayment("evt-history")
        store.markFinanceOutcome(account, "evt-history", "confirmed", "txn-h")
        val history = store.history(account, NotificationQuery(includeRemoved = true, limit = 10))
        assertEquals(1, history.size)
        assertEquals("confirmed" to "txn-h", financeState("evt-history"))
    }
}
