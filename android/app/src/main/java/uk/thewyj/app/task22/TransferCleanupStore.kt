package uk.thewyj.app.task22

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONArray

/** Durable owner-scoped release queue; pause never enters this queue. */
class TransferCleanupStore(private val file: File) {
    private val lock = locks.computeIfAbsent(file.canonicalPath) { Any() }
    fun pending(): List<String> = synchronized(lock) {
        if (!file.exists()) emptyList() else runCatching {
            val rows = JSONArray(file.readText())
            (0 until rows.length()).map { rows.getString(it) }.distinct()
        }.getOrDefault(emptyList())
    }
    fun add(ids: Collection<String>) = synchronized(lock) {
        save((pending() + ids.filter { it.isNotBlank() }).distinct())
    }
    fun complete(id: String) = synchronized(lock) { save(pending() - id) }
    fun retry(release: (String) -> Unit): Boolean {
        pending().take(8).forEach { id ->
            runCatching { release(id) }.onSuccess { complete(id) }
        }
        return pending().isEmpty()
    }
    private fun save(ids: List<String>) {
        file.parentFile?.mkdirs()
        val temporary = File(file.parentFile, file.name + ".tmp")
        temporary.writeText(JSONArray(ids).toString())
        runCatching { Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING) }.getOrElse {
            Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
    }
    companion object {
        private val locks = ConcurrentHashMap<String, Any>()
        fun inDirectory(directory: File, accountId: String): TransferCleanupStore = TransferCleanupStore(
            File(directory, "transfer-cleanup-${accountId.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80)}.json"),
        )
    }
}
