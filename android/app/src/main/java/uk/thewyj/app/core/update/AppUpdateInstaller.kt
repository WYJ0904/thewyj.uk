package uk.thewyj.app.core.update

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import uk.thewyj.app.core.network.AppConfig
import java.io.File
import java.security.MessageDigest

/** Everything the update UI can show. No silent states. */
sealed interface UpdateUiState {
    data object Idle : UpdateUiState
    data object Checking : UpdateUiState
    data class UpToDate(val versionName: String, val versionCode: Int) : UpdateUiState
    data class Available(val versionName: String, val versionCode: Int, val notes: String, val mandatory: Boolean) : UpdateUiState
    data class Downloading(val percent: Int, val downloadedBytes: Long, val totalBytes: Long) : UpdateUiState
    data class Verifying(val versionName: String) : UpdateUiState
    data class NeedsInstallPermission(val versionName: String) : UpdateUiState
    data class ReadyToInstall(val versionName: String) : UpdateUiState
    data class Failed(val message: String) : UpdateUiState
}

/**
 * Downloads the published APK with the system DownloadManager, verifies the
 * published SHA-256 and hands the file to the Android package installer.
 * Installation always goes through the official installer UI; nothing is
 * installed silently and no security prompt is bypassed.
 */
class AppUpdateInstaller(private val context: Context) {

    private val downloadManager: DownloadManager
        get() = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

    fun canInstallPackages(): Boolean = context.packageManager.canRequestPackageInstalls()

    fun installPermissionIntent(): Intent =
        Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun updateDirectory(): File = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "updates").apply { mkdirs() }

    fun fileNameFor(config: AppConfig): String =
        config.apkFileName.takeIf { it.isNotBlank() }?.replace(Regex("[^A-Za-z0-9._-]"), "_")
            ?: "thewyj-android-${config.latestVersionName}.apk"

    fun localApk(config: AppConfig): File = File(updateDirectory(), fileNameFor(config))

    fun enqueueDownload(config: AppConfig): Long {
        val fileName = fileNameFor(config)
        val target = File(updateDirectory(), fileName)
        if (target.exists()) target.delete()
        val request = DownloadManager.Request(Uri.parse(config.downloadUrl))
            .setMimeType("application/vnd.android.package-archive")
            .setTitle("thewyj ${config.latestVersionName}")
            .setDescription("正在下载官方安装包")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, "updates/$fileName")
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(true)
        return downloadManager.enqueue(request)
    }

    data class DownloadProgress(val downloadedBytes: Long, val totalBytes: Long, val status: Int) {
        val finished: Boolean get() = status == DownloadManager.STATUS_SUCCESSFUL
        val failed: Boolean get() = status == DownloadManager.STATUS_FAILED
    }

    fun progress(downloadId: Long): DownloadProgress? {
        val query = DownloadManager.Query().setFilterById(downloadId)
        val cursor = runCatching { downloadManager.query(query) }.getOrNull() ?: return null
        cursor.use {
            if (!it.moveToFirst()) return null
            val downloaded = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
            val total = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
            val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            return DownloadProgress(downloaded, total, status)
        }
    }

    suspend fun awaitDownload(downloadId: Long, onProgress: (UpdateUiState.Downloading) -> Unit): Boolean {
        while (true) {
            val progress = progress(downloadId) ?: return false
            val total = progress.totalBytes.coerceAtLeast(1)
            val percent = ((progress.downloadedBytes * 100) / total).toInt().coerceIn(0, 100)
            onProgress(UpdateUiState.Downloading(percent, progress.downloadedBytes, progress.totalBytes))
            if (progress.finished) return true
            if (progress.failed) return false
            delay(400)
        }
    }

    suspend fun verify(config: AppConfig): Boolean {
        val expected = config.apkSha256.lowercase().trim()
        if (expected.length != 64) return true
        val file = localApk(config)
        if (!file.isFile) return false
        val digest = withContext(Dispatchers.IO) { sha256(file) }
        return digest.equals(expected, ignoreCase = true)
    }

    fun installIntent(config: AppConfig): Intent {
        val file = localApk(config)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        return Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { stream ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = stream.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
