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
    private val fileKey = file.canonicalPath
    private val lock = locks.computeIfAbsent(fileKey) { Any() }

    private data class CachedQueue(
        val modified: Long,
        val length: Long,
        val generation: Long,
        val items: List<QueuedTransfer>,
    )

    private fun snapshot(): CachedQueue {
        if (!file.exists()) {
            snapshots.remove(fileKey)
            return CachedQueue(0, 0, 0, emptyList())
        }
        val modified = file.lastModified()
        val length = file.length()
        snapshots[fileKey]?.let { if (it.modified == modified && it.length == length) return it }
        return runCatching {
            val root = JSONObject(file.readText(Charsets.UTF_8))
            val array = root.optJSONArray("items") ?: JSONArray()
            val items = buildList {
                for (index in 0 until array.length()) {
                    runCatching { QueuedTransfer.fromJson(array.getJSONObject(index)) }
                        .getOrNull()?.let(::add)
                }
            }
            CachedQueue(modified, length, root.optLong("batch_generation"), items)
                .also { snapshots[fileKey] = it }
        }.getOrDefault(CachedQueue(modified, length, 0, emptyList()))
    }

    fun load(): List<QueuedTransfer> {
        synchronized(lock) {
            return snapshot().items
        }
    }

    fun generation(): Long = synchronized(lock) {
        snapshot().generation
    }

    fun save(items: List<QueuedTransfer>) = synchronized(lock) { save(items, generation()) }

    private fun save(items: List<QueuedTransfer>, generation: Long) {
        synchronized(lock) {
            val root = JSONObject()
            root.put("schema", 1)
            root.put("batch_generation", generation)
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
            snapshots[fileKey] = CachedQueue(file.lastModified(), file.length(), generation, items.toList())
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

    fun updateIfGeneration(localId: String, expected: Long, transform: (QueuedTransfer) -> QueuedTransfer): QueuedTransfer? = synchronized(lock) {
        if (generation() != expected) null else update(localId, transform)
    }

    /**
     * An expired server upload invalidates every file allocated in that
     * session. Keep the SAF sources, but rebuild all server-side state as one
     * batch so a retry cannot remain pinned to the expired session.
     */
    fun resetStaleSessionBatch(): List<QueuedTransfer> = synchronized(lock) {
        val reset = load().map { item ->
            if (item.status == TransferItemStatus.CANCELLED) item
            else item.copy(
                sessionId = "",
                fileId = "",
                partSize = 0,
                partCount = 0,
                uploadedParts = emptySet(),
                uploadedBytes = 0,
                status = if (item.status == TransferItemStatus.PAUSED) TransferItemStatus.PAUSED else TransferItemStatus.PENDING,
                errorMessage = "",
            )
        }
        save(reset, generation() + 1)
        reset
    }

    fun clearForAccount(accountId: String) {
        synchronized(lock) {
            save(emptyList())
        }
    }

    companion object {
        private val locks = java.util.concurrent.ConcurrentHashMap<String, Any>()
        private val snapshots = java.util.concurrent.ConcurrentHashMap<String, CachedQueue>()
        fun inDirectory(directory: File, accountId: String): TransferQueueStore {
            val safe = accountId.replace(Regex("""[^A-Za-z0-9._-]"""), "_").take(80)
            return TransferQueueStore(File(directory, "transfer-queue-$safe.json"))
        }
    }
}
