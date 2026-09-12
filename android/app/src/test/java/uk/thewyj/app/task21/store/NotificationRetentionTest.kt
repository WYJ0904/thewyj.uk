package uk.thewyj.app.task21.store

import android.content.Context
import androidx.room.Room
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
import java.io.File
import java.util.UUID

/**
 * Task 24.1 retention boundaries. The user cannot wait months, so every period
 * is verified with constructed timestamps and an explicit cutoff.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotificationRetentionTest {
    private lateinit var context: Context
    private lateinit var database: NotificationDatabase
    private lateinit var store: RoomNotificationStore
    private lateinit var databaseFile: File

    private val dayMs = 24L * 60 * 60 * 1000
    private val now = 1_800_000_000_000L

    @Before fun setUp() {
        context = RuntimeEnvironment.getApplication()
        databaseFile = File(context.cacheDir, "retention-${UUID.randomUUID()}.db")
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

    private fun record(id: Int, ageDays: Double, pinned: Boolean = false, financeLinked: Boolean = false) {
        val postTime = now - (ageDays * dayMs).toLong()
        val instanceId = store.record(
            "account-a",
            NotificationCapture(
                sourcePackage = "com.tencent.mm",
                sourceType = "notification",
                notificationKey = "key:$id",
                notificationId = id,
                tag = "",
                groupKey = "",
                channelId = "chat",
                postTime = postTime,
                isGroup = false,
                isGroupSummary = false,
                title = "标题 $id",
                text = "正文 $id",
                bigText = "",
                subText = "",
            ),
            now = postTime,
        )
        requireNotNull(instanceId) { "capture $id must create an instance" }
        if (pinned) store.setPinned("account-a", instanceId, true, now)
        if (financeLinked) store.markFinanceLinked("account-a", instanceId)
    }

    private fun historyCount(): Int = store.history("account-a", NotificationQuery(includeRemoved = true, limit = 500)).size

    private fun purge(days: Int): Int = store.purgeExpired("account-a", now - days.toLong() * dayMs)

    @Test fun sevenDayBoundaryKeepsSixAndSevenDayEntriesAndRemovesEightDayOnes() {
        record(1, ageDays = 6.0)
        record(2, ageDays = 7.0)
        record(3, ageDays = 8.0)
        assertEquals(1, purge(7))
        val remaining = store.history("account-a", NotificationQuery(includeRemoved = true, limit = 50)).map { it.title }
        assertTrue("6-day entry must stay", remaining.contains("标题 1"))
        assertTrue("exactly 7-day entry is still inside the window", remaining.contains("标题 2"))
        assertTrue("8-day entry must be purged", remaining.none { it == "标题 3" })
    }

    @Test fun thirtyDayBoundary() {
        record(10, ageDays = 29.0)
        record(11, ageDays = 31.0)
        assertEquals(1, purge(30))
        val titles = store.history("account-a", NotificationQuery(includeRemoved = true, limit = 50)).map { it.title }
        assertTrue(titles.contains("标题 10"))
        assertTrue(titles.none { it == "标题 11" })
    }

    @Test fun ninetyDayBoundary() {
        record(12, ageDays = 89.0)
        record(13, ageDays = 91.0)
        assertEquals(1, purge(90))
        val titles = store.history("account-a", NotificationQuery(includeRemoved = true, limit = 50)).map { it.title }
        assertTrue(titles.contains("标题 12"))
        assertTrue(titles.none { it == "标题 13" })
    }

    @Test fun threeHundredSixtyFiveDayBoundary() {
        record(14, ageDays = 364.0)
        record(15, ageDays = 366.0)
        assertEquals(1, purge(365))
        val titles = store.history("account-a", NotificationQuery(includeRemoved = true, limit = 50)).map { it.title }
        assertTrue(titles.contains("标题 14"))
        assertTrue(titles.none { it == "标题 15" })
    }

    @Test fun permanentRetentionNeverDeletesAnything() {
        record(20, ageDays = 5_000.0)
        assertEquals(0, NotificationRepository.normalizeRetention(0))
        // 永久 = 0 days: the repository reports "nothing to purge".
        assertEquals(0, NotificationRepository.PERMANENT_RETENTION_DAYS)
        // The store itself is only called with a real cutoff, so guard the
        // contract the repository enforces: no cutoff, no purge.
        assertEquals(0, store.purgeExpired("account-a", 0L))
        assertEquals(1, historyCount())
    }

    @Test fun favouritesAndFinanceLinkedEntriesSurviveEveryPeriod() {
        record(30, ageDays = 900.0, pinned = true)
        record(31, ageDays = 900.0, financeLinked = true)
        record(32, ageDays = 900.0)
        val removed = store.purgeExpired("account-a", now)
        assertEquals(1, removed)
        val titles = store.history("account-a", NotificationQuery(includeRemoved = true, limit = 50)).map { it.title }
        assertTrue("pinned entries are never auto-deleted", titles.contains("标题 30"))
        assertTrue("finance-linked evidence is never auto-deleted", titles.contains("标题 31"))
        assertTrue(titles.none { it == "标题 32" })
        assertEquals(1, store.pinnedCount("account-a"))
        assertEquals(1, store.pinnedOlderThan("account-a", now))
    }

    @Test fun retentionOptionsAreStableAndSettingsSurviveReopen() {
        assertEquals(listOf(7, 30, 90, 365, 0), NotificationRepository.RETENTION_OPTIONS)
        // Legacy values stay valid, unknown values fall back to the default.
        assertEquals(1, NotificationRepository.normalizeRetention(1))
        assertEquals(3, NotificationRepository.normalizeRetention(3))
        assertEquals(30, NotificationRepository.normalizeRetention(42))
        assertEquals(0, NotificationRepository.normalizeRetention(-1))

        store.updateSettings(store.ensureSettings("account-a").copy(retentionDays = 90))
        database.close()
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
        val settings = store.ensureSettings("account-a")
        assertNotNull(settings)
        assertEquals(90, settings.retentionDays)
    }
}
