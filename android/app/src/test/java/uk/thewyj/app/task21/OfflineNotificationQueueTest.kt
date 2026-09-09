package uk.thewyj.app.task21

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class OfflineNotificationQueueTest {
    @Test fun enqueueIsIdempotentPerOperationAndSurvivesReload() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val queue = OfflineNotificationQueue(File(dir, "queue-a.queue"))
            queue.enqueue("op-1", """{"operation_id":"op-1"}""")
            queue.enqueue("op-1", """{"operation_id":"op-1"}""")
            queue.enqueue("op-2", """{"operation_id":"op-2"}""")
            assertTrue("fsync must not truncate the queue", File(dir, "queue-a.queue").length() > 0L)
            val reloaded = OfflineNotificationQueue(File(dir, "queue-a.queue"))
            val entries = reloaded.peekAll()
            assertEquals(listOf("op-1", "op-2"), entries.map { it.first })
            assertTrue(entries.all { it.second.contains("operation_id") })

            reloaded.remove("op-1")
            assertEquals(listOf("op-2"), reloaded.peekAll().map { it.first })
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun retentionIsBoundedAndOldestEntriesAreDropped() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val queue = OfflineNotificationQueue(File(dir, "queue-a.queue"))
            repeat(OfflineNotificationQueue.MAX_QUEUE_ENTRIES + 10) { index ->
                queue.enqueue("op-$index", "payload-$index")
            }
            val entries = queue.peekAll()
            assertEquals(OfflineNotificationQueue.MAX_QUEUE_ENTRIES, entries.size)
            assertFalse(entries.any { it.first == "op-0" })
            assertTrue(entries.any { it.first == "op-${OfflineNotificationQueue.MAX_QUEUE_ENTRIES + 9}" })
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun corruptLinesAreSkippedAndClearForAccountEmptiesQueue() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val queueFile = File(dir, "queue-a.queue")
            val queue = OfflineNotificationQueue(queueFile)
            queue.enqueue("op-valid", "payload-valid")
            queueFile.appendText("corrupt-line-without-tab\n", Charsets.UTF_8)
            queueFile.appendText("not-base64\tstill-not-base64\n", Charsets.UTF_8)
            val loaded = OfflineNotificationQueue(queueFile)
            assertEquals(listOf("op-valid"), loaded.peekAll().map { it.first })

            loaded.clearForAccount("account-a")
            assertTrue(loaded.peekAll().isEmpty())
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun legacyTwoColumnRowsAndNewDeleteRowsRemainCompatible() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val queueFile = File(dir, "queue-a.queue")
            val encoder = java.util.Base64.getEncoder()
            fun encoded(value: String) = encoder.encodeToString(value.toByteArray(Charsets.UTF_8))
            queueFile.writeText(encoded("legacy-op") + "\t" + encoded("legacy-body") + "\n", Charsets.UTF_8)

            val queue = OfflineNotificationQueue(queueFile)
            assertEquals(OfflineNotificationQueue.INGEST_PATH, queue.peekRequests().single().path)
            queue.enqueueRequest(
                "delete-op",
                OfflineNotificationQueue.DELETE_PATH,
                """{"event_id":"event-a"}""",
            )
            val requests = queue.peekRequests()
            assertEquals(listOf(OfflineNotificationQueue.INGEST_PATH, OfflineNotificationQueue.DELETE_PATH), requests.map { it.path })
            assertEquals(2, queue.pendingCount())
        } finally {
            dir.deleteRecursively()
        }
    }
}
