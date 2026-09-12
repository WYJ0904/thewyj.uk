package uk.thewyj.app.task21

import android.content.Context
import androidx.room.Room
import java.io.File
import java.util.UUID
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome
import uk.thewyj.app.task21.screenshot.ScreenshotEvidence
import uk.thewyj.app.task21.screenshot.ScreenshotLinkAction
import uk.thewyj.app.task21.screenshot.ScreenshotMediaOrigin
import uk.thewyj.app.task21.store.NotificationCapture
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.NotificationQuery
import uk.thewyj.app.task21.store.RoomNotificationArchiveSink
import uk.thewyj.app.task21.store.RoomNotificationStore

/**
 * Task 24.1 R4: Samsung/One UI replaces its single screenshot notification in
 * place for every new screenshot. These tests pin every user-visible rule:
 * one screenshot = one history row, a changed picture always starts a new row,
 * MediaStore and notification evidence of the same screenshot stay one row, and
 * normal notifications keep their existing dedupe.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotificationScreenshotArchiveTest {
    private lateinit var context: Context
    private lateinit var database: NotificationDatabase
    private lateinit var store: RoomNotificationStore
    private lateinit var databaseFile: File

    private val account = "account-a"
    private val screenshotKey = "key:screenshot:1"

    @Before fun setUp() {
        context = RuntimeEnvironment.getApplication()
        databaseFile = File(context.cacheDir, "screenshots-${UUID.randomUUID()}.db")
        database = buildDatabase(databaseFile)
        store = RoomNotificationStore(database)
    }

    @After fun tearDown() {
        database.close()
        databaseFile.delete()
    }

    private fun buildDatabase(file: File): NotificationDatabase =
        Room.databaseBuilder(context, NotificationDatabase::class.java, file.absolutePath)
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

    private fun screenshotCapture(
        fingerprint: String,
        at: Long = 1_000L,
        mediaName: String = fingerprint.replace(':', '-'),
        mediaState: String = "available",
        text: String = "屏幕截图已保存",
        origin: String = ScreenshotMediaOrigin.NOTIFICATION.wireValue,
    ) = NotificationCapture(
        sourcePackage = "com.samsung.android.app.smartcapture",
        sourceType = "notification",
        notificationKey = screenshotKey,
        notificationId = 11,
        tag = "",
        groupKey = "",
        channelId = "screenshot_status",
        postTime = at,
        isGroup = false,
        isGroupSummary = false,
        title = "屏幕截图已保存",
        text = text,
        bigText = "",
        subText = "",
        identityOverride = ScreenshotEvidence.archiveIdentity(fingerprint, ""),
        mediaPath = if (mediaState == "available") "$account/$mediaName.jpg" else "",
        mediaMime = if (mediaState == "available") "image/jpeg" else "",
        mediaState = mediaState,
        mediaFingerprint = fingerprint,
        mediaOrigin = origin,
    )

    /** The row the MediaStore observer writes for one screenshot row id. */
    private fun mediaStoreCapture(fingerprint: String, at: Long) = NotificationCapture(
        sourcePackage = "com.samsung.android.app.smartcapture",
        sourceType = "screenshot_media_store",
        notificationKey = "",
        notificationId = 0,
        tag = "",
        groupKey = "",
        channelId = "screenshots",
        postTime = at,
        isGroup = false,
        isGroupSummary = false,
        title = "屏幕截图已保存",
        text = "",
        bigText = "",
        subText = "",
        identityOverride = ScreenshotEvidence.archiveIdentity(fingerprint, ""),
        mediaPath = "$account/store-${fingerprint.removePrefix("ms:")}.jpg",
        mediaMime = "image/jpeg",
        mediaState = "available",
        mediaFingerprint = fingerprint,
        mediaOrigin = ScreenshotMediaOrigin.MEDIA_STORE.wireValue,
    )

    private fun history() = store.history(account, NotificationQuery(includeRemoved = true, limit = 100))

    @Test fun aSingleScreenshotCreatesExactlyOneHistoryRow() {
        assertNotNull(store.record(account, screenshotCapture("nfb:aaa")))
        assertEquals(1, history().size)
        assertEquals("屏幕截图已保存", history().first().title)
    }

    @Test fun aSecondScreenshotWithTheSameNotificationKeyCreatesASecondRow() {
        store.record(account, screenshotCapture("nfb:aaa", at = 1_000L, mediaName = "shot-a"))
        store.record(account, screenshotCapture("nfb:bbb", at = 2_000L, mediaName = "shot-b"))
        val rows = history()
        assertEquals("identical text with a new picture is a new snapshot", 2, rows.size)
        assertEquals(setOf("$account/shot-a.jpg", "$account/shot-b.jpg"), rows.map { it.mediaPath }.toSet())
    }

    @Test fun fiveScreenshotsInARowCreateFiveRows() {
        val fingerprints = listOf("nfb:a", "nfb:b", "nfb:c", "nfb:d", "nfb:e")
        fingerprints.forEachIndexed { index, fingerprint ->
            store.record(
                account,
                screenshotCapture(
                    fingerprint,
                    at = 1_000L + index * 900L,
                    mediaName = "shot-$index",
                ),
            )
        }
        assertEquals(5, history().size)
    }

    @Test fun rapidScreenshotsAreNeverDebouncedIntoOneRow() {
        store.record(account, screenshotCapture("nfb:r1", at = 5_000L, mediaName = "rapid-1"))
        store.record(account, screenshotCapture("nfb:r2", at = 5_180L, mediaName = "rapid-2"))
        store.record(account, screenshotCapture("nfb:r3", at = 5_360L, mediaName = "rapid-3"))
        assertEquals(3, history().size)
    }

    @Test fun anIdenticalReplayDoesNotCreateASecondRow() {
        store.record(account, screenshotCapture("nfb:aaa"))
        assertNull("an exact callback replay is not a new snapshot", store.record(account, screenshotCapture("nfb:aaa")))
        assertEquals(1, history().size)
    }

    @Test fun screenshotPicturesStayAttachedToTheirOwnSnapshot() {
        store.record(account, screenshotCapture("nfb:aaa", at = 1_000L, mediaName = "shot-a"))
        store.record(account, screenshotCapture("nfb:bbb", at = 2_000L, mediaName = "shot-b"))
        val byText = history().associateBy { it.mediaPath }
        assertEquals("$account/shot-a.jpg", history().first { it.capturedAt == 1_000L }.mediaPath)
        assertEquals("$account/shot-b.jpg", history().first { it.capturedAt == 2_000L }.mediaPath)
        assertEquals(2, byText.size)
    }

    @Test fun mediaStoreImportMergesWithTheNotificationEvidence() {
        store.record(account, screenshotCapture("nfb:aaa", at = 10_000L, mediaName = "thumb"))
        val link = store.linkScreenshotEvidence(
            accountId = account,
            fingerprint = "ms:77",
            origin = ScreenshotMediaOrigin.MEDIA_STORE,
            eventAtMs = 10_400L,
            mediaPath = "$account/store-77.jpg",
            mediaMime = "image/jpeg",
            mediaState = "available",
        )
        assertEquals(ScreenshotLinkAction.MERGE, link.action)
        val rows = history()
        assertEquals("listener + MediaStore must stay one row", 1, rows.size)
        assertEquals("the full-resolution MediaStore copy wins", "$account/store-77.jpg", rows.first().mediaPath)
        val revision = database.notificationDao().revisionByMediaFingerprint(account, "ms:77")
        assertNotNull(revision)
        assertEquals("nfb:aaa", revision!!.mediaFingerprintAlt)
        assertEquals(ScreenshotMediaOrigin.MERGED.wireValue, revision.mediaOrigin)
    }

    @Test fun mediaStoreFirstThenNotificationAlsoMergesIntoOneRow() {
        // The observer archived the screenshot before the notification callback
        // arrived (the sink resolves first and only writes on NEW_EVENT).
        store.record(account, mediaStoreCapture("ms:88", at = 20_000L))
        val notificationLink = store.linkScreenshotEvidence(
            accountId = account,
            fingerprint = "nfb:zzz",
            origin = ScreenshotMediaOrigin.NOTIFICATION,
            eventAtMs = 20_300L,
            mediaPath = "$account/thumb-zzz.jpg",
            mediaMime = "image/jpeg",
            mediaState = "available",
        )
        assertEquals(ScreenshotLinkAction.MERGE, notificationLink.action)
        assertEquals("the notification must merge into the MediaStore row", 1, history().size)
        assertEquals(
            "the MediaStore picture is not replaced by the thumbnail",
            "$account/store-88.jpg",
            history().first().mediaPath,
        )
    }

    @Test fun reImportingTheSameMediaStoreRowIsIgnored() {
        store.record(account, mediaStoreCapture("ms:99", at = 30_000L))
        val second = store.linkScreenshotEvidence(
            accountId = account,
            fingerprint = "ms:99",
            origin = ScreenshotMediaOrigin.MEDIA_STORE,
            eventAtMs = 30_100L,
            mediaPath = "$account/store-99.jpg",
            mediaState = "available",
        )
        assertEquals(ScreenshotLinkAction.DUPLICATE, second.action)
        assertEquals(1, history().size)
    }

    @Test fun aScreenshotTakenAfterTheNotificationWasClearedIsKept() {
        val first = store.record(account, screenshotCapture("nfb:aaa", at = 40_000L))
        assertNotNull(first)
        store.markRemoved(account, screenshotKey, 41_000L)
        store.record(account, screenshotCapture("nfb:bbb", at = 42_000L, mediaName = "shot-b"))
        val rows = history()
        assertEquals(2, rows.size)
        assertTrue("clearing the shade must never delete saved history", rows.any { it.capturedAt == 40_000L })
    }

    @Test fun screenshotEventsAreNeverCoalescedAsLiveReadouts() {
        val classification = (1..6).map { index ->
            NotificationClassifier.classify(
                NotificationClassificationInput(
                    sourcePackage = "com.samsung.android.app.smartcapture",
                    channelId = "screenshot_status",
                    title = "屏幕截图已保存",
                    text = "",
                    isOngoing = true,
                    identityKey = "account-a\u001F$screenshotKey",
                    occurredAtMs = 50_000L + index * 500L,
                ),
            )
        }
        assertTrue("every screenshot notice must be archived", classification.all { it.storeInArchive })
        assertTrue(classification.all { it.reason == "screenshot_event" })
    }

    @Test fun ordinaryNotificationDedupeIsUnchanged() {
        fun chat(text: String, at: Long) = NotificationCapture(
            sourcePackage = "com.tencent.mm",
            sourceType = "notification",
            notificationKey = "key:chat:1",
            notificationId = 3,
            tag = "",
            groupKey = "",
            channelId = "chat",
            postTime = at,
            isGroup = false,
            isGroupSummary = false,
            title = "张三",
            text = text,
            bigText = "",
            subText = "",
        )

        store.record(account, chat("转账100", 60_000L))
        assertNull("an identical callback stays a replay", store.record(account, chat("转账100", 60_000L)))
        store.record(account, chat("我给你转了199", 61_000L))
        assertEquals(2, history().size)
        assertTrue(history().none { it.sourcePackage == "com.samsung.android.app.smartcapture" })
    }

    @Test fun mediaStoreFallbackArchivesADegradedRowWithoutADeadUri() {
        val event = ScreenshotMediaEvent(
            fingerprint = "ms:1234",
            rowId = 1234,
            sourcePackage = "com.samsung.android.app.smartcapture",
            appLabel = "智能截屏",
            title = "截图",
            text = "",
            capturedAtMs = 70_000L,
            mediaUri = "content://media/external/images/media/1234",
            mediaMime = "image/jpeg",
            // Selected Photos Access / unreadable URI: the row is still archived.
            mediaState = "unavailable",
        )
        val first = offMain { RoomNotificationArchiveSink(context).storeMediaStoreScreenshot("account-sink", event) }
        assertEquals(ScreenshotArchiveOutcome.STORED, first)
        val rows = offMain {
            RoomNotificationStore(NotificationDatabase.get(context))
                .history("account-sink", NotificationQuery(includeRemoved = true, limit = 50))
        }
        assertEquals(1, rows.size)
        assertEquals("unavailable", rows.first().mediaState)
        assertEquals("a content URI is never persisted as the media path", "", rows.first().mediaPath)

        val duplicate = offMain { RoomNotificationArchiveSink(context).storeMediaStoreScreenshot("account-sink", event) }
        assertEquals(ScreenshotArchiveOutcome.DUPLICATE, duplicate)
        assertEquals(
            1,
            offMain {
                RoomNotificationStore(NotificationDatabase.get(context))
                    .history("account-sink", NotificationQuery(includeRemoved = true, limit = 50))
            }.size,
        )
    }

    /**
     * The production sink runs on the listener's background executor; the app
     * database forbids main-thread access, so the test drives it the same way.
     */
    private fun <T> offMain(block: () -> T): T {
        var result: T? = null
        var failure: Throwable? = null
        val thread = Thread {
            try {
                result = block()
            } catch (error: Throwable) {
                failure = error
            }
        }
        thread.start()
        thread.join()
        failure?.let { throw it }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }
}
