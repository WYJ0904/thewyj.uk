package uk.thewyj.app.task21

import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Base64

data class IngestResponse(val ok: Boolean, val status: Int, val body: String)

interface NotificationIngestTransport {
    fun post(path: String, sessionToken: String, body: String): IngestResponse
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
        val connection = (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection)
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 20_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("X-Session-Token", sessionToken)
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            IngestResponse(status in 200..299, status, responseBody)
        } finally {
            connection.disconnect()
        }
    }
}

class OfflineNotificationQueue(private val file: File) {
    private fun encode(value: String): String = Base64.getEncoder().encodeToString(value.toByteArray(Charsets.UTF_8))
    private fun decode(value: String): String = String(Base64.getDecoder().decode(value), Charsets.UTF_8)

    fun enqueue(operationId: String, payload: String) {
        file.appendText(encode(operationId) + "\t" + encode(payload) + "\n", Charsets.UTF_8)
    }

    fun peekAll(): List<Pair<String, String>> {
        if (!file.exists()) return emptyList()
        return file.readLines(Charsets.UTF_8).mapNotNull { line ->
            val parts = line.split("\t")
            if (parts.size != 2) null else decode(parts[0]) to decode(parts[1])
        }
    }

    fun remove(operationId: String) {
        val remaining = peekAll().filter { it.first != operationId }
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(remaining.joinToString("") { encode(it.first) + "\t" + encode(it.second) + "\n" }, Charsets.UTF_8)
        if (file.exists()) file.delete()
        tmp.renameTo(file)
    }
}
