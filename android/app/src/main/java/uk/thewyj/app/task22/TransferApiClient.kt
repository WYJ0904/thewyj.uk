package uk.thewyj.app.task22

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import uk.thewyj.app.BuildConfig
import uk.thewyj.app.core.auth.DeviceIdentityStore
import uk.thewyj.app.core.auth.SecureCredentialStore
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

class TransferApiException(message: String, val status: Int, val code: String) : Exception(message)

/** Raised when the user pauses an upload while a part is in flight. */
class TransferUploadPausedException : Exception("上传已暂停")

class TransferApiClient(context: Context) {
    private val credentialStore = SecureCredentialStore(context.applicationContext)
    private val deviceIdentity = DeviceIdentityStore(context.applicationContext)
    private val baseUrl = BuildConfig.THEWYJ_BASE_URL.trimEnd('/')

    private fun credentials(): Pair<String, String>? {
        val active = runCatching { credentialStore.loadActive() }.getOrNull() ?: return null
        if (active.accessToken.isBlank()) return null
        return active.accessToken to active.account.id
    }

    fun authenticatedAccountId(): String? = credentials()?.second

    private fun open(path: String, method: String, token: String, contentType: String? = null): HttpURLConnection {
        val connection = URL(baseUrl + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.setRequestProperty("X-Session-Token", token)
        if (contentType != null) connection.setRequestProperty("Content-Type", contentType)
        return connection
    }

    private fun readError(connection: HttpURLConnection, fallback: String): TransferApiException {
        val body = runCatching {
            connection.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        }.getOrDefault("")
        val code = runCatching { JSONObject(body).optString("code", "transfer_failed") }.getOrDefault("transfer_failed")
        val message = runCatching { JSONObject(body).optString("error", fallback) }.getOrDefault(fallback)
        return TransferApiException(message, connection.responseCode, code)
    }

    private fun executeJson(connection: HttpURLConnection, body: JSONObject?): JSONObject {
        return try {
            if (body != null) {
                connection.doOutput = true
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "{}"
            val payload = JSONObject(text)
            if (status !in 200..299) {
                throw TransferApiException(payload.optString("error", "请求失败"), status, payload.optString("code", "transfer_failed"))
            }
            payload
        } finally {
            connection.disconnect()
        }
    }

    private fun withAuth(block: (String) -> JSONObject): JSONObject {
        val (token, _) = credentials() ?: throw TransferApiException("登录会话需要恢复", 401, "authentication_required")
        return block(token)
    }

    fun createSession(
        minutes: Int,
        maxDownloads: Int,
        oneTime: Boolean,
        password: String,
        fileCount: Int,
        totalBytes: Long,
    ): TransferSession {
        val payload = withAuth { token ->
            val body = JSONObject()
                .put("minutes", minutes)
                .put("max_downloads", maxDownloads)
                .put("one_time", oneTime)
                .put("password", password)
                .put("file_count", fileCount)
                .put("total_bytes", totalBytes)
            val connection = open("/api/transfer/uploads", "POST", token, "application/json")
            executeJson(connection, body)
        }
        return TransferSession(id = payload.getJSONObject("upload").getString("id"))
    }

    fun allocateFile(sessionId: String, source: TransferFileSource, fileId: String): TransferAllocation {
        val payload = withAuth { token ->
            val body = JSONObject()
                .put("session_id", sessionId)
                .put("file_id", fileId)
                .put("relative_path", source.relativePath)
                .put("file_name", source.displayName)
                .put("mime_type", source.mimeType)
                .put("size_bytes", source.sizeBytes)
            executeJson(open("/api/transfer/uploads/files", "POST", token, "application/json"), body)
        }
        val file = payload.getJSONObject("file")
        return TransferAllocation(
            fileId = file.getString("file_id"),
            partSize = file.getLong("part_size"),
            partCount = file.getInt("part_count"),
        )
    }

    fun uploadPart(
        sessionId: String,
        fileId: String,
        partNumber: Int,
        partLength: Int,
        input: InputStream,
        onProgress: (Long) -> Unit,
        shouldStop: (() -> Boolean)? = null,
    ) {
        val (token, _) = credentials() ?: throw TransferApiException("登录会话需要恢复", 401, "authentication_required")
        val connection = open(
            "/api/transfer/uploads/$sessionId/files/$fileId/parts/$partNumber",
            "PUT",
            token,
            "application/octet-stream",
        )
        try {
            connection.doOutput = true
            connection.setFixedLengthStreamingMode(partLength)
            connection.outputStream.use { output ->
                readExactly(input, partLength, output, onProgress, shouldStop)
            }
            val status = connection.responseCode
            if (status !in 200..299) throw readError(connection, "分片上传失败")
        } finally {
            // Aborts the request early when shouldStop cancelled the body.
            connection.disconnect()
        }
    }

    fun sessionState(sessionId: String): JSONObject {
        return withAuth { token -> executeJson(open("/api/transfer/uploads/$sessionId", "GET", token), null) }
    }

    fun complete(sessionId: String): TransferShare {
        val payload = withAuth { token ->
            executeJson(open("/api/transfer/uploads/$sessionId/complete", "POST", token, "application/json"), JSONObject())
        }
        return TransferShare.fromJson(payload.getJSONObject("share"))
    }

    fun abort(sessionId: String) {
        withAuth { token ->
            executeJson(open("/api/transfer/uploads/$sessionId/abort", "POST", token, "application/json"), JSONObject())
        }
    }

    fun listShares(): List<TransferShare> {
        val payload = withAuth { token -> executeJson(open("/api/transfer/shares", "GET", token), null) }
        val array = payload.optJSONArray("shares") ?: JSONArray()
        return buildList {
            for (index in 0 until array.length()) {
                add(TransferShare.fromJson(array.getJSONObject(index)))
            }
        }
    }

    fun revoke(shareId: String) {
        withAuth { token ->
            executeJson(open("/api/transfer/shares/$shareId/revoke", "POST", token, "application/json"), JSONObject())
        }
    }

    fun shareMetadata(shareId: String, password: String): JSONObject {
        val (token, _) = credentials() ?: throw TransferApiException("登录会话需要恢复", 401, "authentication_required")
        return executeJson(open("/api/transfer/shares/$shareId?password=$password", "GET", token), null)
    }

    fun capabilities(): JSONObject {
        val (token, _) = credentials() ?: throw TransferApiException("登录会话需要恢复", 401, "authentication_required")
        return executeJson(open("/api/transfer/capabilities", "GET", token), null)
    }

    fun deviceId(): String = deviceIdentity.getOrCreate()

    companion object {
        /** Streams exactly [length] bytes without over-reading into the next part. */
        fun readExactly(
            input: InputStream,
            length: Int,
            output: java.io.OutputStream,
            onProgress: (Long) -> Unit,
            shouldStop: (() -> Boolean)? = null,
        ): Int {
            val buffer = ByteArray(64 * 1024)
            var written = 0
            var checkedAt = 0
            while (written < length) {
                // Pausing must take effect long before a 16 MiB part finishes:
                // poll the queue at most once per MiB and abort the request.
                if (shouldStop != null && written - checkedAt >= 1024 * 1024) {
                    checkedAt = written
                    if (shouldStop()) throw TransferUploadPausedException()
                }
                val remaining = length - written
                val read = input.read(buffer, 0, minOf(remaining, buffer.size))
                if (read < 0) throw java.io.EOFException("File ended before the declared part length")
                output.write(buffer, 0, read)
                written += read
                onProgress(written.toLong())
            }
            return written
        }
    }
}
