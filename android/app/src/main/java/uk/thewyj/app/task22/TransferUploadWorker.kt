package uk.thewyj.app.task22

import android.content.Context
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uk.thewyj.app.AppGraph
import uk.thewyj.app.core.auth.SecureCredentialStore
import uk.thewyj.app.R
import uk.thewyj.app.core.session.RefreshWorkResult
import java.io.InputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Native multipart upload runner. The worker is only scheduled while the
 * current account has queued transfers and finishes as soon as every item is
 * done, cancelled or has failed permanently. File bytes are streamed part by
 * part from SAF; nothing larger than one part is ever held in memory.
 */
class TransferUploadWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun getForegroundInfo(): ForegroundInfo =
        ForegroundInfo(NOTIFICATION_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)

    private fun buildNotification(): android.app.Notification {
        val manager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        runCatching {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "文件传输",
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
        }
        return NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("正在上传文件")
            .setContentText("文件传输进行中")
            .setOngoing(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    override suspend fun doWork(): Result {
        if (!RUNNING.compareAndSet(false, true)) return Result.retry()
        try {
            return runTransfer()
        } finally {
            RUNNING.set(false)
        }
    }

    private suspend fun runTransfer(staleRecoveryBudget: Int = 1, authRecoveryBudget: Int = 2): Result {
        setForeground(getForegroundInfo())
        val accountId = runCatching { SecureCredentialStore(applicationContext).loadActive()?.account?.id }.getOrNull()
        if (accountId == null) {
            Log.w("T22WORKER", "no active credential; returning failure")
            return Result.failure()
        }
        val store = TransferQueueStore.inDirectory(applicationContext.filesDir, accountId)
        val configStore = TransferConfigStore.inDirectory(applicationContext.filesDir, accountId)
        val config = configStore.load()
        val api = TransferApiClient(applicationContext)
        preflightSources(store)
        val items = store.load()
        Log.i("T22WORKER", "start account=$accountId items=${items.size}")
        var sessionId = items.firstOrNull {
            it.status !in setOf(TransferItemStatus.CANCELLED, TransferItemStatus.ERROR) &&
                it.sessionId.isNotBlank()
        }?.sessionId.orEmpty()
        var retried = false
        for (item in items) {
            if (isStopped) return Result.retry()
            if (item.status in setOf(TransferItemStatus.DONE, TransferItemStatus.CANCELLED, TransferItemStatus.ERROR)) continue
            if (item.status == TransferItemStatus.PAUSED) {
                retried = true
                continue
            }
            try {
                withContext(Dispatchers.IO) {
                    var current = item.copy(status = TransferItemStatus.UPLOADING, errorMessage = "")
                    if (current.sessionId.isBlank()) {
                        if (sessionId.isBlank()) {
                            sessionId = api.createSession(
                                minutes = config.minutes,
                                maxDownloads = config.maxDownloads,
                                oneTime = config.oneTime,
                                password = config.password,
                                fileCount = items.count {
                                    it.status !in setOf(TransferItemStatus.CANCELLED, TransferItemStatus.ERROR)
                                }.coerceAtLeast(1),
                                totalBytes = items.filter {
                                    it.status !in setOf(TransferItemStatus.CANCELLED, TransferItemStatus.ERROR)
                                }
                                    .sumOf { it.source.sizeBytes },
                            ).id
                        }
                        current = current.copy(sessionId = sessionId)
                    }
                    if (current.fileId.isBlank()) {
                        val allocation = api.allocateFile(
                            sessionId = current.sessionId,
                            source = current.source,
                            fileId = "file-${UUID.randomUUID().toString().replace("-", "").take(20)}",
                        )
                        current = current.copy(
                            fileId = allocation.fileId,
                            partSize = allocation.partSize,
                            partCount = allocation.partCount,
                        )
                    }
                    store.upsert(current)
                    for (partNumber in 1..current.partCount) {
                        if (isStopped) throw TransferWorkPausedException(userInitiated = false)
                        val paused = store.load().firstOrNull { it.localId == current.localId }
                            ?.status == TransferItemStatus.PAUSED
                        if (paused) throw TransferWorkPausedException(userInitiated = true)
                        if (partNumber in current.uploadedParts) continue
                        val offset = (partNumber - 1) * current.partSize
                        val length = minOf(current.partSize, current.source.sizeBytes - offset)
                        if (length <= 0) break
                        openPart(applicationContext, current.source.uri, offset).use { input ->
                          api.uploadPart(
                            sessionId = current.sessionId,
                            fileId = current.fileId,
                            partNumber = partNumber,
                            partLength = length.toInt(),
                            input = input,
                            onProgress = { /* per-part progress is reflected in the queue bytes below */ },
                            shouldStop = {
                                isStopped || store.load()
                                    .firstOrNull { it.localId == current.localId }
                                    ?.status == TransferItemStatus.PAUSED
                            },
                          )
                        }
                        current = store.update(current.localId) { latest ->
                            latest.copy(
                                uploadedParts = latest.uploadedParts + partNumber,
                                uploadedBytes = if (partNumber in latest.uploadedParts) latest.uploadedBytes else latest.uploadedBytes + length,
                            )
                        } ?: throw TransferWorkPausedException(userInitiated = true)
                    }
                    store.update(current.localId) { latest ->
                        if (latest.status in setOf(TransferItemStatus.PAUSED, TransferItemStatus.CANCELLED)) latest
                        else latest.copy(status = TransferItemStatus.DONE, uploadedBytes = latest.source.sizeBytes)
                    }
                }
            } catch (error: TransferWorkPausedException) {
                val latest = store.load().firstOrNull { it.localId == item.localId } ?: item
                if (error.userInitiated) {
                    store.upsert(latest.copy(status = TransferItemStatus.PAUSED))
                    return Result.success()
                }
                return Result.retry()
            } catch (error: TransferUploadPausedException) {
                // The user paused while this part was in flight; the part is not
                // recorded, so resume re-uploads it and stays consistent.
                Log.i("T22WORKER", "paused during part upload")
                val latest = store.load().firstOrNull { it.localId == item.localId } ?: item
                store.upsert(latest.copy(status = TransferItemStatus.PAUSED))
                return Result.success()
            } catch (error: TransferApiException) {
                Log.w("T22WORKER", "api error ${error.status} ${error.code}: ${error.message}")
                when {
                    TransferRecoveryPolicy.shouldResetUpload(error.code) && staleRecoveryBudget > 0 -> {
                        Log.w("T22WORKER", "resetting stale upload session for the active batch")
                        store.resetStaleSessionBatch()
                        return runTransfer(staleRecoveryBudget - 1, authRecoveryBudget)
                    }
                    TransferRecoveryPolicy.shouldRefreshSession(error.status) && authRecoveryBudget > 0 -> {
                        Log.i("T22WORKER", "access session expired; refreshing before resuming the current part")
                        when (AppGraph.sessionRepository.refresh()) {
                            RefreshWorkResult.SUCCESS -> return runTransfer(staleRecoveryBudget, authRecoveryBudget - 1)
                            RefreshWorkResult.RETRY -> return Result.retry()
                            RefreshWorkResult.SIGNED_OUT -> {
                                val latest = store.load().firstOrNull { it.localId == item.localId } ?: item
                                store.upsert(latest.copy(status = TransferItemStatus.ERROR, errorMessage = "登录会话需要恢复"))
                                return Result.failure()
                            }
                        }
                    }
                    error.status == 401 || error.status == 403 -> {
                        val latest = store.load().firstOrNull { it.localId == item.localId } ?: item
                        store.upsert(latest.copy(status = TransferItemStatus.ERROR, errorMessage = error.message ?: "上传失败"))
                        return Result.failure()
                    }
                    error.status in 400..499 -> {
                        val latest = store.load().firstOrNull { it.localId == item.localId } ?: item
                        store.upsert(latest.copy(status = TransferItemStatus.ERROR, errorMessage = error.message ?: "上传失败"))
                    }
                    else -> {
                        val latest = store.load().firstOrNull { it.localId == item.localId } ?: item
                        store.upsert(latest.copy(status = TransferItemStatus.ERROR, errorMessage = error.message ?: "上传失败"))
                        if (!retried) {
                            retried = true
                            return Result.retry()
                        }
                    }
                }
            } catch (error: Throwable) {
                Log.e("T22WORKER", "unexpected failure", error)
                val latest = store.load().firstOrNull { it.localId == item.localId } ?: item
                store.upsert(latest.copy(status = TransferItemStatus.ERROR, errorMessage = error.message ?: "网络异常"))
                if (!retried && runAttemptCount < 3) return Result.retry()
            }
        }
        return Result.success()
    }

    private fun preflightSources(store: TransferQueueStore) {
        for (item in store.load()) {
            if (item.status !in setOf(TransferItemStatus.PENDING, TransferItemStatus.UPLOADING)) continue
            val readable = runCatching {
                applicationContext.contentResolver.openInputStream(Uri.parse(item.source.uri))?.use { true } ?: false
            }.getOrDefault(false)
            if (!readable) {
                Log.w("T22WORKER", "source permission is no longer available; localId=${item.localId}")
                store.upsert(
                    item.copy(
                        sessionId = "",
                        fileId = "",
                        partSize = 0,
                        partCount = 0,
                        uploadedParts = emptySet(),
                        uploadedBytes = 0,
                        status = TransferItemStatus.ERROR,
                        errorMessage = "无法读取所选文件，请重新选择",
                    ),
                )
            }
        }
    }

    private fun openPart(context: Context, uriValue: String, offset: Long): InputStream {
        val input = context.contentResolver.openInputStream(Uri.parse(uriValue))
            ?: throw TransferApiException("无法读取所选文件", 400, "file_unreadable")
        val buffered = if (input is java.io.BufferedInputStream) input else java.io.BufferedInputStream(input, 64 * 1024)
        var skipped = 0L
        while (skipped < offset) {
            val result = buffered.skip(offset - skipped)
            if (result <= 0) {
                if (buffered.read() < 0) break
                skipped += 1
            } else {
                skipped += result
            }
        }
        return buffered
    }

    companion object {
        const val UNIQUE_WORK_NAME = "thewyj-transfer-upload"
        private const val CHANNEL_ID = "thewyj-transfer-upload"
        private const val NOTIFICATION_ID = 2201
        private val RUNNING = AtomicBoolean(false)
        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<TransferUploadWorker>().build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_WORK_NAME,
                ExistingWorkPolicy.KEEP,
                request,
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_WORK_NAME)
        }
    }
}

private class TransferWorkPausedException(val userInitiated: Boolean) : Exception("paused")

