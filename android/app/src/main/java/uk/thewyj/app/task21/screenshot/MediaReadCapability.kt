package uk.thewyj.app.task21.screenshot

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/**
 * Task 24.1 R4: how much of the device's media store this app may actually read.
 *
 * Android 14 (API 34) introduced "Selected Photos Access": the user can grant
 * [android.Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED] instead of the
 * full `READ_MEDIA_IMAGES`. In that state a `ContentObserver` still receives
 * MediaStore collection changes, but the *new* screenshot URI is not readable.
 * A collection change is therefore never evidence that a screenshot can be
 * copied - the capability has to be checked for every scan.
 *
 * `DETECT_SCREEN_CAPTURE` / `Activity.ScreenCaptureCallback` (API 34) is
 * deliberately not used here: it only reports captures of *this* app's own
 * activity and never exposes the captured image, so it cannot replace the
 * NotificationListener + MediaStore design.
 */
enum class MediaReadCapability {
    /** Full image read (`READ_MEDIA_IMAGES`, or `READ_EXTERNAL_STORAGE` <= 32). */
    FULL,

    /** Android 14+ Selected Photos Access: only user-picked items are readable. */
    LIMITED,

    /** No media read permission at all. */
    DENIED,
}

object MediaReadPolicy {
    const val READ_MEDIA_IMAGES = "android.permission.READ_MEDIA_IMAGES"
    const val READ_MEDIA_VISUAL_USER_SELECTED = "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
    const val READ_EXTERNAL_STORAGE = "android.permission.READ_EXTERNAL_STORAGE"

    /**
     * Pure capability resolution, so every API level x grant combination is
     * unit-testable without a device.
     */
    fun resolve(apiLevel: Int, granted: (String) -> Boolean): MediaReadCapability = when {
        apiLevel >= 33 -> when {
            granted(READ_MEDIA_IMAGES) -> MediaReadCapability.FULL
            // Android 14+ partial access. Never treated as readable screenshots.
            apiLevel >= 34 && granted(READ_MEDIA_VISUAL_USER_SELECTED) -> MediaReadCapability.LIMITED
            else -> MediaReadCapability.DENIED
        }
        else -> if (granted(READ_EXTERNAL_STORAGE)) MediaReadCapability.FULL else MediaReadCapability.DENIED
    }

    /** A screenshot may only be imported from MediaStore with the full grant. */
    fun allowsMediaStoreImport(capability: MediaReadCapability): Boolean =
        capability == MediaReadCapability.FULL

    /** Log line for the capture trace (never contains media content). */
    fun logStage(capability: MediaReadCapability): String = when (capability) {
        MediaReadCapability.FULL -> "media-permission-full"
        MediaReadCapability.LIMITED -> "media-permission-limited"
        MediaReadCapability.DENIED -> "media-permission-denied"
    }

    fun statusText(capability: MediaReadCapability): String = when (capability) {
        MediaReadCapability.FULL -> "已开启（可读取全部截图）"
        MediaReadCapability.LIMITED -> "仅选择了部分照片（新截图不可读取）"
        MediaReadCapability.DENIED -> "未开启"
    }

    fun current(context: Context, apiLevel: Int = Build.VERSION.SDK_INT): MediaReadCapability =
        resolve(apiLevel) { permission ->
            ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
        }

    /** Runtime permissions that produce the Android 14+ three-way photo dialog. */
    fun runtimeRequest(apiLevel: Int): Array<String> = when {
        apiLevel >= 34 -> arrayOf(READ_MEDIA_IMAGES, READ_MEDIA_VISUAL_USER_SELECTED)
        apiLevel == 33 -> arrayOf(READ_MEDIA_IMAGES)
        else -> arrayOf(READ_EXTERNAL_STORAGE)
    }
}
