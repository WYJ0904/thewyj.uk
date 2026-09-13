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
 *  - `EXTRA_PICTURE` (BigPictureStyle) and `EXTRA_LARGE_ICON_BIG` / `EXTRA_LARGE_ICON`
 *    as a bitmap;
 *  - the same fields as a content URI on builds/apps that publish a reference;
 *  - `MessagingStyle` message images, which live inside `EXTRA_MESSAGES` as a
 *    per-message `data_uri` (WeChat/chat images never appear in `EXTRA_PICTURE`);
 *  - `EXTRA_BACKGROUND_IMAGE_URI` for image backgrounds.
 *
 * The result never invents media: a key with no readable value reports
 * "unavailable" so the archive states the truth instead of dropping the record
 * or pretending the picture was stored.
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
    const val ORIGIN_LARGE_ICON = "large_icon"
    const val ORIGIN_BACKGROUND = "background"
    const val ORIGIN_MESSAGE_IMAGE = "message_image"
    const val ORIGIN_HINT = "hint"

    /** `Notification.MessagingStyle.Message` payload keys (public since API 24). */
    private const val KEY_DATA_URI = "data_uri"
    private const val KEY_DATA_MIME_TYPE = "type"

    fun extract(extras: Bundle?): NotificationMediaExtraction {
        if (extras == null) return NotificationMediaExtraction()

        val picture = bitmapOf(extras, Notification.EXTRA_PICTURE)
        val largeIconBig = bitmapOf(extras, Notification.EXTRA_LARGE_ICON_BIG)
        val largeIcon = bitmapOf(extras, Notification.EXTRA_LARGE_ICON)
        val bitmap = picture ?: largeIconBig ?: largeIcon
        if (bitmap != null) {
            return NotificationMediaExtraction(
                bitmap = bitmap,
                state = "available",
                origin = if (picture != null) ORIGIN_PICTURE else ORIGIN_LARGE_ICON,
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

        // Nothing readable, but the notification claimed a picture: keep the
        // explicit "unavailable" state instead of a silent "none".
        return if (claimsMedia(extras)) {
            NotificationMediaExtraction(state = "unavailable", origin = ORIGIN_HINT)
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

    private fun claimsMedia(extras: Bundle): Boolean = listOf(
        Notification.EXTRA_PICTURE,
        Notification.EXTRA_PICTURE_ICON,
        Notification.EXTRA_LARGE_ICON,
        Notification.EXTRA_LARGE_ICON_BIG,
        Notification.EXTRA_BACKGROUND_IMAGE_URI,
    ).any { extras.containsKey(it) } || messageBundles(extras).any { isImageMessage(it) }

    /**
     * First image reference inside a MessagingStyle conversation. Text-only
     * messages (`data_uri` absent) never produce media.
     */
    private fun messageImageUri(extras: Bundle): String? {
        for (message in messageBundles(extras)) {
            if (!isImageMessage(message)) continue
            val uri = message.getString(KEY_DATA_URI).orEmpty()
            if (uri.isNotBlank()) return uri
        }
        return null
    }

    /** A MessagingStyle message that carries an image (or an untyped reference). */
    private fun isImageMessage(message: Bundle): Boolean {
        if (!message.containsKey(KEY_DATA_URI)) return false
        if (message.getString(KEY_DATA_URI).orEmpty().isBlank()) return false
        val mime = message.getString(KEY_DATA_MIME_TYPE).orEmpty()
        return mime.isEmpty() || mime.startsWith("image/", ignoreCase = true)
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
