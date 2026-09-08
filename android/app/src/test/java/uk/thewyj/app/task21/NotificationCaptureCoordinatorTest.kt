package uk.thewyj.app.task21

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NotificationCaptureCoordinatorTest {
    private class FakeTransport : NotificationIngestTransport {
        val calls = mutableListOf<String>()
        var fail = false
        override fun post(path: String, sessionToken: String, body: String): IngestResponse {
            calls.add("$sessionToken|$body")
            return if (fail) IngestResponse(false, 503, "{}") else IngestResponse(true, 200, "{}")
        }
    }

    private fun coordinator(
        root: File,
        transport: FakeTransport,
        account: () -> NotificationCaptureCoordinator.CaptureAccount?,
    ) = NotificationCaptureCoordinator(
        archiveFor = { id -> LocalNotificationArchive.inDirectory(root, id) },
        queueFor = { id -> OfflineNotificationQueue(File(root, "queue-${id.take(40)}.queue")) },
        transport = transport,
        account = account,
    )

    @Test fun entitledAccountArchivesAndFlushesOnlyItsOwnQueue() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val transport = FakeTransport()
            var current = NotificationCaptureCoordinator.CaptureAccount("a", "device-a", "token-a", true)
            val coordinator = coordinator(dir, transport) { current }

            coordinator.onNotification("com.tencent.mm", "付款", "支付成功 ￥1.00", "", "", 1L)
            assertEquals(1, coordinator.flush())
            assertEquals(1, transport.calls.size)
            assertTrue(transport.calls.first().contains("token-a"))

            current = NotificationCaptureCoordinator.CaptureAccount("b", "device-b", "token-b", true)
            assertEquals(0, coordinator.flush())
            assertEquals(1, transport.calls.size)
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun unentitledAccountCapturesNothing() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val transport = FakeTransport()
            val current = NotificationCaptureCoordinator.CaptureAccount("a", "device-a", "token-a", false)
            val coordinator = coordinator(dir, transport) { current }
            coordinator.onNotification("com.tencent.mm", "付款", "支付成功 ￥1.00", "", "", 1L)
            assertEquals(0, transport.calls.size)
            assertEquals(0, coordinator.flush())
        } finally {
            dir.deleteRecursively()
        }
    }
}

