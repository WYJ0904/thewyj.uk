package uk.thewyj.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import android.net.Uri
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import uk.thewyj.app.task22.TransferApiClient
import uk.thewyj.app.task22.TransferItemStatus
import uk.thewyj.app.task22.TransferQueueStore
import uk.thewyj.app.task22.TransferUploadWorker
import java.io.File

/**
 * Runs in a SEPARATE instrumentation invocation after the host force-stops the
 * app between z5_prepareRestartFixture and this test. It proves the queue
 * survives a full process/WorkManager teardown and resumes from the uploaded
 * parts instead of restarting the file.
 */
@RunWith(AndroidJUnit4::class)
class Task22RestartResumeTest : Task22AcceptanceHarness() {
    @Test fun resumeAfterProcessRestart() = runBlocking {
        loginFixture()
        val store = TransferQueueStore.inDirectory(context.filesDir, accountId())
        val item = store.load().firstOrNull { it.source.displayName == "accept-300.bin" }
            ?: throw AssertionError("queue did not survive the process restart")
        assertTrue("fixture must have uploaded parts before restart", item.uploadedParts.size >= 3)
        assertTrue("item must not be finished before resume", item.status != TransferItemStatus.DONE)
        val serverBefore = serverParts(item.sessionId, item.fileId)
        assertTrue("server-side parts must be preserved (server=$serverBefore local=${item.uploadedParts.size})",
            serverBefore.size >= item.uploadedParts.size)

        TransferUploadWorker.enqueue(context)
        runWorkerToDone(item, timeoutMs = 25 * 60_000)
        val done = store.load().first { it.localId == item.localId }
        assertTrue("resume must finish every part", done.uploadedParts.size == done.partCount)

        val api = TransferApiClient(context)
        val share = api.complete(done.sessionId)
        val target = File(context.filesDir, "accept-300.restart")
        target.delete()
        val result = downloadToDestination(share.id, done.fileId, target)
        assertEquals(300L * 1024 * 1024, result.bytes)
        assertEquals(sha256OfUri(Uri.parse(item.source.uri)), result.sha256)
        target.delete()
        api.revoke(share.id)
    }
}
