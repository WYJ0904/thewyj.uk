package uk.thewyj.app.task22

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class TransferCleanupStoreTest {
    @Test fun failedReleaseSurvivesRestartAndIsRetriedWithoutCrossAccountLeak() {
        val dir = Files.createTempDirectory("transfer-release-test").toFile()
        try {
            val store = TransferCleanupStore.inDirectory(dir, "account-a")
            store.add(listOf("session-00000001", "session-00000001"))
            assertFalse(store.retry { error("offline") })
            val restored = TransferCleanupStore.inDirectory(dir, "account-a")
            assertEquals(listOf("session-00000001"), restored.pending())
            assertTrue(TransferCleanupStore.inDirectory(dir, "account-b").pending().isEmpty())
            val released = mutableListOf<String>()
            assertTrue(restored.retry { released += it })
            assertEquals(listOf("session-00000001"), released)
            assertTrue(TransferCleanupStore.inDirectory(dir, "account-a").pending().isEmpty())
        } finally { dir.deleteRecursively() }
    }

    @Test fun replacedBatchRejectsOldWorkerWritesAndPreservesPause() {
        val dir = Files.createTempDirectory("transfer-generation-test").toFile()
        try {
            val store = TransferQueueStore.inDirectory(dir, "account-a")
            val source = TransferFileSource("content://fixture/a", "a.bin", "a.bin", 4096, "application/octet-stream")
            store.save(listOf(QueuedTransfer("a", source, sessionId = "old-session", status = TransferItemStatus.PAUSED)))
            val generation = store.generation()
            store.resetStaleSessionBatch()
            assertNull(store.updateIfGeneration("a", generation) { it.copy(status = TransferItemStatus.DONE) })
            assertEquals(TransferItemStatus.PAUSED, store.load().single().status)
            assertEquals("", store.load().single().sessionId)
            store.remove("a")
            assertNull(store.updateIfGeneration("a", store.generation()) { it.copy(status = TransferItemStatus.DONE) })
            assertTrue(store.load().isEmpty())
        } finally { dir.deleteRecursively() }
    }
}
