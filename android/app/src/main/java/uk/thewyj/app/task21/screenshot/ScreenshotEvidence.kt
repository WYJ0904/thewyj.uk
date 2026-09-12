package uk.thewyj.app.task21.screenshot

import java.security.MessageDigest
import java.util.Locale

/**
 * Pure identity rules for screenshot archiving.
 *
 * Real-device evidence (Samsung / One UI): taking a second screenshot replaces
 * the single "截图已保存" notification *in place* - same notification key, same
 * text - so an archive keyed only on the platform notification identity silently
 * merged every later screenshot into the first one. Screenshots therefore get
 * their own evidence identity, with the priority the device can actually prove:
 *
 * 1. MediaStore row id (`ms:<rowId>`) - the authoritative screenshot identity.
 * 2. Content URI (`uri:<sha>`) - when the row id is unknown but the URI is not.
 * 3. Image content fingerprint (`nfb:<sha>`) - sampled pixels of the bitmap the
 *    notification exposed (or the imported file).
 * 4. Auxiliary slot (`aux:<package>:<time>`) - last resort for a screenshot
 *    notification with no readable media at all. Only used to pair a degraded
 *    notification entry with its MediaStore row inside the merge window.
 */
enum class ScreenshotLinkAction {
    /** Nothing with this evidence exists yet: archive a new event. */
    NEW_EVENT,

    /** The same screenshot was already archived (replay / observer + listener). */
    DUPLICATE,

    /** Same screenshot, other origin: attach the missing evidence, keep one row. */
    MERGE,
}

/** Outcome of one MediaStore screenshot import, used for real-state logging. */
enum class ScreenshotArchiveOutcome {
    /** A new archive event was written. */
    STORED,

    /** The same screenshot was already archived through the notification path. */
    MERGED,

    /** This exact evidence was already archived (observer replay / reconnect). */
    DUPLICATE,

    /** No archive happened (permission missing, disabled app, empty input). */
    SKIPPED,

    /** The archive exists but its picture could not be imported. */
    FAILED,
}

enum class ScreenshotMediaOrigin {
    NONE,
    NOTIFICATION,
    MEDIA_STORE,
    MERGED,
    ;

    val wireValue: String
        get() = when (this) {
            NONE -> ""
            NOTIFICATION -> "notification"
            MEDIA_STORE -> "media_store"
            MERGED -> "media_store+notification"
        }

    companion object {
        fun fromWire(value: String): ScreenshotMediaOrigin = when (value) {
            "notification" -> NOTIFICATION
            "media_store" -> MEDIA_STORE
            "media_store+notification" -> MERGED
            else -> NONE
        }
    }
}

object ScreenshotEvidence {
    const val NOTIFICATION_PREFIX = "nfb:"
    const val MEDIA_STORE_PREFIX = "ms:"
    const val URI_PREFIX = "uri:"
    const val AUX_PREFIX = "aux:"

    /** A notification callback and its MediaStore row are at most this far apart. */
    const val MERGE_WINDOW_MS = 150_000L

    /** Samples per axis for the bitmap fingerprint (fast, stable, non-reversible). */
    const val FINGERPRINT_GRID = 8

    /**
     * Screenshot packages. Samsung ships the capture UI in `smartcapture`; the
     * other entries cover AOSP/older One UI and keep the detector honest on a
     * non-Samsung device.
     */
    private val SCREENSHOT_PACKAGES = setOf(
        "com.samsung.android.app.smartcapture",
        "com.sec.android.app.smartcapture",
        "com.samsung.android.screenshot",
        "com.android.systemui.screenshot",
        "com.android.systemui",
    )

    private val SCREENSHOT_CHANNEL_MARKERS = listOf("screenshot", "screen_capture", "screen-capture", "smartcapture")
    private val SCREENSHOT_TEXT_MARKERS = listOf("截图", "截屏", "screenshot", "screen capture", "captura de pantalla")

    fun mediaStoreFingerprint(rowId: Long): String = MEDIA_STORE_PREFIX + rowId

    fun isMediaStoreFingerprint(fingerprint: String): Boolean = fingerprint.startsWith(MEDIA_STORE_PREFIX)

    fun isNotificationFingerprint(fingerprint: String): Boolean = fingerprint.startsWith(NOTIFICATION_PREFIX)

    fun uriFingerprint(uri: String): String {
        val normalized = uri.trim().lowercase(Locale.ROOT)
        if (normalized.isEmpty()) return ""
        return URI_PREFIX + sha256(normalized).take(32)
    }

    /**
     * Fingerprint of a bitmap's shape + sampled pixels. The sample grid is
     * deterministic, so the same screenshot thread (notification replay,
     * listener reconnect, observer import) resolves to the same value.
     */
    fun bitmapFingerprint(width: Int, height: Int, sampledArgb: IntArray): String {
        if (width <= 0 || height <= 0 || sampledArgb.isEmpty()) return ""
        val canonical = StringBuilder("${width}x$height")
        sampledArgb.forEach { value -> canonical.append(':').append(value) }
        return NOTIFICATION_PREFIX + sha256(canonical.toString()).take(32)
    }

    /**
     * Last-resort identity for a screenshot notification whose media could not
     * be read. Uses the platform timestamps that change when One UI replaces the
     * notification, so two different screenshots never collapse into one row.
     */
    fun auxiliaryIdentity(sourcePackage: String, whenMs: Long, postTimeMs: Long): String {
        val stamp = when {
            whenMs > 0 -> whenMs
            postTimeMs > 0 -> postTimeMs
            else -> 0L
        }
        if (stamp <= 0) return ""
        return "$AUX_PREFIX${sourcePackage.lowercase(Locale.ROOT)}:$stamp"
    }

    /** Archive identity for one screenshot event. */
    fun archiveIdentity(fingerprint: String, auxiliary: String): String = when {
        fingerprint.startsWith(MEDIA_STORE_PREFIX) -> "shot:$fingerprint"
        fingerprint.startsWith(NOTIFICATION_PREFIX) -> "shot:$fingerprint"
        fingerprint.startsWith(URI_PREFIX) -> "shot:$fingerprint"
        auxiliary.isNotBlank() -> "shot:$auxiliary"
        else -> ""
    }

    /** True when this notification is a system screenshot notice. */
    fun isScreenshotEvent(
        sourcePackage: String,
        channelId: String,
        title: String,
        text: String,
        bigText: String,
        hasMedia: Boolean,
    ): Boolean {
        val packageName = sourcePackage.trim().lowercase(Locale.ROOT)
        if (packageName.isNotEmpty() && SCREENSHOT_PACKAGES.contains(packageName)) return true
        val channel = channelId.lowercase(Locale.ROOT)
        if (SCREENSHOT_CHANNEL_MARKERS.any { channel.contains(it) }) return true
        val haystack = (title + " " + text + " " + bigText).lowercase(Locale.ROOT)
        if (SCREENSHOT_TEXT_MARKERS.any { haystack.contains(it) }) return true
        // A picture-only system notification is not automatically a screenshot;
        // media alone must never invent screenshot semantics.
        return false
    }

    /**
     * What the archive should do with one piece of screenshot evidence.
     *
     * [sameEvidenceArchived] = this exact fingerprint already exists;
     * [unlinkedCounterpartInWindow] = the other origin archived the same
     * screenshot but has no link yet.
     */
    fun decide(
        sameEvidenceArchived: Boolean,
        unlinkedCounterpartInWindow: Boolean,
    ): ScreenshotLinkAction = when {
        sameEvidenceArchived -> ScreenshotLinkAction.DUPLICATE
        unlinkedCounterpartInWindow -> ScreenshotLinkAction.MERGE
        else -> ScreenshotLinkAction.NEW_EVENT
    }

    fun isWithinMergeWindow(eventAtMs: Long, candidateAtMs: Long): Boolean {
        if (eventAtMs <= 0 || candidateAtMs <= 0) return false
        return kotlin.math.abs(eventAtMs - candidateAtMs) <= MERGE_WINDOW_MS
    }

    private fun sha256(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}
