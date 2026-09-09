package uk.thewyj.app

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.task22.TransferApiClient
import uk.thewyj.app.task22.TransferItemStatus
import uk.thewyj.app.task22.TransferQueueStore
import uk.thewyj.app.task22.TransferUploadWorker
import uk.thewyj.app.task22.QueuedTransfer

@RunWith(AndroidJUnit4::class)
class Task22LargeTransferTest : Task22AcceptanceHarness() {
    private fun prepare(): QueuedTransfer {
        loginFixture()
        TransferQueueStore.inDirectory(context.filesDir, accountId()).save(emptyList())
        return pickFileThroughUi("accept-300.bin")
    }

    private fun samplePssUntilDone(item: QueuedTransfer, timeoutMs: Long): List<Long> {
        val samples = mutableListOf<Long>()
        val thread = Thread {
            val deadline = System.currentTimeMillis() + timeoutMs
            while (System.currentTimeMillis() < deadline) {
                val current = TransferQueueStore.inDirectory(context.filesDir, accountId())
                    .load().firstOrNull { it.localId == item.localId }
                if (current?.status == TransferItemStatus.DONE) break
                samples.add(targetPssKb())
                Thread.sleep(1_000)
            }
        }
        thread.start()
        runWorkerToDone(item, timeoutMs)
        thread.join()
        return samples
    }

    @Test fun z1_300MiBUploadDownloadAndHashRoundTrip() = runBlocking {
        val item = prepare()
        val samples = samplePssUntilDone(item, 25 * 60_000)
        val done = TransferQueueStore.inDirectory(context.filesDir, accountId()).load().first { it.localId == item.localId }
        assertTrue("all parts must be uploaded (${done.uploadedParts.size}/${done.partCount})", done.uploadedParts.size == done.partCount)
        assertTrue("peak PSS must stay bounded while streaming (samples=$samples)", samples.maxOrNull() ?: 0 < 350_000L)

        val api = TransferApiClient(context)
        val share = api.complete(done.sessionId)
        val bytes = downloadToFile(share.id, done.fileId)
        assertEquals(300L * 1024 * 1024, bytes.size.toLong())
        assertEquals(sha256OfUri(Uri.parse(done.source.uri)), sha256(bytes))
        api.revoke(share.id)
    }

    @Test fun z2_1GiBUploadDownloadRoundTrip() = runBlocking {
        loginFixture()
        TransferQueueStore.inDirectory(context.filesDir, accountId()).save(emptyList())
        val item = pickFileThroughUi("accept-1g.bin")
        val samples = samplePssUntilDone(item, 50 * 60_000)
        val done = TransferQueueStore.inDirectory(context.filesDir, accountId()).load().first { it.localId == item.localId }
        assertTrue("all parts must be uploaded (${done.uploadedParts.size}/${done.partCount})", done.uploadedParts.size == done.partCount)
        assertTrue("peak PSS must stay bounded while streaming (samples=$samples)", samples.maxOrNull() ?: 0 < 350_000L)

        val api = TransferApiClient(context)
        val share = api.complete(done.sessionId)
        val bytes = downloadToFile(share.id, done.fileId)
        assertEquals(1100L * 1024 * 1024, bytes.size.toLong())
        api.revoke(share.id)
    }

    @Test fun z3_networkDropResumesFromUploadedParts() = runBlocking {
        val item = prepare()
        val store = TransferQueueStore.inDirectory(context.filesDir, accountId())
        TransferUploadWorker.enqueue(context)
        runBlocking {
            val deadline = System.currentTimeMillis() + 3 * 60_000
            while (System.currentTimeMillis() < deadline) {
                val current = store.load().first { it.localId == item.localId }
                if (current.sessionId.isNotBlank() && current.fileId.isNotBlank()) {
                    if (serverParts(current.sessionId, current.fileId).size >= 3) break
                }
                delay(500)
            }
        }
        val before = store.load().first { it.localId == item.localId }
        assertTrue("expected at least 3 uploaded parts before the network drop",
            serverParts(before.sessionId, before.fileId).size >= 3)
        shell("svc wifi disable")
        shell("svc data disable")
        delay(15_000)
        val during = store.load().first { it.localId == item.localId }
        val partsDuring = serverParts(during.sessionId, during.fileId)

        shell("svc wifi enable")
        shell("svc data enable")
        delay(20_000)
        runWorkerToDone(item, timeoutMs = 30 * 60_000)
        val done = store.load().first { it.localId == item.localId }
        assertTrue("resumed upload must keep earlier parts (during=$partsDuring final=${done.uploadedParts.size})",
            done.uploadedParts.size >= partsDuring.size)
        assertTrue("all parts must finish (${done.uploadedParts.size}/${done.partCount})", done.uploadedParts.size == done.partCount)
        val api = TransferApiClient(context)
        val share = api.complete(done.sessionId)
        assertEquals(300L * 1024 * 1024, downloadToFile(share.id, done.fileId).size.toLong())
        api.revoke(share.id)
    }

    @Test fun z4_pauseStopsPartsAndResumeContinues() = runBlocking {
        val item = prepare()
        val store = TransferQueueStore.inDirectory(context.filesDir, accountId())
        TransferUploadWorker.enqueue(context)
        runBlocking {
            val deadline = System.currentTimeMillis() + 3 * 60_000
            while (System.currentTimeMillis() < deadline) {
                val current = store.load().first { it.localId == item.localId }
                if (current.fileId.isNotBlank() && current.uploadedParts.size >= 3) break
                delay(500)
            }
        }
        val before = store.load().first { it.localId == item.localId }
        store.upsert(before.copy(status = TransferItemStatus.PAUSED))
        val pausedParts = serverParts(before.sessionId, before.fileId)
        delay(12_000)
        val stillPaused = serverParts(before.sessionId, before.fileId)
        assertEquals("no new parts while paused", pausedParts, stillPaused)
        store.upsert(store.load().first { it.localId == item.localId }.copy(status = TransferItemStatus.PENDING))
        TransferUploadWorker.enqueue(context)
        runWorkerToDone(item, timeoutMs = 30 * 60_000)
        val done = store.load().first { it.localId == item.localId }
        assertTrue("resume must finish all parts (${done.uploadedParts.size}/${done.partCount})", done.uploadedParts.size == done.partCount)
        val api = TransferApiClient(context)
        val share = api.complete(done.sessionId)
        assertEquals(300L * 1024 * 1024, downloadToFile(share.id, done.fileId).size.toLong())
        api.revoke(share.id)
    }

    @Test fun z5_prepareRestartFixture() = runBlocking {
        val item = prepare()
        TransferUploadWorker.enqueue(context)
        runBlocking {
            val deadline = System.currentTimeMillis() + 3 * 60_000
            while (System.currentTimeMillis() < deadline) {
                val current = TransferQueueStore.inDirectory(context.filesDir, accountId())
                    .load().first { it.localId == item.localId }
                if (current.uploadedParts.size >= 3) break
                delay(500)
            }
        }
        val before = TransferQueueStore.inDirectory(context.filesDir, accountId()).load().first { it.localId == item.localId }
        assertTrue("fixture must upload a few parts before the process restart", before.uploadedParts.size >= 3)
    }
}
