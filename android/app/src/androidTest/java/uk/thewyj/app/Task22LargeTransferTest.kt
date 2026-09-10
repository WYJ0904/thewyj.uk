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
import java.io.File

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
        assertTrue("peak PSS must stay bounded while streaming (samples=$samples)",
            (samples.maxOrNull() ?: 0) < 600_000L && ((samples.maxOrNull() ?: 0) - (samples.minOrNull() ?: 0)) < 200_000L)

        val api = TransferApiClient(context)
        val share = api.complete(done.sessionId)
        val target = File(context.filesDir, "accept-300.download")
        target.delete()
        val result = downloadToDestination(share.id, done.fileId, target)
        val sourceHash = sha256OfUri(Uri.parse(done.source.uri))
        assertEquals(300L * 1024 * 1024, result.bytes)
        assertEquals(sourceHash, result.sha256)
        assertEquals(sourceHash, sha256OfFile(target))
        target.delete()
        api.revoke(share.id)
    }

    @Test fun z2_1GiBUploadDownloadRoundTrip() = runBlocking {
        loginFixture()
        TransferQueueStore.inDirectory(context.filesDir, accountId()).save(emptyList())
        val item = pickFileThroughUi("accept-1g.bin")
        val samples = samplePssUntilDone(item, 50 * 60_000)
        val done = TransferQueueStore.inDirectory(context.filesDir, accountId()).load().first { it.localId == item.localId }
        assertTrue("all parts must be uploaded (${done.uploadedParts.size}/${done.partCount})", done.uploadedParts.size == done.partCount)
        assertTrue("peak PSS must stay bounded while streaming (samples=$samples)",
            (samples.maxOrNull() ?: 0) < 600_000L && ((samples.maxOrNull() ?: 0) - (samples.minOrNull() ?: 0)) < 200_000L)

        val api = TransferApiClient(context)
        val share = api.complete(done.sessionId)
        val target = File(context.filesDir, "accept-1g.download")
        target.delete()
        val result = downloadToDestination(share.id, done.fileId, target)
        val sourceHash = sha256OfUri(Uri.parse(done.source.uri))
        assertEquals(1100L * 1024 * 1024, result.bytes)
        assertEquals(sourceHash, result.sha256)
        assertEquals(sourceHash, sha256OfFile(target))
        target.delete()
        api.revoke(share.id)
    }

    @Test fun z6_downloadInterruptionResumesAtTheCorrectOffset() = runBlocking {
        val item = prepare()
        runWorkerToDone(item, 25 * 60_000)
        val done = TransferQueueStore.inDirectory(context.filesDir, accountId()).load().first { it.localId == item.localId }
        val api = TransferApiClient(context)
        val share = api.complete(done.sessionId)
        val target = File(context.filesDir, "accept-300.resumed")
        target.delete()
        // First leg stops early, exactly like a dropped connection.
        val firstLeg = downloadToDestination(share.id, done.fileId, target, limitBytes = 40L * 1024 * 1024)
        assertEquals(40L * 1024 * 1024, firstLeg.bytes)
        assertEquals(40L * 1024 * 1024, target.length())
        // Second leg resumes from the existing prefix and must reproduce the file.
        val resumed = downloadToDestination(share.id, done.fileId, target)
        val sourceHash = sha256OfUri(Uri.parse(done.source.uri))
        assertEquals(300L * 1024 * 1024, resumed.bytes)
        assertEquals(sourceHash, resumed.sha256)
        assertEquals(sourceHash, sha256OfFile(target))
        target.delete()
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
        val partsBeforeDrop = serverParts(before.sessionId, before.fileId)
        assertTrue("expected at least 3 uploaded parts before the network drop",
            partsBeforeDrop.size >= 3)
        val uploadedBeforeDrop = before.uploadedParts.size
        shell("svc wifi disable")
        shell("svc data disable")
        try {
            delay(15_000)
            val during = store.load().first { it.localId == item.localId }
            assertTrue(
                "offline uploads must not be recorded as uploaded (before=$uploadedBeforeDrop during=${during.uploadedParts.size})",
                during.uploadedParts.size <= uploadedBeforeDrop,
            )
        } finally {
            // Always restore connectivity, even if the offline assertions fail.
            shell("svc wifi enable")
            shell("svc data enable")
        }
        delay(20_000)
        runWorkerToDone(item, timeoutMs = 30 * 60_000)
        val done = store.load().first { it.localId == item.localId }
        assertTrue("resumed upload must keep earlier parts (before=${partsBeforeDrop.size} final=${done.uploadedParts.size})",
            done.uploadedParts.size >= partsBeforeDrop.size)
        assertTrue("all parts must finish (${done.uploadedParts.size}/${done.partCount})", done.uploadedParts.size == done.partCount)
        assertTrue("server must still hold the parts uploaded before the drop",
            serverParts(done.sessionId, done.fileId) == done.uploadedParts.toSet())
        val api = TransferApiClient(context)
        val share = api.complete(done.sessionId)
        val target = File(context.filesDir, "accept-300.network")
        target.delete()
        val result = downloadToDestination(share.id, done.fileId, target)
        assertEquals(300L * 1024 * 1024, result.bytes)
        assertEquals(sha256OfUri(Uri.parse(done.source.uri)), result.sha256)
        target.delete()
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
        // A part that was already in flight when the pause landed may still be
        // committed by R2; wait until the upload stops advancing before
        // asserting that pausing stopped the pipeline.
        runBlocking {
            var previous = serverParts(before.sessionId, before.fileId)
            val deadline = System.currentTimeMillis() + 90_000
            while (System.currentTimeMillis() < deadline) {
                delay(4_000)
                val current = serverParts(before.sessionId, before.fileId)
                if (current == previous) break
                previous = current
            }
        }
        val pausedParts = serverParts(before.sessionId, before.fileId)
        delay(12_000)
        val stillPaused = serverParts(before.sessionId, before.fileId)
        assertEquals("no new parts while paused", pausedParts, stillPaused)
        assertTrue(
            "pausing must keep the parts uploaded before the pause (before=${before.uploadedParts} paused=$pausedParts)",
            pausedParts.containsAll(before.uploadedParts),
        )
        store.upsert(store.load().first { it.localId == item.localId }.copy(status = TransferItemStatus.PENDING))
        TransferUploadWorker.enqueue(context)
        runWorkerToDone(item, timeoutMs = 30 * 60_000)
        val done = store.load().first { it.localId == item.localId }
        assertTrue("resume must finish all parts (${done.uploadedParts.size}/${done.partCount})", done.uploadedParts.size == done.partCount)
        val api = TransferApiClient(context)
        val share = api.complete(done.sessionId)
        val target = File(context.filesDir, "accept-300.paused")
        target.delete()
        val result = downloadToDestination(share.id, done.fileId, target)
        assertEquals(300L * 1024 * 1024, result.bytes)
        assertEquals(sha256OfUri(Uri.parse(done.source.uri)), result.sha256)
        target.delete()
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
