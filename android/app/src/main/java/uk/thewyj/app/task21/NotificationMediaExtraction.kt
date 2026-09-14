package uk.thewyj.app.task21

import android.app.Notification
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Parcelable
import uk.thewyj.app.task21.screenshot.ScreenshotEvidence

/**
 * Task 24 reopen #6: what picture did this notification actually carry?
 *
 * Android exposes notification media in several places and the archive has to
 * understand all of them, not just `EXTRA_PICTURE`:
 *  - `EXTRA_PICTURE` (BigPictureStyle) as a bitmap;
 *  - the same fields as a content URI on builds/apps that publish a reference;
 *  - `MessagingStyle` message images, which live inside `EXTRA_MESSAGES` as a
 *    per-message `data_uri` (WeChat/chat images never appear in `EXTRA_PICTURE`);
 *  - `EXTRA_BACKGROUND_IMAGE_URI` for image backgrounds.
 *
 * `EXTRA_LARGE_ICON`, `EXTRA_LARGE_ICON_BIG`, conversation icons and
 * `MessagingStyle.Person.icon` are identity/avatar chrome, not message
 * attachments. Treating them as content made ordinary text messages claim
 * "图片内容不可用" (and could display a contact avatar as if it were the sent
 * image). The result therefore only reports media when the notification carries
 * an explicit content-image field.
 */
data class NotificationMediaExtraction(
    val bitmap: Bitmap? = null,
    /** Content URI Android published for the picture, or "" when there is none. */
    val sourceUri: String = "",
    /** none | available | unavailable */
    val state: String = "none",
    /** Payload field the media came from (trace/regression only). */
    val origin: String = "none",
)

object NotificationMediaExtractor {
    const val ORIGIN_NONE = "none"
    const val ORIGIN_PICTURE = "picture"
    const val ORIGIN_BACKGROUND = "background"
    const val ORIGIN_MESSAGE_IMAGE = "message_image"
    const val ORIGIN_HINT = "hint"

    /** `Notification.MessagingStyle.Message` payload keys (public since API 24). */
    private const val KEY_DATA_URI = "data_uri"
    private const val KEY_DATA_MIME_TYPE = "type"

    fun extract(extras: Bundle?): NotificationMediaExtraction {
        if (extras == null) return NotificationMediaExtraction()

        val picture = bitmapOf(extras, Notification.EXTRA_PICTURE)
        if (picture != null) {
            return NotificationMediaExtraction(
                bitmap = picture,
                state = "available",
                origin = ORIGIN_PICTURE,
            )
        }

        uriOf(extras, Notification.EXTRA_PICTURE)?.let { uri ->
            return NotificationMediaExtraction(sourceUri = uri, state = "available", origin = ORIGIN_PICTURE)
        }
        uriOf(extras, Notification.EXTRA_PICTURE_ICON)?.let { uri ->
            return NotificationMediaExtraction(sourceUri = uri, state = "available", origin = ORIGIN_PICTURE)
        }
        uriOf(extras, Notification.EXTRA_BACKGROUND_IMAGE_URI)?.let { uri ->
            return NotificationMediaExtraction(sourceUri = uri, state = "available", origin = ORIGIN_BACKGROUND)
        }
        messageImageUri(extras)?.let { uri ->
            return NotificationMediaExtraction(sourceUri = uri, state = "available", origin = ORIGIN_MESSAGE_IMAGE)
        }

        // Nothing readable, but an explicit content field claimed a picture:
        // keep the honest "unavailable" state. Avatar/icon-only notifications
        // deliberately fall through to "none".
        val claimedOrigin = claimedContentOrigin(extras)
        return if (claimedOrigin != null) {
            NotificationMediaExtraction(state = "unavailable", origin = claimedOrigin)
        } else {
            NotificationMediaExtraction()
        }
    }

    /** Evidence fingerprint for a media reference; the imported bitmap gets its own. */
    fun uriFingerprint(extraction: NotificationMediaExtraction): String =
        if (extraction.sourceUri.isBlank()) "" else ScreenshotEvidence.uriFingerprint(extraction.sourceUri)

    private fun bitmapOf(extras: Bundle, key: String): Bitmap? =
        runCatching { extras.get(key) as? Bitmap }.getOrNull()

    private fun uriOf(extras: Bundle, key: String): String? {
        if (!extras.containsKey(key)) return null
        val value = runCatching { extras.get(key) }.getOrNull() ?: return null
        val uri = when (value) {
            is android.net.Uri -> value.toString()
            is CharSequence -> value.toString()
            else -> ""
        }
        return uri.takeIf { it.isNotBlank() }
    }

    private fun claimedContentOrigin(extras: Bundle): String? = when {
        extras.containsKey(Notification.EXTRA_PICTURE) ||
            extras.containsKey(Notification.EXTRA_PICTURE_ICON) -> ORIGIN_PICTURE
        extras.containsKey(Notification.EXTRA_BACKGROUND_IMAGE_URI) -> ORIGIN_BACKGROUND
        messageBundles(extras).any { claimsImageMessage(it) } -> ORIGIN_MESSAGE_IMAGE
        else -> null
    }

    /**
     * First image reference inside a MessagingStyle conversation. Text-only
     * messages (`data_uri` absent) never produce media.
     */
    private fun messageImageUri(extras: Bundle): String? {
        for (message in messageBundles(extras)) {
            if (!claimsImageMessage(message)) continue
            val uri = message.getString(KEY_DATA_URI).orEmpty()
            if (uri.isNotBlank()) return uri
        }
        return null
    }

    /** A MessagingStyle message that carries, or explicitly claims, an image. */
    private fun claimsImageMessage(message: Bundle): Boolean {
        val uri = message.getString(KEY_DATA_URI).orEmpty()
        val mime = message.getString(KEY_DATA_MIME_TYPE).orEmpty()
        if (mime.startsWith("image/", ignoreCase = true)) return true
        return uri.isNotBlank() && mime.isEmpty()
    }

    private fun messageBundles(extras: Bundle): List<Bundle> {
        val array = runCatching {
            @Suppress("DEPRECATION")
            extras.getParcelableArray(Notification.EXTRA_MESSAGES)
        }.getOrNull()
        val fromArray = array?.mapNotNull { it as? Bundle }.orEmpty()
        if (fromArray.isNotEmpty()) return fromArray
        val list = runCatching {
            @Suppress("DEPRECATION")
            extras.getParcelableArrayList<Parcelable>(Notification.EXTRA_MESSAGES)
        }.getOrNull()
        return list?.mapNotNull { it as? Bundle }.orEmpty()
    }
}

/**
 * Presentation guard for rows written before media origins were recorded.
 *
 * Older builds marked any unreadable large/contact icon as notification media.
 * Those rows have an empty origin. Keep explicit historical image messages and
 * screenshots visible, but do not keep showing an avatar-related warning on
 * ordinary text messages after an in-place upgrade.
 */
object NotificationMediaPresentation {
    private val CONTENT_ORIGINS = setOf(
        NotificationMediaExtractor.ORIGIN_PICTURE,
        NotificationMediaExtractor.ORIGIN_BACKGROUND,
        NotificationMediaExtractor.ORIGIN_MESSAGE_IMAGE,
        "notification",
        "media_store",
        "media_store+notification",
    )

    fun shouldPresent(
        mediaState: String,
        mediaOrigin: String,
        title: String,
        text: String,
        bigText: String,
    ): Boolean {
        if (mediaState !in setOf("available", "unavailable")) return false
        if (mediaOrigin in CONTENT_ORIGINS) return true
        val legacyText = listOf(title, text, bigText).joinToString(" ").trim().lowercase()
        return legacyText == "图片" || legacyText == "照片" ||
            legacyText.contains("[图片]") || legacyText.contains("[照片]") ||
            legacyText.contains("屏幕截图已保存") || legacyText.contains("screenshot saved")
    }
}
