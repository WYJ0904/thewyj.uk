package uk.thewyj.app.task21

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.Base64

/**
 * App-private local archive for full notification content. Full notification
 * content is only stored here; it never leaves the device and never enters
 * WebView storage, Logcat, Downloads, or remote debug logs.
 *
 * The store is a schema-versioned, line-oriented file with one Base64 record
 * per line. Writes are atomic (temp file + fsync + rename), the last partial
 * line is recovered as corrupt, malformed lines are skipped, and retention is
 * bounded so a runaway notification stream cannot grow disk without limit.
 */
interface NotificationArchiveStore {
    fun append(record: LocalNotificationRecord): Boolean
    fun containsFingerprint(fingerprint: String): Boolean
    fun listRecent(limit: Int): List<LocalNotificationRecord>
    fun delete(id: String): Boolean
    fun clearForAccount(accountId: String)
}

private class FileNotificationArchiveStore(private val file: File) : NotificationArchiveStore {
    private val lock = Any()

    override fun append(record: LocalNotificationRecord): Boolean {
        synchronized(lock) {
            if (containsFingerprintLocked(record.fingerprint)) return false
            val records = readAllLocked().toMutableList()
            records.add(record)
            writeAllLocked(retainNewest(records))
            return true
        }
    }

    override fun containsFingerprint(fingerprint: String): Boolean {
        synchronized(lock) {
            return containsFingerprintLocked(fingerprint)
        }
    }

    override fun listRecent(limit: Int): List<LocalNotificationRecord> {
        synchronized(lock) {
            return readAllLocked().asReversed().take(limit)
        }
    }

    override fun delete(id: String): Boolean {
        synchronized(lock) {
            val records = readAllLocked()
            val remaining = records.filter { it.id != id }
            if (remaining.size == records.size) return false
            writeAllLocked(remaining)
            return true
        }
    }

    override fun clearForAccount(accountId: String) {
        synchronized(lock) {
            writeAllLocked(emptyList())
        }
    }

    private fun containsFingerprintLocked(fingerprint: String): Boolean {
        return readAllLocked().any { it.fingerprint == fingerprint }
    }

    private fun readAllLocked(): List<LocalNotificationRecord> {
        if (!file.exists()) return emptyList()
        val lines = runCatching { file.readLines(Charsets.UTF_8) }.getOrDefault(emptyList())
        return lines.mapNotNull { line ->
            if (line == LocalNotificationArchive.ARCHIVE_VERSION_LINE) null
            else runCatching { decode(line) }.getOrNull()
        }
    }

    private fun retainNewest(records: List<LocalNotificationRecord>): List<LocalNotificationRecord> {
        if (records.size <= LocalNotificationArchive.MAX_ARCHIVE_RECORDS) return records
        return records.subList(records.size - LocalNotificationArchive.MAX_ARCHIVE_RECORDS, records.size)
    }

    private fun writeAllLocked(records: List<LocalNotificationRecord>) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        val lines = buildString {
            append(LocalNotificationArchive.ARCHIVE_VERSION_LINE).append('\n')
            for (record in records) {
                append(encode(record)).append('\n')
            }
        }
        FileOutputStream(tmp).use { output ->
            output.write(lines.toByteArray(Charsets.UTF_8))
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
    const val ARCHIVE_VERSION_LINE = "wyj-notification-archive-v1"
    const val MAX_ARCHIVE_RECORDS = 2000

    fun inDirectory(directory: File, accountId: String): NotificationArchiveStore {
        val dir = File(directory, "notification-archive")
        dir.mkdirs()
        return FileNotificationArchiveStore(File(dir, "${safeName(accountId)}.archive"))
    }

    private fun safeName(value: String): String {
        return value.replace(Regex("""[^A-Za-z0-9._-]"""), "_").take(120)
    }
}
