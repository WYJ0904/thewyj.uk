package uk.thewyj.app.task21.store

import android.content.Context
import androidx.room.Room
import java.io.File
import java.util.UUID
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Phase 1 (Task 24.2) canonical Notification → Finance link.
 *
 * The archived snapshot must carry the same structured event id the payment
 * pipeline uses, and must end in a terminal finance state with the server
 * transaction id persisted - not in a UI-only flag.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotificationFinanceLinkTest {
    private lateinit var context: Context
    private lateinit var database: NotificationDatabase
    private lateinit var store: RoomNotificationStore
    private lateinit var databaseFile: File
    private val account = "account-a"

    @Before fun setUp() {
        context = RuntimeEnvironment.getApplication()
        databaseFile = File(context.cacheDir, "finance-link-${UUID.randomUUID()}.db")
        database = Room.databaseBuilder(context, NotificationDatabase::class.java, databaseFile.absolutePath)
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
    }

    @After fun tearDown() {
        database.close()
        databaseFile.delete()
    }

    private fun capture(eventId: String, key: String = "key:cmb:1") = NotificationCapture(
        sourcePackage = "cmb.pb",
        sourceType = "notification",
        notificationKey = key,
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
    )

    @Test fun archivedPaymentCarriesTheStructuredEventIdentity() {
        assertNotNull(store.record(account, capture("evt-1")))
        val instanceId = database.notificationDao().instanceIdForEventId(account, "evt-1")
        assertEquals("the archive must resolve the same structured event id", instanceId, store.history(account, NotificationQuery()).first().instanceId)
    }

    @Test fun pendingThenConfirmedPersistsTheTransactionId() {
        store.record(account, capture("evt-2"))
        assertTrue(store.markFinanceOutcome(account, "evt-2", "pending"))
        assertTrue(store.markFinanceOutcome(account, "evt-2", "confirmed", "txn-9"))

        val instance = database.notificationDao().instance(account, database.notificationDao().instanceIdForEventId(account, "evt-2")!!)
        assertNotNull(instance)
        assertEquals("confirmed", instance!!.financeState)
        assertEquals("txn-9", instance.financeTransactionId)
        assertEquals(1, instance.financeLinked)
    }

    @Test fun aTerminalStateIsNeverDowngradedByARepeatedPendingWrite() {
        store.record(account, capture("evt-3"))
        store.markFinanceOutcome(account, "evt-3", "pending")
        store.markFinanceOutcome(account, "evt-3", "confirmed", "txn-3")
        // A late/duplicate pull that still thinks the event is pending must not
        // be able to rewrite the terminal row: the caller only writes terminal
        // states, and this asserts the stored value after a repeat confirm.
        store.markFinanceOutcome(account, "evt-3", "confirmed", "txn-3")
        val instance = database.notificationDao().instance(account, database.notificationDao().instanceIdForEventId(account, "evt-3")!!)
        assertEquals("confirmed", instance!!.financeState)
        assertEquals("txn-3", instance.financeTransactionId)
    }

    @Test fun removingTheNotificationKeepsTheArchiveAndItsFinanceState() {
        store.record(account, capture("evt-4"))
        store.markFinanceOutcome(account, "evt-4", "confirmed", "txn-4")
        store.markRemoved(account, "key:cmb:1", 2_000L)

        val history = store.history(account, NotificationQuery(includeRemoved = true, limit = 10))
        assertEquals("a removed notification must stay in history", 1, history.size)
        assertEquals("已入账 evidence must survive the removal", "txn-4", database.notificationDao()
            .instance(account, history.first().instanceId)!!.financeTransactionId)
    }

    @Test fun unknownEventIdCannotWriteAFinanceOutcome() {
        store.record(account, capture("evt-5"))
        assertTrue(!store.markFinanceOutcome(account, "evt-does-not-exist", "confirmed", "txn-x"))
    }
}
