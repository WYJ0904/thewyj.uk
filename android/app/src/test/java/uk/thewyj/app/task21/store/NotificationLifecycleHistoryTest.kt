package uk.thewyj.app.task21.store

import android.app.Application
import androidx.room.Room
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class NotificationLifecycleHistoryTest {
    private lateinit var database: NotificationDatabase
    private lateinit var store: RoomNotificationStore

    @Before fun setUp() {
        database = Room.inMemoryDatabaseBuilder(
            RuntimeEnvironment.getApplication(),
            NotificationDatabase::class.java,
        ).allowMainThreadQueries().build()
        store = RoomNotificationStore(database)
    }

    @After fun tearDown() = database.close()

    @Test fun emptyUpdateCannotOverwriteReadableContent() {
        val account = "account-empty-update"
        val first = capture(key = "key-one", at = 1_000, title = "Remote", text = "已连接")
        val blank = capture(key = "key-one", at = 2_000, title = "", text = "")

        store.record(account, first, 1_000)
        val write = store.record(account, blank, 2_000)

        assertEquals("an empty refresh still touches the existing lifecycle", store.history(account, NotificationQuery()).first().instanceId, write)
        val snapshots = store.history(account, NotificationQuery())
        assertEquals(1, snapshots.size)
        assertEquals("Remote", snapshots.single().title)
        assertEquals("已连接", snapshots.single().text)
    }

    @Test fun userHistoryFoldsStatusRevisionsButDetailKeepsThem() {
        val account = "account-folded-history"
        store.record(account, capture("status", 1_000, "Remote", "正在连接").copy(archiveKind = "live"), 1_000)
        store.record(account, capture("status", 2_000, "Remote", "已连接").copy(archiveKind = "live"), 2_000)
        store.record(account, capture("status", 3_000, "Remote", "正在重连").copy(archiveKind = "live"), 3_000)

        assertEquals(3, store.history(account, NotificationQuery()).size)
        val folded = store.lifecycleHistory(account, NotificationQuery())
        assertEquals(1, folded.size)
        assertEquals("正在重连", folded.single().text)
        assertEquals(3, folded.single().revisionCount)
        assertEquals(3, store.recentRevisions(account, folded.single().instanceId).size)
    }

    @Test fun identicalTextOnDifferentNotificationIdentitiesStaysSeparate() {
        val account = "account-distinct-events"
        store.record(account, capture("payment-a", 1_000, "支付", "已支付 ¥2.80"), 1_000)
        store.record(account, capture("payment-b", 1_100, "支付", "已支付 ¥2.80"), 1_100)

        assertEquals(2, store.lifecycleHistory(account, NotificationQuery()).size)
    }

    @Test fun twoTransactionsUnderOneNotificationKeyRemainTwoVisibleSnapshots() {
        store.record("account", capture("same-slot", 1_000, "支付", "已支付 ¥2.80 交易号 abcdef01"), 1_000)
        store.record("account", capture("same-slot", 2_000, "支付", "已支付 ¥2.80 交易号 abcdef02"), 2_000)
        assertEquals(2, store.lifecycleHistory("account", NotificationQuery()).size)
    }

    @Test fun infoTextAndMessagingLinesSurviveTheUserFacingQuery() {
        val account = "account-secondary-text"
        store.record(
            account,
            capture("info", 1_000, "", "").copy(infoText = "辅助信息"),
            1_000,
        )
        store.record(
            account,
            capture("lines", 2_000, "", "").copy(textLines = listOf("消息正文")),
            2_000,
        )
        val rows = store.lifecycleHistory(account, NotificationQuery()).associateBy { it.postTime }
        assertEquals("辅助信息", rows.getValue(1_000).infoText)
        assertEquals(listOf("消息正文"), rows.getValue(2_000).textLines)
        assertEquals(1, store.lifecycleHistory(account, NotificationQuery(search = "辅助信息")).size)
        assertEquals(1, store.lifecycleHistory(account, NotificationQuery(search = "消息正文")).size)
    }

    private fun capture(key: String, at: Long, title: String, text: String) = NotificationCapture(
        sourcePackage = "com.example.app",
        sourceType = "notification",
        notificationKey = key,
        notificationId = key.hashCode(),
        tag = "",
        groupKey = "",
        channelId = "status",
        postTime = at,
        isGroup = false,
        isGroupSummary = false,
        title = title,
        text = text,
        bigText = "",
        subText = "",
    )
}
