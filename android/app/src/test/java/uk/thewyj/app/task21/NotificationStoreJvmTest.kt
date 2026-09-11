package uk.thewyj.app.task21

import android.content.Context
import androidx.room.Room
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.store.LegacyArchiveMigration
import uk.thewyj.app.task21.store.NotificationCapture
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.NotificationQuery
import uk.thewyj.app.task21.store.NotificationRuleEntity
import uk.thewyj.app.task21.store.RoomNotificationStore
import java.io.File
import java.util.UUID

/**
 * Phase 1 regression suite: local-first storage, identity semantics, retention
 * and the v1 archive migration. Runs on the JVM so CI covers it without a
 * physical device.
 */
@RunWith(RobolectricTestRunner::class)
// The production Application wires WorkManager and the account graph; the store
// tests only need a plain Android context.
@Config(sdk = [34], application = android.app.Application::class)
class NotificationStoreJvmTest {
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
        packageName: String = "com.tencent.mm",
        key: String = "com.tencent.mm|1|",
        notificationId: Int = 1,
        tag: String = "",
        title: String = "微信支付",
        text: String = "你已支付 ¥28.00",
        postTime: Long = 1_000L,
    ) = NotificationCapture(
        sourcePackage = packageName,
        sourceType = "notification",
        notificationKey = key,
        notificationId = notificationId,
        tag = tag,
        groupKey = "",
        channelId = "chat",
        postTime = postTime,
        isGroup = false,
        isGroupSummary = false,
        title = title,
        text = text,
        bigText = "",
        subText = "",
    )

    @Test fun accountsAreIsolated() {
        store.record("account-a", capture())
        assertEquals(1, store.history("account-a", NotificationQuery()).size)
        assertEquals(0, store.history("account-b", NotificationQuery()).size)
        assertEquals(0, store.stats("account-b").activeCount)
    }

    @Test fun identicalReplayIsIgnored() {
        assertNotNull(store.record("account-a", capture()))
        assertNull(store.record("account-a", capture(), now = 2_000L))
        assertEquals(1, store.historyCount("account-a", NotificationQuery()))
        val instanceId = store.history("account-a", NotificationQuery()).first().instanceId
        assertEquals(1, store.revisions("account-a", instanceId).size)
    }

    /**
     * Task 24.1: every content change is its own immutable snapshot. The list
     * therefore shows both messages instead of only the newest revision, which
     * is what made a retracted/replaced WeChat message look like it "disappeared"
     * from history.
     */
    @Test fun contentUpdateKeepsBothSnapshotsOnTheSameInstance() {
        val instanceId = store.record("account-a", capture(text = "第一条", postTime = 1_000L))!!
        store.record("account-a", capture(text = "第二条", postTime = 2_000L))
        val history = store.history("account-a", NotificationQuery())
        assertEquals(2, history.size)
        assertEquals(listOf("第二条", "第一条"), history.map { it.text })
        assertEquals(2, history.first().revisionCount)
        assertEquals(2, store.revisions("account-a", instanceId).size)
        assertEquals(instanceId, history.first().instanceId)
        assertEquals(instanceId, history.last().instanceId)
    }

    /**
     * Real-device report: a message that was later retracted disappeared from
     * history. Removal may only update metadata - the saved snapshots stay.
     */
    @Test fun removedNotificationKeepsEverySavedSnapshot() {
        store.record("account-a", capture(text = "撤回前的原文"))
        store.record("account-a", capture(text = "对方撤回了一条消息"))
        store.markRemoved("account-a", capture().notificationKey)
        val history = store.history("account-a", NotificationQuery(includeRemoved = true))
        assertEquals(2, history.size)
        assertTrue(history.any { it.text == "撤回前的原文" })
        assertTrue(history.any { it.text == "对方撤回了一条消息" })
        assertTrue(history.all { it.status == "removed" })
        // Deleting one snapshot leaves the other one readable.
        assertEquals(1, store.deleteRevisions("account-a", listOf(history.first().revisionId)))
        val remaining = store.history("account-a", NotificationQuery(includeRemoved = true))
        assertEquals(1, remaining.size)
    }

    @Test fun sameTextWithDifferentKeysStaysTwoNotifications() {
        store.record("account-a", capture(key = "key-one", notificationId = 1))
        store.record("account-a", capture(key = "key-two", notificationId = 2, postTime = 2_000L))
        assertEquals(2, store.history("account-a", NotificationQuery()).size)
    }

    @Test fun removedNotificationKeepsHistoryAndRepostStartsANewLifecycle() {
        val first = store.record("account-a", capture())!!
        assertEquals(1, store.markRemoved("account-a", "com.tencent.mm|1|", removedAt = 5_000L))
        val afterRemoval = store.history("account-a", NotificationQuery())
        assertEquals(1, afterRemoval.size)
        assertEquals("removed", afterRemoval.first().status)
        assertEquals(5_000L, afterRemoval.first().removedAt)
        assertEquals(0, store.stats("account-a").activeCount)

        val reposted = store.record("account-a", capture(postTime = 9_000L))
        assertNotNull(reposted)
        assertEquals(2, store.history("account-a", NotificationQuery()).size)
        assertEquals(1, store.stats("account-a").activeCount)
        assertEquals(1, store.revisions("account-a", first).size)
        assertEquals(1, store.revisions("account-a", reposted!!).size)
    }

    @Test fun batchDeleteOnlyRemovesSelectedInstances() {
        val first = store.record("account-a", capture(key = "key-one", notificationId = 1))!!
        store.record("account-a", capture(key = "key-two", notificationId = 2, postTime = 2_000L))
        assertEquals(1, store.delete("account-a", listOf(first)))
        val history = store.history("account-a", NotificationQuery())
        assertEquals(1, history.size)
        assertFalse(history.any { it.instanceId == first })
    }

    @Test fun searchAndFiltersMatchTitleBodyPackageAndTime() {
        store.record("account-a", capture(key = "key-one", notificationId = 1, text = "你已支付 ¥28.00"))
        store.record(
            "account-a",
            capture(packageName = "org.telegram.messenger", key = "tg|1|", notificationId = 1, title = "老周", text = "你好", postTime = 2_000L),
        )
        assertEquals(1, store.history("account-a", NotificationQuery(search = "¥28")).size)
        assertEquals(1, store.history("account-a", NotificationQuery(search = "你好")).size)
        assertEquals(1, store.history("account-a", NotificationQuery(sourcePackage = "org.telegram.messenger")).size)
        assertEquals(1, store.history("account-a", NotificationQuery(fromTime = 1_500L)).size)
    }

    @Test fun retentionPurgeNeverDeletesFinanceLinkedNotifications() {
        val plain = store.record("account-a", capture(key = "plain|1|", notificationId = 1))!!
        val linked = store.record("account-a", capture(key = "linked|2|", notificationId = 2, postTime = 2_000L))!!
        store.markFinanceLinked("account-a", linked)
        store.markRemoved("account-a", "plain|1|", removedAt = 3_000L)
        store.markRemoved("account-a", "linked|2|", removedAt = 3_000L)
        assertEquals(1, store.purgeExpired("account-a", cutoffMs = 10_000L))
        val remaining = store.history("account-a", NotificationQuery())
        assertEquals(1, remaining.size)
        assertEquals(linked, remaining.first().instanceId)
        assertTrue(remaining.first().financeLinked)
        assertFalse(remaining.any { it.instanceId == plain })
    }

    @Test fun appPoliciesDefaultToDenyAndAreAccountScoped() {
        assertFalse(store.isCaptureAllowed("account-a", "com.tencent.mm"))
        store.setAppPolicy("account-a", "com.tencent.mm", enabled = true)
        store.setAppPolicy("account-a", "org.telegram.messenger", enabled = false)
        assertTrue(store.isCaptureAllowed("account-a", "com.tencent.mm"))
        assertFalse(store.isCaptureAllowed("account-a", "org.telegram.messenger"))
        assertFalse(store.isCaptureAllowed("account-b", "com.tencent.mm"))
    }

    @Test fun rulesAreStoredPerAccountAndRemovable() {
        val rule = NotificationRuleEntity(
            ruleId = "rule-1",
            accountId = "account-a",
            name = "只看支付",
            enabled = 1,
            appScope = "*",
            includeKeywords = "支付,转账",
            excludeKeywords = "营销",
            matchAll = 0,
            updatedAt = 1_000L,
        )
        store.upsertRule(rule)
        assertEquals(1, store.rules("account-a").size)
        assertEquals(0, store.rules("account-b").size)
        assertEquals(1, store.deleteRule("account-a", "rule-1"))
        assertEquals(0, store.rules("account-a").size)
    }

    @Test fun settingsDefaultRetentionIsExplicitAndPersisted() {
        val settings = store.ensureSettings("account-a")
        assertEquals(RoomNotificationStore.DEFAULT_RETENTION_DAYS, settings.retentionDays)
        store.updateSettings(settings.copy(retentionDays = -1))
        assertEquals(-1, store.settings("account-a")?.retentionDays)
    }

    @Test fun legacyArchiveIsImportedOnceAndTheOriginalFileSurvives() {
        val root = File(context.cacheDir, "legacy-" + UUID.randomUUID())
        root.mkdirs()
        val legacy = LocalNotificationArchive.inDirectory(root, "account-a")
        assertTrue(legacy.append(legacyRecord("evt-1", "第一条通知", 1_000L)))
        assertTrue(legacy.append(legacyRecord("evt-2", "第二条通知", 2_000L)))
        val legacyFile = File(File(root, "notification-archive"), "account-a.archive")
        assertTrue(legacyFile.exists())

        val migration = LegacyArchiveMigration(database)
        val first = migration.migrateIfNeeded(root, "account-a")
        assertTrue(first.done)
        assertEquals(2, first.imported)
        assertEquals(2, store.history("account-a", NotificationQuery()).size)
        assertTrue("legacy archive must be preserved", legacyFile.exists())

        val second = migration.migrateIfNeeded(root, "account-a")
        assertTrue(second.done)
        assertEquals("migration must not duplicate history", 2, store.history("account-a", NotificationQuery()).size)
    }

    @Test fun migrationFailureKeepsLegacyDataAndMarksFailed() {
        val root = File(context.cacheDir, "legacy-fail-" + UUID.randomUUID())
        root.mkdirs()
        val legacy = LocalNotificationArchive.inDirectory(root, "account-a")
        assertTrue(legacy.append(legacyRecord("evt-1", "第一条通知", 1_000L)))
        // A closed database cannot be written, which is what a crash mid-import
        // looks like from the migrator's point of view.
        database.close()

        val migration = LegacyArchiveMigration(database)
        val result = runCatching { migration.migrateIfNeeded(root, "account-a") }.getOrNull()
        assertTrue("migration must not report success", result == null || !result.done)
        val legacyFile = File(File(root, "notification-archive"), "account-a.archive")
        assertTrue("legacy archive must survive a failed migration", legacyFile.exists())

        // Reopen and re-run: the retry imports the data.
        database = Room.inMemoryDatabaseBuilder(context, NotificationDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        store = RoomNotificationStore(database)
        val retry = LegacyArchiveMigration(database).migrateIfNeeded(root, "account-a")
        assertTrue(retry.done)
        assertEquals(1, store.history("account-a", NotificationQuery()).size)
    }

    private fun legacyRecord(eventId: String, text: String, receivedAtMs: Long) = LocalNotificationRecord(
        id = eventId,
        eventId = eventId,
        fingerprint = eventId.padEnd(64, 'a').take(64),
        sourcePackage = "org.telegram.messenger",
        title = "老周炒股",
        text = text,
        bigText = "",
        subText = "",
        receivedAtMs = receivedAtMs,
        parseStatus = ParseStatus.UNPARSED,
        direction = FinanceDirection.UNKNOWN,
        amountMinor = 0,
        currency = "CNY",
        merchant = "",
        confidence = 0,
    )
}
