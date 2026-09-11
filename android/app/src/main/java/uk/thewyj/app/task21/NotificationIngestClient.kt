package uk.thewyj.app.task21

import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.Base64

data class IngestResponse(val ok: Boolean, val status: Int, val body: String)
data class QueuedNotificationRequest(
    val operationId: String,
    val path: String,
    val body: String,
    /** Upload attempts that ended in a non-retryable server rejection. */
    val attempts: Int = 0,
    /** Server error code/reason of the last rejection, shown to the user. */
    val lastError: String = "",
)

interface NotificationIngestTransport {
    fun post(path: String, sessionToken: String, body: String): IngestResponse
    fun get(path: String, sessionToken: String): IngestResponse = IngestResponse(false, 405, "{}")
}

internal object StructuredEventJson {
    fun escape(value: String): String = buildString {
        for (ch in value) {
            when (ch) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (ch < ' ') append("\\u%04x".format(ch.code)) else append(ch)
            }
        }
    }

    fun eventJson(event: StructuredNotificationEvent): String {
        return buildString {
            append("{")
            append("\"event_id\":\"${escape(event.eventId)}\",")
            append("\"fingerprint\":\"${escape(event.fingerprint)}\",")
            append("\"source_package\":\"${escape(event.sourcePackage)}\",")
            append("\"source_type\":\"notification\",")
            append("\"event_type\":\"${event.eventType.name.lowercase()}\",")
            append("\"parser_version\":\"${escape(event.parserVersion)}\",")
            append("\"parse_status\":\"${event.parseStatus.name.lowercase()}\",")
            append("\"direction\":\"${if (event.direction == FinanceDirection.UNKNOWN) "" else event.direction.name.lowercase()}\",")
            append("\"amount_minor\":${event.amountMinor},")
            append("\"currency\":\"${escape(event.currency)}\",")
            append("\"payment_channel\":\"${escape(event.paymentChannel)}\",")
            append("\"merchant\":\"${escape(event.merchant)}\",")
            append("\"counterparty\":\"${escape(event.counterparty)}\",")
            append("\"confidence\":${event.confidence},")
            append("\"occurred_at_ms\":${event.occurredAtMs},")
            append("\"received_at_ms\":${event.receivedAtMs}")
            append("}")
        }
    }

    fun ingestPayload(schemaVersion: String, deviceId: String, operationId: String, event: StructuredNotificationEvent): String {
        return """{"schema_version":"$schemaVersion","device_id":"${escape(deviceId)}","operations":[{"operation_id":"${escape(operationId)}","type":"event.ingest","payload":${eventJson(event)}}]}"""
    }
}

class HttpNotificationIngestTransport(
    private val baseUrl: String,
) : NotificationIngestTransport {
    override fun post(path: String, sessionToken: String, body: String): IngestResponse {
        return request(path, sessionToken) { connection ->
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }
    }

    override fun get(path: String, sessionToken: String): IngestResponse {
        return request(path, sessionToken) { connection ->
            connection.requestMethod = "GET"
        }
    }

    private fun request(path: String, sessionToken: String, configure: (HttpURLConnection) -> Unit): IngestResponse {
        return runCatching {
            val connection = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = 15_000
                connection.readTimeout = 20_000
                connection.setRequestProperty("X-Session-Token", sessionToken)
                configure(connection)
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
                IngestResponse(status in 200..299, status, responseBody)
            } finally {
                connection.disconnect()
            }
        }.getOrElse {
            IngestResponse(false, 0, "{}")
        }
    }
}

class OfflineNotificationQueue(private val file: File) {
    private val lock = Any()

    private fun encode(value: String): String = Base64.getEncoder().encodeToString(value.toByteArray(Charsets.UTF_8))
    private fun decode(value: String): String = String(Base64.getDecoder().decode(value), Charsets.UTF_8)

    fun enqueue(operationId: String, payload: String) {
        enqueueRequest(operationId, INGEST_PATH, payload)
    }

    fun enqueueRequest(operationId: String, path: String, payload: String) {
        require(path in ALLOWED_PATHS)
        synchronized(lock) {
            val entries = readRequestsLocked().toMutableList()
            if (entries.any { it.operationId == operationId }) return
            entries.add(QueuedNotificationRequest(operationId, path, payload))
            writeAllLocked(retainNewest(entries))
        }
    }

    fun peekAll(): List<Pair<String, String>> {
        synchronized(lock) {
            return readRequestsLocked().map { it.operationId to it.body }
        }
    }

    fun peekRequests(): List<QueuedNotificationRequest> {
        synchronized(lock) {
            return readRequestsLocked()
        }
    }

    /**
     * Records a non-retryable server rejection without deleting the payload.
     * The entry keeps its bytes, reports why it was refused, and is skipped
     * after [MAX_UPLOAD_ATTEMPTS] so a poison payload cannot block the queue.
     */
    fun markRejected(operationId: String, reason: String): QueuedNotificationRequest? {
        synchronized(lock) {
            val entries = readRequestsLocked().toMutableList()
            val index = entries.indexOfFirst { it.operationId == operationId }
            if (index < 0) return null
            val updated = entries[index].copy(
                attempts = entries[index].attempts + 1,
                lastError = reason.take(120),
            )
            entries[index] = updated
            writeAllLocked(entries)
            return updated
        }
    }

    fun remove(operationId: String) {
        synchronized(lock) {
            val remaining = readRequestsLocked().filter { it.operationId != operationId }
            writeAllLocked(remaining)
        }
    }

    fun pendingCount(): Int = synchronized(lock) { readRequestsLocked().size }

    fun clearForAccount(accountId: String) {
        synchronized(lock) {
            writeAllLocked(emptyList())
        }
    }

    private fun readRequestsLocked(): List<QueuedNotificationRequest> {
        if (!file.exists()) return emptyList()
        return runCatching { file.readLines(Charsets.UTF_8) }
            .getOrDefault(emptyList())
            .mapNotNull { line ->
                runCatching {
                    val parts = line.split("\t")
                    val operationId = decode(parts[0])
                    val path = if (parts.size <= 2) INGEST_PATH else decode(parts[1])
                    val body = decode(parts[if (parts.size <= 2) 1 else 2])
                    // attempts/lastError are optional trailing columns so
                    // queues written by older builds keep loading.
                    val attempts = parts.getOrNull(3)?.let { decode(it).toIntOrNull() } ?: 0
                    val lastError = parts.getOrNull(4)?.let { decode(it) }.orEmpty()
                    require(parts.size in 2..5 && path in ALLOWED_PATHS)
                    QueuedNotificationRequest(operationId, path, body, attempts, lastError)
                }.getOrNull()
            }
    }

    private fun retainNewest(entries: List<QueuedNotificationRequest>): List<QueuedNotificationRequest> {
        if (entries.size <= MAX_QUEUE_ENTRIES) return entries
        return entries.subList(entries.size - MAX_QUEUE_ENTRIES, entries.size)
    }

    private fun writeAllLocked(entries: List<QueuedNotificationRequest>) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        val content = entries.joinToString("") {
            encode(it.operationId) + "\t" + encode(it.path) + "\t" + encode(it.body) + "\t" +
                encode(it.attempts.toString()) + "\t" + encode(it.lastError) + "\n"
        }
        FileOutputStream(tmp).use { output ->
            output.write(content.toByteArray(Charsets.UTF_8))
            output.fd.sync()
        }
        runCatching {
            Files.move(
                tmp.toPath(),
                file.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        }.recoverCatching {
            Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }.recoverCatching {
            tmp.copyTo(file, overwrite = true)
            tmp.delete()
            file.toPath()
        }.getOrThrow()
    }

    companion object {
        const val MAX_QUEUE_ENTRIES = 500
        /** Rejections before a payload is skipped instead of retried forever. */
        const val MAX_UPLOAD_ATTEMPTS = 5
        const val INGEST_PATH = "/api/notification/ingest"
        const val DELETE_PATH = "/api/notification/events/delete"
        val ALLOWED_PATHS = setOf(INGEST_PATH, DELETE_PATH)
    }
}

object NotificationOfflineQueue {
    fun inDirectory(directory: File, accountId: String): OfflineNotificationQueue {
        val safeAccount = accountId.replace(Regex("""[^A-Za-z0-9._-]"""), "_").take(80)
        return OfflineNotificationQueue(File(directory, "notification-ingest-$safeAccount.queue"))
    }
}
