package uk.thewyj.app.task22

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uk.thewyj.app.core.auth.SecureCredentialStore
import java.io.InputStream
import java.util.UUID

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

    override suspend fun doWork(): Result {
        val accountId = runCatching { SecureCredentialStore(applicationContext).loadActive()?.account?.id }.getOrNull()
        if (accountId == null) {
            Log.w("T22WORKER", "no active credential; returning failure")
            return Result.failure()
        }
        val store = TransferQueueStore.inDirectory(applicationContext.filesDir, accountId)
        val configStore = TransferConfigStore.inDirectory(applicationContext.filesDir, accountId)
        val config = configStore.load()
        val api = TransferApiClient(applicationContext)
        val items = store.load()
        Log.i("T22WORKER", "start account=$accountId items=${items.size}")
        var sessionId = items.firstOrNull { it.sessionId.isNotBlank() }?.sessionId.orEmpty()
        var retried = false
        for (item in items) {
            if (isStopped) return Result.retry()
            if (item.status == TransferItemStatus.DONE || item.status == TransferItemStatus.CANCELLED) continue
            if (item.status == TransferItemStatus.PAUSED) {
                retried = true
                continue
            }
            try {
                withContext(Dispatchers.IO) {
                    var current = item
                    if (current.sessionId.isBlank()) {
                        if (sessionId.isBlank()) {
                            sessionId = api.createSession(
                                minutes = config.minutes,
                                maxDownloads = config.maxDownloads,
                                oneTime = config.oneTime,
                                password = config.password,
                                fileCount = items.count { it.status != TransferItemStatus.CANCELLED }.coerceAtLeast(1),
                                totalBytes = items.filter { it.status != TransferItemStatus.CANCELLED }
                                    .sumOf { it.source.sizeBytes },
                            ).id
                        }
                        current = current.copy(sessionId = sessionId, status = TransferItemStatus.UPLOADING)
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
                        if (isStopped) throw TransferWorkPausedException()
                        val paused = store.load().firstOrNull { it.localId == current.localId }
                            ?.status == TransferItemStatus.PAUSED
                        if (paused) throw TransferWorkPausedException()
                        if (partNumber in current.uploadedParts) continue
                        val offset = (partNumber - 1) * current.partSize
                        val length = minOf(current.partSize, current.source.sizeBytes - offset)
                        if (length <= 0) break
                        val input = openPart(applicationContext, current.source.uri, offset)
                        api.uploadPart(
                            sessionId = current.sessionId,
                            fileId = current.fileId,
                            partNumber = partNumber,
                            partLength = length.toInt(),
                            input = input,
                            onProgress = { /* per-part progress is reflected in the queue bytes below */ },
                        )
                        current = current.copy(
                            uploadedParts = current.uploadedParts + partNumber,
                            uploadedBytes = current.uploadedBytes + length,
                        )
                        store.upsert(current)
                    }
                    store.upsert(current.copy(status = TransferItemStatus.DONE, uploadedBytes = current.source.sizeBytes))
                }
            } catch (error: TransferWorkPausedException) {
                store.upsert(item.copy(status = TransferItemStatus.PAUSED))
                return Result.success()
            } catch (error: TransferApiException) {
                Log.w("T22WORKER", "api error ${error.status} ${error.code}: ${error.message}")
                when {
                    error.status == 401 || error.status == 403 -> {
                        store.upsert(item.copy(status = TransferItemStatus.ERROR, errorMessage = error.message ?: "上传失败"))
                        return Result.failure()
                    }
                    error.status in 400..499 -> {
                        store.upsert(item.copy(status = TransferItemStatus.ERROR, errorMessage = error.message ?: "上传失败"))
                    }
                    else -> {
                        store.upsert(item.copy(status = TransferItemStatus.ERROR, errorMessage = error.message ?: "上传失败"))
                        if (!retried) {
                            retried = true
                            return Result.retry()
                        }
                    }
                }
            } catch (error: Throwable) {
                Log.e("T22WORKER", "unexpected failure", error)
                store.upsert(item.copy(status = TransferItemStatus.ERROR, errorMessage = error.message ?: "网络异常"))
                if (!retried && runAttemptCount < 3) return Result.retry()
            }
        }
        return Result.success()
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

        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<TransferUploadWorker>().build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                request,
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_WORK_NAME)
        }
    }
}

private class TransferWorkPausedException : Exception("paused")

