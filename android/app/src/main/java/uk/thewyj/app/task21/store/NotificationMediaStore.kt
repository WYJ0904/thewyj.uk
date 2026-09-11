package uk.thewyj.app.task21.store

import android.content.Context
import android.graphics.Bitmap
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

/**
 * Local-only storage for the pictures Android already exposes on a notification
 * (BigPictureStyle, large icon, screenshot thumbnail).
 *
 * Task 24.1 P0-1: image/screenshot notifications used to disappear from history
 * entirely. The archive now always keeps the notification record, and this store
 * keeps the bitmap when the payload contains one. Nothing here is uploaded: the
 * files live in the app's private storage next to the notification database.
 */
data class NotificationMediaRef(
    /** Path relative to [NotificationMediaStore.rootDirectory]. */
    val relativePath: String,
    val mimeType: String,
    val sizeBytes: Long,
)

class NotificationMediaStore(private val context: Context) {
    private val root: File get() = rootDirectory(context)

    /** PNG/JPEG bytes for one capture, or null when the bitmap cannot be stored. */
    fun save(accountId: String, identity: String, bitmap: Bitmap?): NotificationMediaRef? {
        val source = bitmap ?: return null
        if (source.width <= 0 || source.height <= 0) return null
        return runCatching {
            val account = safeSegment(accountId)
            val directory = File(root, account).apply { mkdirs() }
            val name = digest(identity) + ".jpg"
            val target = File(directory, name)
            val scaled = scaleDown(source, MAX_DIMENSION)
            FileOutputStream(target).use { output ->
                scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)
                output.fd.sync()
            }
            if (scaled !== source) scaled.recycle()
            enforceQuota(account)
            NotificationMediaRef(
                relativePath = account + "/" + name,
                mimeType = "image/jpeg",
                sizeBytes = target.length(),
            )
        }.getOrNull()
    }

    fun file(relativePath: String): File? {
        if (relativePath.isBlank() || relativePath.contains("..")) return null
        val target = File(root, relativePath)
        return target.takeIf { it.isFile }
    }

    /** Deletes one stored picture; used when its snapshot is deleted or expires. */
    fun delete(relativePath: String): Boolean {
        val target = file(relativePath) ?: return false
        return target.delete()
    }

    fun deleteAll(relativePaths: Collection<String>): Int =
        relativePaths.distinct().count { delete(it) }

    private fun enforceQuota(accountSegment: String) {
        val directory = File(root, accountSegment)
        val files = directory.listFiles()?.sortedBy { it.lastModified() } ?: return
        var total = files.sumOf { it.length() }
        if (total <= MAX_ACCOUNT_BYTES) return
        for (file in files) {
            if (total <= MAX_ACCOUNT_BYTES) break
            val size = file.length()
            if (file.delete()) total -= size
        }
    }

    private fun scaleDown(bitmap: Bitmap, maximum: Int): Bitmap {
        val longest = maxOf(bitmap.width, bitmap.height)
        if (longest <= maximum) return bitmap
        val ratio = maximum.toFloat() / longest
        return Bitmap.createScaledBitmap(
            bitmap,
            (bitmap.width * ratio).toInt().coerceAtLeast(1),
            (bitmap.height * ratio).toInt().coerceAtLeast(1),
            true,
        )
    }

    private fun digest(value: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }.take(32)
    }

    private fun safeSegment(value: String): String =
        value.replace(Regex("""[^A-Za-z0-9._-]"""), "_").take(80).ifBlank { "account" }

    companion object {
        const val MAX_DIMENSION = 1080
        const val JPEG_QUALITY = 88
        /** Per-account cap; oldest pictures are removed first. */
        const val MAX_ACCOUNT_BYTES = 200L * 1024 * 1024

        fun rootDirectory(context: Context): File = File(context.filesDir, "notification-media")
    }
}
