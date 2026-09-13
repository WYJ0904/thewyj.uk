package uk.thewyj.app.task21

import android.app.Notification
import android.graphics.Bitmap
import android.os.Bundle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.screenshot.ScreenshotEvidence

/**
 * Task 24 reopen #6: every way Android can hand a notification picture to the
 * listener is covered by a fixture, and every outcome is an honest media state
 * the archive can store (never an invented picture, never a silently dropped
 * notification).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotificationMediaExtractorTest {
    private fun bitmap(width: Int = 4, height: Int = 4): Bitmap =
        Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)

    private fun messageBundles(vararg messages: Bundle): ArrayList<Bundle> =
        ArrayList(messages.toList())

    private fun message(text: String, dataUri: String = "", mime: String = ""): Bundle = Bundle().apply {
        putCharSequence("text", text)
        if (dataUri.isNotBlank()) putString("data_uri", dataUri)
        if (mime.isNotBlank()) putString("type", mime)
    }

    @Test fun bigPictureStyleBitmapIsArchived() {
        val extras = Bundle().apply { putParcelable(Notification.EXTRA_PICTURE, bitmap(12, 7)) }
        val media = NotificationMediaExtractor.extract(extras)
        assertEquals("available", media.state)
        assertEquals(NotificationMediaExtractor.ORIGIN_PICTURE, media.origin)
        assertNotNull(media.bitmap)
        assertEquals(12, media.bitmap!!.width)
    }

    @Test fun largeIconIsArchivedWhenItIsTheOnlyPicture() {
        val extras = Bundle().apply { putParcelable(Notification.EXTRA_LARGE_ICON, bitmap()) }
        val media = NotificationMediaExtractor.extract(extras)
        assertEquals("available", media.state)
        assertEquals(NotificationMediaExtractor.ORIGIN_LARGE_ICON, media.origin)
        assertNotNull(media.bitmap)
    }

    @Test fun picturePublishedAsAReferenceKeepsTheUri() {
        val extras = Bundle().apply {
            putString(Notification.EXTRA_PICTURE, "content://media/external/images/media/42")
        }
        val media = NotificationMediaExtractor.extract(extras)
        assertEquals("available", media.state)
        assertEquals("content://media/external/images/media/42", media.sourceUri)
        assertNull(media.bitmap)
        assertEquals(
            ScreenshotEvidence.uriFingerprint("content://media/external/images/media/42"),
            NotificationMediaExtractor.uriFingerprint(media),
        )
    }

    @Test fun messagingStyleImageIsFoundInsideTheConversation() {
        val extras = Bundle().apply {
            putParcelableArrayList(
                Notification.EXTRA_MESSAGES,
                messageBundles(
                    message("晚上一起吃饭吗"),
                    message("", dataUri = "content://media/external/images/media/7", mime = "image/jpeg"),
                ),
            )
        }
        val media = NotificationMediaExtractor.extract(extras)
        assertEquals("available", media.state)
        assertEquals(NotificationMediaExtractor.ORIGIN_MESSAGE_IMAGE, media.origin)
        assertEquals("content://media/external/images/media/7", media.sourceUri)
    }

    /** A text-only MessagingStyle conversation carries no media at all. */
    @Test fun messagingStyleWithoutImageIsNoMedia() {
        val extras = Bundle().apply {
            putParcelableArrayList(
                Notification.EXTRA_MESSAGES,
                messageBundles(message("第一条"), message("第二条")),
            )
        }
        val media = NotificationMediaExtractor.extract(extras)
        assertEquals("none", media.state)
        assertTrue(media.sourceUri.isBlank())
        assertNull(media.bitmap)
    }

    /** A non-image attachment (video/file) is not a picture for the archive. */
    @Test fun messagingStyleNonImageAttachmentIsNoMedia() {
        val extras = Bundle().apply {
            putParcelableArrayList(
                Notification.EXTRA_MESSAGES,
                messageBundles(message("", dataUri = "content://media/external/video/media/1", mime = "video/mp4")),
            )
        }
        assertEquals("none", NotificationMediaExtractor.extract(extras).state)
    }

    @Test fun menuWithoutMediaIsNoMedia() {
        val extras = Bundle().apply { putCharSequence(Notification.EXTRA_TEXT, "普通通知") }
        val media = NotificationMediaExtractor.extract(extras)
        assertEquals("none", media.state)
        assertNull(media.bitmap)
    }

    @Test fun missingExtrasIsNoMedia() {
        assertEquals("none", NotificationMediaExtractor.extract(null).state)
    }

    /**
     * Android sometimes publishes the picture key with a value we may not read
     * (permission revoked, app-private store, a null bitmap). The archive must
     * record "unavailable" instead of pretending there was no media.
     */
    @Test fun pictureKeyWeCannotReadIsUnavailable() {
        val nullPicture = Bundle().apply { putParcelable(Notification.EXTRA_PICTURE, null) }
        assertEquals("unavailable", NotificationMediaExtractor.extract(nullPicture).state)

        val usable = Bundle().apply { putParcelable(Notification.EXTRA_LARGE_ICON_BIG, bitmap()) }
        assertEquals("available", NotificationMediaExtractor.extract(usable).state)
    }

    /** The background image reference is media too. */
    @Test fun backgroundImageReferenceIsMedia() {
        val extras = Bundle().apply {
            putString(Notification.EXTRA_BACKGROUND_IMAGE_URI, "content://media/external/images/media/99")
        }
        val media = NotificationMediaExtractor.extract(extras)
        assertEquals(NotificationMediaExtractor.ORIGIN_BACKGROUND, media.origin)
        assertEquals("available", media.state)
    }
}
