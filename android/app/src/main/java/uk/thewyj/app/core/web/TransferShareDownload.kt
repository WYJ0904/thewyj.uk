package uk.thewyj.app.core.web

import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.widget.Toast
import java.io.Closeable
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Only a public share's same-origin, tokenized file endpoint may write Downloads. */
internal object TransferShareDownloadUrl {
    private val sharePath = Regex("^/api/transfer/shares/[A-Za-z0-9_-]{16,80}/download$")
    private val fileId = Regex("^[A-Za-z0-9_-]{16,80}$")
    private val grant = Regex("^[A-Za-z0-9_-]{16,256}$")

    fun accepts(rawUrl: String, baseUrl: String): Boolean {
        val uri = runCatching { URI(rawUrl) }.getOrNull() ?: return false
        val base = runCatching { URI(baseUrl) }.getOrNull() ?: return false
        if (!uri.scheme.equals("https", true) || uri.userInfo != null || uri.rawFragment != null) return false
        if (!uri.host.equals(base.host, true) || (uri.port.takeIf { it > 0 } ?: 443) !=
            (base.port.takeIf { it > 0 } ?: 443)) return false
        if (!sharePath.matches(uri.rawPath.orEmpty())) return false
        val parts = uri.rawQuery?.split('&')?.map { it.split('=', limit = 2) } ?: return false
        if (parts.size != 2 || parts.any { it.size != 2 }) return false
        val fields = parts.associate { it[0] to it[1] }
        return fields.size == 2 && fields.keys == setOf("file", "grant") &&
            fileId.matches(fields["file"].orEmpty()) && grant.matches(fields["grant"].orEmpty())
    }
}

internal data class TransferDownloadStatus(
    val state: String,
    val bytes: Long,
    val total: Long,
    val message: String,
)

internal interface TransferRangeResponse : Closeable {
    val status: Int
    val contentRange: String
    val contentLength: Long
    val input: InputStream
}

private class TransferHttpFailure(val code: Int) : IOException("HTTP $code") {
    val retryable: Boolean get() = code == 409 || code >= 500
}

private class TransferIntegrityFailure(message: String) : IOException(message)
private class TransferWriteFailure(cause: IOException) : IOException("download destination failed", cause)

private val CONTENT_RANGE = Regex("^bytes (\\d+)-(\\d+)/(\\d+)$")
private const val RANGE_BYTES = 8L * 1024 * 1024
private const val MAX_DOWNLOAD_BYTES = 5L * 1024 * 1024 * 1024

/** Copies bounded ranges and resumes from the last byte actually written. */
internal fun copyTransferRanges(
    total: Long,
    destination: OutputStream,
    openRange: (Long, Long) -> TransferRangeResponse,
    chunkBytes: Long = RANGE_BYTES,
    onProgress: (Long, Long) -> Unit = { _, _ -> },
): Long {
    require(total in 1..MAX_DOWNLOAD_BYTES && chunkBytes > 0)
    val buffer = ByteArray(256 * 1024)
    var offset = 0L
    while (offset < total) {
        val end = minOf(total - 1, offset + chunkBytes - 1)
        var attempts = 0
        while (offset <= end) {
            val start = offset
            attempts += 1
            try {
                openRange(start, end).use { response ->
                    if (response.status != 206) throw TransferHttpFailure(response.status)
                    val match = CONTENT_RANGE.matchEntire(response.contentRange)
                        ?: throw TransferIntegrityFailure("missing Content-Range")
                    val actualStart = match.groupValues[1].toLongOrNull()
                    val actualEnd = match.groupValues[2].toLongOrNull()
                    val actualTotal = match.groupValues[3].toLongOrNull()
                    if (actualStart != start || actualEnd != end || actualTotal != total ||
                        (response.contentLength > 0 && response.contentLength != end - start + 1)) {
                        throw TransferIntegrityFailure("download range mismatch")
                    }
                    while (offset <= end) {
                        val count = minOf(buffer.size.toLong(), end - offset + 1).toInt()
                        val read = response.input.read(buffer, 0, count)
                        if (read <= 0) throw EOFException("download range ended early")
                        try { destination.write(buffer, 0, read) }
                        catch (error: IOException) { throw TransferWriteFailure(error) }
                        offset += read
                    }
                }
            } catch (error: Exception) {
                if (error is TransferIntegrityFailure || error is TransferWriteFailure ||
                    (error is TransferHttpFailure && !error.retryable) || attempts >= 3) throw error
                Thread.sleep(attempts * 500L)
            }
        }
        onProgress(offset, total)
    }
    return offset
}

/** Keeps incomplete bytes hidden in MediaStore until the full transfer is verified. */
internal class TransferShareDownloader(
    private val context: Context,
    private val onStatus: (TransferDownloadStatus) -> Unit,
) {
    companion object {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        private val active = ConcurrentHashMap.newKeySet<String>()
    }

    private val main = Handler(Looper.getMainLooper())

    fun start(url: String, name: String, mimeType: String, contentLength: Long, userAgent: String) {
        if (!active.add(url)) {
            emit(TransferDownloadStatus("started", 0, contentLength, "文件正在下载"))
            return
        }
        emit(TransferDownloadStatus("started", 0, contentLength, "正在下载 $name"))
        scope.launch {
            try {
                val size = save(url, name, mimeType, userAgent)
                emit(TransferDownloadStatus("completed", size, size, "下载完成，请在系统 Downloads 中查看"), toast = true)
            } catch (error: Exception) {
                val message = when (error) {
                    is TransferHttpFailure -> "下载服务返回 HTTP ${error.code}；未保存不完整文件"
                    else -> "下载中断或校验失败；未保存不完整文件"
                }
                emit(TransferDownloadStatus("failed", 0, contentLength, message), toast = true)
            } finally {
                active.remove(url)
            }
        }
    }

    private fun emit(status: TransferDownloadStatus, toast: Boolean = false) {
        main.post {
            runCatching { onStatus(status) }
            if (toast) Toast.makeText(context, status.message, Toast.LENGTH_LONG).show()
        }
    }

    private fun save(url: String, name: String, mimeType: String, userAgent: String): Long {
        // DownloadListener may report only WebView's initial media Range. The
        // server's Content-Range total is the full published file size.
        val total = probeSize(url, userAgent)
        if (total !in 1..MAX_DOWNLOAD_BYTES) throw TransferIntegrityFailure("download size invalid")
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType.ifBlank { "application/octet-stream" })
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val target = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("cannot create download")
        try {
            val output = resolver.openOutputStream(target, "w") ?: throw IOException("cannot open download")
            output.use { stream ->
                val written = copyTransferRanges(total, stream, { start, end ->
                    openRange(url, start, end, userAgent)
                }, onProgress = { bytes, size ->
                    emit(TransferDownloadStatus("progress", bytes, size, "正在下载"))
                })
                if (written != total) throw TransferIntegrityFailure("download size mismatch")
                stream.flush()
            }
            val published = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
            if (resolver.update(target, published, null, null) != 1) throw IOException("cannot publish download")
            return total
        } catch (error: Exception) {
            runCatching { resolver.delete(target, null, null) }
            throw error
        }
    }

    private fun probeSize(url: String, userAgent: String): Long {
        openRange(url, 0, 0, userAgent).use { response ->
            if (response.status != 206) throw TransferHttpFailure(response.status)
            val match = CONTENT_RANGE.matchEntire(response.contentRange)
                ?: throw TransferIntegrityFailure("missing Content-Range")
            if (match.groupValues[1] != "0" || match.groupValues[2] != "0") {
                throw TransferIntegrityFailure("download size probe mismatch")
            }
            return match.groupValues[3].toLongOrNull()
                ?: throw TransferIntegrityFailure("download size invalid")
        }
    }

    private fun openRange(url: String, start: Long, end: Long, userAgent: String): TransferRangeResponse {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.setRequestProperty("Range", "bytes=$start-$end")
        connection.setRequestProperty("Accept-Encoding", "identity")
        if (userAgent.isNotBlank()) connection.setRequestProperty("User-Agent", userAgent)
        val status = try { connection.responseCode } catch (error: Exception) {
            connection.disconnect()
            throw error
        }
        if (status != 206) {
            connection.disconnect()
            throw TransferHttpFailure(status)
        }
        val input = try { connection.inputStream } catch (error: Exception) {
            connection.disconnect()
            throw error
        }
        return object : TransferRangeResponse {
            override val status: Int = status
            override val contentRange: String = connection.getHeaderField("Content-Range").orEmpty()
            override val contentLength: Long = connection.contentLengthLong
            override val input: InputStream = input
            override fun close() {
                try { input.close() } finally { connection.disconnect() }
            }
        }
    }
}
