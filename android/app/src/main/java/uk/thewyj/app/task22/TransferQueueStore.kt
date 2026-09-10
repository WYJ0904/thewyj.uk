package uk.thewyj.app.task22

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * App-private, per-account transfer queue. Queued entries only carry SAF URIs,
 * display names, paths and server identifiers; file bytes are streamed on
 * demand and are never loaded into memory.
 */
class TransferQueueStore(private val file: File) {
    private val lock = locks.computeIfAbsent(file.canonicalPath) { Any() }

    fun load(): List<QueuedTransfer> {
        synchronized(lock) {
            if (!file.exists()) return emptyList()
            return runCatching {
                val root = JSONObject(file.readText(Charsets.UTF_8))
                val array = root.optJSONArray("items") ?: JSONArray()
                buildList {
                    for (index in 0 until array.length()) {
                        runCatching { QueuedTransfer.fromJson(array.getJSONObject(index)) }
                            .getOrNull()
                            ?.let(::add)
                    }
                }
            }.getOrDefault(emptyList())
        }
    }

    fun save(items: List<QueuedTransfer>) {
        synchronized(lock) {
            val root = JSONObject()
            root.put("schema", 1)
            root.put("items", JSONArray().apply {
                for (item in items) put(item.toJson())
            })
            file.parentFile?.mkdirs()
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(root.toString(), Charsets.UTF_8)
            runCatching {
                Files.move(
                    tmp.toPath(),
                    file.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            }.recoverCatching {
                Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }.getOrThrow()
        }
    }

    fun upsert(item: QueuedTransfer) {
        synchronized(lock) {
            val items = load().filterNot { it.localId == item.localId }.toMutableList()
            items.add(item)
            save(items)
        }
    }

    fun remove(localId: String) {
        synchronized(lock) {
            save(load().filterNot { it.localId == localId })
        }
    }

    fun update(localId: String, transform: (QueuedTransfer) -> QueuedTransfer): QueuedTransfer? = synchronized(lock) {
        val items = load().toMutableList()
        val index = items.indexOfFirst { it.localId == localId }
        if (index < 0) return@synchronized null
        val updated = transform(items[index])
        require(updated.localId == localId)
        items[index] = updated
        save(items)
        updated
    }

    fun clearForAccount(accountId: String) {
        synchronized(lock) {
            save(emptyList())
        }
    }

    companion object {
        private val locks = java.util.concurrent.ConcurrentHashMap<String, Any>()
        fun inDirectory(directory: File, accountId: String): TransferQueueStore {
            val safe = accountId.replace(Regex("""[^A-Za-z0-9._-]"""), "_").take(80)
            return TransferQueueStore(File(directory, "transfer-queue-$safe.json"))
        }
    }
}
