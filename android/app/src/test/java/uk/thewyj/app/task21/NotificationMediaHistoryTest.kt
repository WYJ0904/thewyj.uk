package uk.thewyj.app.task21

import android.content.Context
import android.graphics.Bitmap
import androidx.room.Room
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
import uk.thewyj.app.task21.payment.PaymentAppLabels
import uk.thewyj.app.task21.store.NotificationCapture
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.NotificationMediaStore
import uk.thewyj.app.task21.store.NotificationQuery
import uk.thewyj.app.task21.store.NotificationRepository
import uk.thewyj.app.task21.store.RoomNotificationStore
import java.io.File
import java.util.UUID

/**
 * Task 24.1 P0-1: screenshot / image notifications used to vanish from history
 * entirely, and their picture was never kept. These tests pin both behaviours.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotificationMediaHistoryTest {
    private lateinit var context: Context
    private lateinit var database: NotificationDatabase
    private lateinit var store: RoomNotificationStore
    private lateinit var databaseFile: File

    @Before fun setUp() {
        context = RuntimeEnvironment.getApplication()
        databaseFile = File(context.cacheDir, "media-${UUID.randomUUID()}.db")
        database = Room.databaseBuilder(context, NotificationDatabase::class.java, databaseFile.absolutePath)
            .addMigrations(
                NotificationDatabase.MIGRATION_1_2,
                NotificationDatabase.MIGRATION_2_3,
                NotificationDatabase.MIGRATION_3_4,
                NotificationDatabase.MIGRATION_4_5,
                NotificationDatabase.MIGRATION_5_6,
            )
            .allowMainThreadQueries()
            .build()
        store = RoomNotificationStore(database)
    }

    @After fun tearDown() {
        database.close()
        databaseFile.delete()
    }

    private fun capture(
        title: String = "",
        text: String = "",
        packageName: String = "com.samsung.android.app.smartcapture",
        key: String = "key:screenshot:1",
        channelId: String = "screenshot_status",
        mediaPath: String = "",
        mediaState: String = "none",
    ) = NotificationCapture(
        sourcePackage = packageName,
        sourceType = "notification",
        notificationKey = key,
        notificationId = 11,
        tag = "",
        groupKey = "",
        channelId = channelId,
        postTime = 1_000L,
        isGroup = false,
        isGroupSummary = false,
        title = title,
        text = text,
        bigText = "",
        subText = "",
        mediaPath = mediaPath,
        mediaMime = if (mediaPath.isBlank()) "" else "image/jpeg",
        mediaState = mediaState,
    )

    @Test fun emptyBodyNotificationWithPictureIsStillArchived() {
        store.record("account-a", capture(mediaState = "available", mediaPath = "account-a/shot.jpg"))
        val history = store.history("account-a", NotificationQuery())
        assertEquals(1, history.size)
        assertEquals("account-a/shot.jpg", history.first().mediaPath)
        assertEquals("available", history.first().mediaState)
        assertEquals("com.samsung.android.app.smartcapture", history.first().sourcePackage)
        assertTrue("the record exists even without title/body", history.first().title.isBlank())
    }

    @Test fun imageNotificationWithoutReadableBitmapKeepsMetadata() {
        store.record("account-a", capture(text = "屏幕截图已保存", mediaState = "unavailable"))
        val history = store.history("account-a", NotificationQuery())
        assertEquals(1, history.size)
        assertEquals("unavailable", history.first().mediaState)
        assertEquals("屏幕截图已保存", history.first().text)
    }

    @Test fun mediaNotificationIsNeverClassifiedAsLiveReadout() {
        val withMedia = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.samsung.android.app.smartcapture",
                channelId = "screenshot_status",
                title = "屏幕截图已保存",
                text = "",
                hasMedia = true,
                isOngoing = true,
            ),
        )
        assertTrue("a picture is user content, never a live readout", withMedia.storeInArchive)
        assertEquals(NotificationClass.MESSAGE, withMedia.kind)

        val statusChannelWithoutMedia = NotificationClassifier.classify(
            NotificationClassificationInput(
                sourcePackage = "com.example.notes",
                channelId = "sync_status",
                title = "笔记已同步",
                text = "",
            ),
        )
        assertTrue("generic status channels must not drop a real notification", statusChannelWithoutMedia.storeInArchive)
    }

    @Test fun deletingASnapshotReportsItsMediaFileSoItCanBeRemoved() {
        store.record("account-a", capture(mediaPath = "account-a/shot.jpg", mediaState = "available"))
        val item = store.history("account-a", NotificationQuery()).first()
        val paths = store.mediaPathsOfRevisions("account-a", listOf(item.revisionId))
        assertEquals(listOf("account-a/shot.jpg"), paths)
        assertEquals(1, store.deleteRevisions("account-a", listOf(item.revisionId)))
        assertEquals(0, store.history("account-a", NotificationQuery()).size)
    }

    @Test fun mediaStoreWritesAndDeletesLocalFilesOnly() {
        val media = NotificationMediaStore(context)
        val bitmap = Bitmap.createBitmap(64, 48, Bitmap.Config.ARGB_8888)
        val ref = media.save("account-a", "key:1", bitmap)
        assertTrue("a bitmap must be stored locally", ref != null)
        val file = media.file(ref!!.relativePath)
        assertTrue("stored file must exist", file != null && file.length() > 0)
        assertTrue(media.delete(ref.relativePath))
        assertFalse((media.file(ref.relativePath)?.exists()) == true)
        // Path traversal is rejected outright.
        assertEquals(null, media.file("../../databases/wyj-notifications.db"))
    }

    @Test fun appLabelsResolveToUserFacingNames() {
        assertEquals("微信", PaymentAppLabels.resolve(context, "com.tencent.mm"))
        assertEquals("支付宝", PaymentAppLabels.resolve(context, "com.eg.android.AlipayGphone"))
        assertTrue(PaymentAppLabels.isResolved("微信", "com.tencent.mm"))
        assertFalse(PaymentAppLabels.isResolved("com.tencent.mm", "com.tencent.mm"))
    }

    @Test fun repositoryAppLabelNeverPrefersThePackageName() {
        val repository = NotificationRepository(context, "account-a")
        val label = kotlinx.coroutines.runBlocking { repository.appLabel("com.tencent.mm") }
        assertEquals("微信", label)
    }
}
