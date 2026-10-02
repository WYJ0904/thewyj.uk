package uk.thewyj.app.task22

import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.util.concurrent.Executors

class TransferConfigStoreTest {
    @Test fun concurrentUiWritesAndWorkerReadsAlwaysSeeACompleteConfig() {
        val directory = Files.createTempDirectory("transfer-config-race").toFile()
        val pool = Executors.newFixedThreadPool(3)
        try {
            val first = TransferConfig(minutes = 60, maxDownloads = 1, password = "fixture-a")
            val second = TransferConfig(minutes = 4320, maxDownloads = 20, oneTime = true, password = "fixture-b")
            TransferConfigStore.inDirectory(directory, "fixture").save(first)
            val jobs = listOf(
                pool.submit { repeat(100) { TransferConfigStore.inDirectory(directory, "fixture").save(first) } },
                pool.submit { repeat(100) { TransferConfigStore.inDirectory(directory, "fixture").save(second) } },
                pool.submit { repeat(200) {
                    assertTrue(TransferConfigStore.inDirectory(directory, "fixture").load() in setOf(first, second))
                } },
            )
            jobs.forEach { it.get() }
            assertTrue(TransferConfigStore.inDirectory(directory, "other-account").load() == TransferConfig())
        } finally { pool.shutdownNow(); directory.deleteRecursively() }
    }
}
