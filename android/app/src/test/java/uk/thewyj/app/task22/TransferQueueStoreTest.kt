package uk.thewyj.app.task22

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class TransferQueueStoreTest {
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
}
