package uk.thewyj.app.task21

import java.io.File
import java.util.Base64

/**
 * App-private local archive for full notification content. Full notification
 * content is only stored here; it never leaves the device and never enters
 * WebView storage, Logcat, Downloads, or remote debug logs.
 */
interface NotificationArchiveStore {
    fun append(record: LocalNotificationRecord): Boolean
    fun containsFingerprint(fingerprint: String): Boolean
    fun listRecent(limit: Int): List<LocalNotificationRecord>
    fun delete(id: String): Boolean
    fun clearForAccount(accountId: String)
}

private class FileNotificationArchiveStore(private val file: File) : NotificationArchiveStore {
    override fun append(record: LocalNotificationRecord): Boolean {
        if (containsFingerprint(record.fingerprint)) return false
        return file.appendText(encode(record) + "\n", Charsets.UTF_8).let { true }
    }

    override fun containsFingerprint(fingerprint: String): Boolean {
        return listRecent(Int.MAX_VALUE).any { it.fingerprint == fingerprint }
    }

    override fun listRecent(limit: Int): List<LocalNotificationRecord> {
        if (!file.exists()) return emptyList()
        return file.readLines(Charsets.UTF_8)
            .asReversed()
            .mapNotNull { line -> runCatching { decode(line) }.getOrNull() }
            .take(limit)
    }

    override fun delete(id: String): Boolean {
        val records = listRecent(Int.MAX_VALUE)
        val remaining = records.filter { it.id != id }
        if (remaining.size == records.size) return false
        writeAll(remaining.reversed())
        return true
    }

    override fun clearForAccount(accountId: String) {
        writeAll(emptyList())
    }

    private fun writeAll(records: List<LocalNotificationRecord>) {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(records.joinToString("") { encode(it) + "\n" }, Charsets.UTF_8)
        if (file.exists()) file.delete()
        tmp.renameTo(file)
    }

    private fun encode(record: LocalNotificationRecord): String {
        return listOf(
            record.id, record.eventId, record.fingerprint, record.sourcePackage,
            record.title, record.text, record.bigText, record.subText,
            record.receivedAtMs.toString(),
            record.parseStatus.name, record.direction.name, record.amountMinor.toString(),
            record.currency, record.merchant, record.confidence.toString(),
        ).joinToString("\t") { encodeField(it) }
    }

    private fun decode(line: String): LocalNotificationRecord {
        val parts = line.split("\t").map { decodeField(it) }
        require(parts.size == 15)
        return LocalNotificationRecord(
            id = parts[0], eventId = parts[1], fingerprint = parts[2], sourcePackage = parts[3],
            title = parts[4], text = parts[5], bigText = parts[6], subText = parts[7],
            receivedAtMs = parts[8].toLong(), parseStatus = ParseStatus.valueOf(parts[9]),
            direction = FinanceDirection.valueOf(parts[10]), amountMinor = parts[11].toLong(),
            currency = parts[12], merchant = parts[13], confidence = parts[14].toInt(),
        )
    }

    private fun encodeField(value: String): String = Base64.getEncoder().encodeToString(value.toByteArray(Charsets.UTF_8))
    private fun decodeField(value: String): String = String(Base64.getDecoder().decode(value), Charsets.UTF_8)
}

object LocalNotificationArchive {
    fun inDirectory(directory: File, accountId: String): NotificationArchiveStore {
        val dir = File(directory, "notification-archive")
        dir.mkdirs()
        return FileNotificationArchiveStore(File(dir, "${safeName(accountId)}.archive"))
    }

    private fun safeName(value: String): String {
        return value.replace(Regex("""[^A-Za-z0-9._-]"""), "_").take(120)
    }
}
