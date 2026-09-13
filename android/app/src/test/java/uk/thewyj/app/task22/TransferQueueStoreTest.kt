package uk.thewyj.app.task22

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class TransferQueueStoreTest {
    @Test fun separateInstancesSerializeReadModifyWrite() {
        val dir = java.nio.file.Files.createTempDirectory("transfer-queue-concurrency").toFile()
        val pool = java.util.concurrent.Executors.newFixedThreadPool(4)
        try {
            val first = TransferQueueStore.inDirectory(dir, "account-a")
            first.upsert(QueuedTransfer(localId = "shared", source = source("shared")))
            val jobs = (1..100).map { part ->
                pool.submit {
                    TransferQueueStore.inDirectory(dir, "account-a").update("shared") { item ->
                        item.copy(uploadedParts = item.uploadedParts + part)
                    }
                }
            }
            jobs.forEach { it.get() }
            assertEquals((1..100).toSet(), first.load().single().uploadedParts)
        } finally {
            pool.shutdownNow()
            dir.deleteRecursively()
        }
    }
    private fun source(id: String) = TransferFileSource(
        uri = "content://com.example.provider/document/$id",
        displayName = "report-$id.txt",
        relativePath = "docs/report-$id.txt",
        sizeBytes = 1024 * 1024,
        mimeType = "text/plain",
    )

    @Test fun roundTripsQueueWithUploadedPartsAndStatus() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val store = TransferQueueStore.inDirectory(dir, "account-a")
            val item = QueuedTransfer(
                localId = "local-1",
                source = source("1"),
                sessionId = "session-a",
                fileId = "file-a-0000000001",
                partSize = 16 * 1024 * 1024,
                partCount = 3,
                uploadedParts = setOf(1, 2),
                uploadedBytes = 2048,
                status = TransferItemStatus.UPLOADING,
            )
            store.upsert(item)
            val loaded = TransferQueueStore.inDirectory(dir, "account-a").load().single()
            assertEquals(item, loaded)
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun accountsAreIsolatedByFile() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val storeA = TransferQueueStore.inDirectory(dir, "account-a")
            val storeB = TransferQueueStore.inDirectory(dir, "account-b")
            storeA.upsert(QueuedTransfer(localId = "a-1", source = source("a")))
            storeB.upsert(QueuedTransfer(localId = "b-1", source = source("b")))
            assertEquals(listOf("a-1"), storeA.load().map { it.localId })
            assertEquals(listOf("b-1"), storeB.load().map { it.localId })
            assertFalse(storeA.load().any { it.localId == "b-1" })
            storeA.clearForAccount("account-a")
            assertTrue(storeA.load().isEmpty())
            assertEquals(1, storeB.load().size)
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun removeAndCorruptFileRecovery() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val store = TransferQueueStore.inDirectory(dir, "account-a")
            store.upsert(QueuedTransfer(localId = "a-1", source = source("a")))
            store.upsert(QueuedTransfer(localId = "a-2", source = source("b")))
            store.remove("a-1")
            assertEquals(listOf("a-2"), store.load().map { it.localId })

            val file = File(dir, "transfer-queue-account-a.json")
            file.writeText("{corrupt json", Charsets.UTF_8)
            assertTrue(TransferQueueStore.inDirectory(dir, "account-a").load().isEmpty())
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun staleSessionResetKeepsSourcesAndRebuildsTheWholeActiveBatch() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val store = TransferQueueStore.inDirectory(dir, "account-a")
            val done = QueuedTransfer(
                localId = "done",
                source = source("done"),
                sessionId = "expired-session",
                fileId = "file-done",
                partSize = 16 * 1024 * 1024,
                partCount = 1,
                uploadedParts = setOf(1),
                uploadedBytes = 1024 * 1024,
                status = TransferItemStatus.DONE,
            )
            val failed = QueuedTransfer(
                localId = "large",
                source = source("large").copy(sizeBytes = 800L * 1024 * 1024),
                sessionId = "expired-session",
                fileId = "file-large",
                partSize = 16 * 1024 * 1024,
                partCount = 50,
                uploadedParts = setOf(1, 2),
                uploadedBytes = 32L * 1024 * 1024,
                status = TransferItemStatus.ERROR,
                errorMessage = "上传任务已过期",
            )
            val cancelled = QueuedTransfer(
                localId = "cancelled",
                source = source("cancelled"),
                sessionId = "expired-session",
                status = TransferItemStatus.CANCELLED,
            )
            store.save(listOf(done, failed, cancelled))

            val reset = store.resetStaleSessionBatch().associateBy { it.localId }

            for (id in listOf("done", "large")) {
                val item = requireNotNull(reset[id])
                assertEquals("", item.sessionId)
                assertEquals("", item.fileId)
                assertEquals(0, item.partCount)
                assertEquals(0L, item.uploadedBytes)
                assertTrue(item.uploadedParts.isEmpty())
                assertEquals(TransferItemStatus.PENDING, item.status)
                assertEquals("", item.errorMessage)
            }
            assertEquals(done.source, reset.getValue("done").source)
            assertEquals(failed.source, reset.getValue("large").source)
            assertEquals(cancelled, reset.getValue("cancelled"))
            assertEquals(reset.values.toSet(), store.load().toSet())
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun staleServerCodesAreExplicitAndFailClosed() {
        assertTrue(TransferRecoveryPolicy.shouldResetUpload("transfer_session_expired"))
        assertTrue(TransferRecoveryPolicy.shouldResetUpload("transfer_file_not_found"))
        assertFalse(TransferRecoveryPolicy.shouldResetUpload("authentication_required"))
        assertFalse(TransferRecoveryPolicy.shouldResetUpload("quota_exceeded"))
        assertTrue(TransferRecoveryPolicy.shouldResetCompletion("transfer_incomplete_upload"))
        assertFalse(TransferRecoveryPolicy.shouldResetCompletion("transfer_file_count_exceeded"))
        assertTrue(TransferRecoveryPolicy.shouldRefreshSession(401))
        assertFalse(TransferRecoveryPolicy.shouldRefreshSession(403))
        assertFalse(TransferRecoveryPolicy.shouldRefreshSession(429))
    }

    @Test fun failedLocalSourceCanBeIsolatedWithoutLosingPendingFiles() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val store = TransferQueueStore.inDirectory(dir, "account-a")
            val unreadable = QueuedTransfer(
                localId = "old-unreadable",
                source = source("old-unreadable"),
                status = TransferItemStatus.ERROR,
                errorMessage = "无法读取所选文件，请重新选择",
            )
            val pending = QueuedTransfer(
                localId = "new-large-file",
                source = source("new-large-file").copy(sizeBytes = 800L * 1024 * 1024),
            )
            store.save(listOf(unreadable, pending))

            val reloaded = store.load()
            assertEquals(TransferItemStatus.ERROR, reloaded.first().status)
            assertEquals(TransferItemStatus.PENDING, reloaded.last().status)
            assertEquals(800L * 1024 * 1024, reloaded.last().source.sizeBytes)
            assertEquals(1, reloaded.count { it.status != TransferItemStatus.ERROR })
        } finally {
            dir.deleteRecursively()
        }
    }
}
