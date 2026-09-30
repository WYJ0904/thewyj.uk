package uk.thewyj.app.task22

import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class TransferUsage(val storedBytes: Long, val reservedBytes: Long, val limitBytes: Long) {
    val usedBytes: Long get() = storedBytes + reservedBytes
    val label: String get() = "已存储 ${formatTransferQuotaBytes(storedBytes)} / ${formatTransferQuotaBytes(limitBytes)}" +
        if (reservedBytes > 0) " · 上传预留 ${formatTransferQuotaBytes(reservedBytes)} · 总计 ${formatTransferQuotaBytes(usedBytes)}" else ""
}

data class TransferOwnerSnapshot(val usage: TransferUsage, val shares: List<TransferShare>)

data class TransferOwnerState(
    val snapshot: TransferOwnerSnapshot? = null,
    val refreshing: Boolean = false,
    val revoking: Set<String> = emptySet(),
    val errors: Map<String, String> = emptyMap(),
    val message: String = "",
    val failed: Boolean = false,
)

/** One account's remote share/quota snapshot; mutations invalidate older pulls. */
class TransferOwnerReview(
    private val load: suspend () -> TransferOwnerSnapshot,
    private val revokeRemote: suspend (String) -> Unit,
) {
    private val mutable = MutableStateFlow(TransferOwnerState())
    val state: StateFlow<TransferOwnerState> = mutable
    private val refreshLock = Mutex()
    private val revision = AtomicLong()
    private val revocations = ConcurrentHashMap.newKeySet<String>()

    suspend fun refresh() {
        if (!refreshLock.tryLock()) return
        try { readSnapshot() } finally { refreshLock.unlock() }
    }

    private suspend fun readSnapshot() {
        val generation = revision.get()
        mutable.update { it.copy(refreshing = true) }
        try {
            val snapshot = load()
            if (revision.get() == generation) mutable.update {
                it.copy(snapshot = snapshot.copy(shares = snapshot.shares.filterNot(TransferShare::revoked)),
                    failed = it.errors.isNotEmpty(), message = if (it.message.startsWith("刷新失败：")) "" else it.message)
            }
        } catch (error: CancellationException) { throw error
        } catch (error: Exception) {
            if (revision.get() == generation) mutable.update {
                it.copy(message = "刷新失败：${error.message ?: "网络暂时不可用"}", failed = true)
            }
        } finally { mutable.update { it.copy(refreshing = false) } }
    }

    suspend fun revoke(id: String): Boolean {
        if (!revocations.add(id)) return false
        revision.incrementAndGet()
        mutable.update { it.copy(revoking = it.revoking + id, errors = it.errors - id) }
        try {
            revokeRemote(id)
            revision.incrementAndGet()
            mutable.update { current ->
                val removed = current.snapshot?.shares?.firstOrNull { it.id == id }
                val snapshot = current.snapshot?.let { previous ->
                    previous.copy(
                        shares = previous.shares.filterNot { it.id == id },
                        usage = previous.usage.copy(storedBytes =
                            (previous.usage.storedBytes - (removed?.totalBytes ?: 0)).coerceAtLeast(0)),
                    )
                }
                current.copy(snapshot = snapshot, message = "分享已撤销", failed = false)
            }
            // Wait for a superseded pull, then obtain the authoritative quota.
            refreshLock.withLock { readSnapshot() }
            return true
        } catch (error: CancellationException) { throw error
        } catch (error: Exception) {
            val message = "撤销失败：${error.message ?: "请稍后重试"}"
            mutable.update { it.copy(errors = it.errors + (id to message), message = message, failed = true) }
            return false
        } finally {
            revocations.remove(id)
            mutable.update { it.copy(revoking = it.revoking - id) }
        }
    }
}

fun formatTransferBytes(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> String.format(Locale.CHINA, "%.1f KiB", bytes / 1024.0)
    bytes < 1024L * 1024 * 1024 -> String.format(Locale.CHINA, "%.1f MiB", bytes / 1048576.0)
    else -> String.format(Locale.CHINA, "%.2f GiB", bytes / 1073741824.0)
}

fun formatTransferQuotaBytes(bytes: Long): String = when {
    bytes == 0L -> "0 MiB"
    bytes < 1024L * 1024 * 1024 -> String.format(Locale.CHINA, "%.1f MiB", bytes / 1048576.0)
    else -> String.format(Locale.CHINA, "%.2f GiB", bytes / 1073741824.0)
}
