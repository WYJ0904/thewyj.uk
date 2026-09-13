package uk.thewyj.app.task21.store

import android.content.Context
import androidx.room.Room
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Task 24 reopen #5 regression: an updating notification (screen-recording
 * timer, live readout the app reposts every second without the ongoing flag)
 * must keep exactly one archive row. The store rewrites that row in place
 * instead of appending a snapshot per tick, while real content changes, a
 * removal and a later repost keep their own lifecycles.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotificationReadoutCoalescingTest {
    private val account = "account-readout"
    private val context: Context = RuntimeEnvironment.getApplication()
    private lateinit var database: NotificationDatabase
    private lateinit var store: RoomNotificationStore

    @Before fun setUp() {
        database = Room.inMemoryDatabaseBuilder(context, NotificationDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        store = RoomNotificationStore(database)
    }

    @After fun tearDown() {
        database.close()
    }

    private fun capture(
        text: String,
        postTime: Long,
        key: String = "com.example.recorder|1|",
        notificationId: Int = 1,
        tag: String = "",
        coalesce: Boolean = false,
        title: String = "屏幕录制",
    ) = NotificationCapture(
        sourcePackage = "com.example.recorder",
        sourceType = "notification",
        notificationKey = key,
        notificationId = notificationId,
        tag = tag,
        groupKey = "",
        channelId = "recording",
        postTime = postTime,
        isGroup = false,
        isGroupSummary = false,
        title = title,
        text = text,
        bigText = "",
        subText = "",
        coalesceWithPrevious = coalesce,
    )

    @Test fun everyTickOfAnUpdatingReadoutRewritesTheSameRow() {
        assertNotNull(store.record(account, capture("录屏中 00:01", 1_000L), now = 1_000L))
        for (tick in 2..30) {
            val instanceId = store.record(
                account,
                capture("录屏中 00:%02d".format(tick), tick * 1_000L, coalesce = true),
                now = tick * 1_000L,
            )
            assertNotNull("tick $tick must be a real write", instanceId)
        }

        val history = store.history(account, NotificationQuery())
        assertEquals("one updating notification keeps one history row", 1, history.size)
        assertEquals("录屏中 00:30", history.first().text)
        assertEquals(1, store.revisions(account, history.first().instanceId).size)
        assertEquals(1, store.stats(account).activeCount)
        assertEquals(1, store.stats(account).revisionCount)
    }

    @Test fun aRealContentChangeStillCreatesItsOwnSnapshot() {
        val instanceId = store.record(account, capture("录屏中 00:01", 1_000L), now = 1_000L)!!
        store.record(account, capture("录屏中 00:02", 2_000L, coalesce = true), now = 2_000L)
        // A different shape is a new message, not an update of the readout.
        store.record(account, capture("录屏已保存", 3_000L), now = 3_000L)

        val history = store.history(account, NotificationQuery())
        assertEquals(2, history.size)
        assertEquals(listOf("录屏已保存", "录屏中 00:02"), history.map { it.text })
        assertEquals(2, store.revisions(account, instanceId).size)
        assertEquals(1, store.stats(account).activeCount)
    }

    @Test fun repostAfterRemovalStartsANewLifecycle() {
        store.record(account, capture("录屏中 00:01", 1_000L), now = 1_000L)
        assertEquals(1, store.markRemoved(account, "com.example.recorder|1|", 2_000L))
        store.record(account, capture("录屏中 00:02", 3_000L, coalesce = true), now = 3_000L)

        val history = store.history(account, NotificationQuery())
        assertEquals("the removed snapshot stays in history", 2, history.size)
        assertEquals("only the repost is active", 1, store.stats(account).activeCount)
    }

    /**
     * Some apps post without a platform key. The lifecycle is still real
     * (package + id + tag), so a removal must close that slot and the repost must
     * not silently reopen the removed instance.
     */
    @Test fun keylessSlotRemovalClosesTheLifecycle() {
        store.record(
            account,
            capture("录屏中 00:01", 1_000L, key = "", notificationId = 42, tag = "record"),
            now = 1_000L,
        )
        assertEquals(
            1,
            store.markRemovedBySlot(account, "com.example.recorder", 42, "record", 2_000L),
        )
        store.record(
            account,
            capture("录屏中 00:02", 3_000L, key = "", notificationId = 42, tag = "record", coalesce = true),
            now = 3_000L,
        )

        assertEquals(2, store.history(account, NotificationQuery()).size)
        assertEquals(1, store.stats(account).activeCount)
    }

    @Test fun keylessSlotRemovalIgnoresAnEmptySlot() {
        store.record(account, capture("录屏中 00:01", 1_000L, key = "", notificationId = 0, tag = ""), now = 1_000L)
        assertEquals(0, store.markRemovedBySlot(account, "com.example.recorder", 0, "", 2_000L))
        assertEquals(1, store.stats(account).activeCount)
    }
}
