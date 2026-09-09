package uk.thewyj.app.task21

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NotificationCaptureCoordinatorTest {
    private class FakeTransport : NotificationIngestTransport {
        val calls = mutableListOf<String>()
        var fail = false
        var status = 200
        var throwNetwork = false
        override fun post(path: String, sessionToken: String, body: String): IngestResponse {
            calls.add("$path|$sessionToken|$body")
            if (throwNetwork) throw java.io.IOException("offline")
            val responseStatus = if (fail) 503 else status
            return IngestResponse(responseStatus in 200..299, responseStatus, "{}")
        }
    }

    private fun coordinator(
        root: File,
        transport: FakeTransport,
        account: () -> NotificationCaptureCoordinator.CaptureAccount?,
    ) = NotificationCaptureCoordinator(
        archiveFor = { id -> LocalNotificationArchive.inDirectory(root, id) },
        queueFor = { id -> NotificationOfflineQueue.inDirectory(root, id) },
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
            assertFalse(transport.calls.first().contains("支付成功"))
            assertFalse(transport.calls.first().contains("\"title\""))
            assertFalse(transport.calls.first().contains("\"text\""))

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

    @Test fun offlineQueueStaysBoundToOriginalAccountAcrossLogoutAndSwitch() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val transport = FakeTransport().apply { fail = true }
            var current: NotificationCaptureCoordinator.CaptureAccount? =
                NotificationCaptureCoordinator.CaptureAccount("a", "device-a", "token-a", true)
            val coordinator = coordinator(dir, transport) { current }

            coordinator.onNotification("com.tencent.mm", "付款", "支付成功 ￥1.00", "", "", 1L)
            assertEquals(0, coordinator.flush())
            assertEquals(1, transport.calls.size)

            // A logs out, B logs in: B must not be able to upload A's queued event.
            current = null
            assertEquals(0, coordinator.flush())
            current = NotificationCaptureCoordinator.CaptureAccount("b", "device-b", "token-b", true)
            assertEquals(0, coordinator.flush())
            assertEquals(1, transport.calls.size)

            // A logs back in: only now is A's own queue allowed to upload.
            transport.fail = false
            current = NotificationCaptureCoordinator.CaptureAccount("a", "device-a", "token-a", true)
            assertEquals(1, coordinator.flush())
            assertEquals(2, transport.calls.size)
            assertTrue(transport.calls.last().contains("token-a"))
            assertFalse(transport.calls.any { it.contains("token-b") })
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun expiredOrUnauthorizedSessionKeepsQueueUntilSessionRecovery() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val transport = FakeTransport().apply { status = 401 }
            val current = NotificationCaptureCoordinator.CaptureAccount("a", "device-a", "expired-token", true)
            val coordinator = coordinator(dir, transport) { current }
            coordinator.onNotification("com.tencent.mm", "付款", "支付成功 ￥1.00", "", "", 1L)

            val unauthorized = coordinator.flushDetailed()
            assertTrue(unauthorized.authenticationRequired)
            assertEquals(1, unauthorized.pending)
            assertEquals(0, unauthorized.uploaded)

            transport.status = 403
            val forbidden = coordinator.flushDetailed()
            assertTrue(forbidden.authenticationRequired)
            assertEquals(1, forbidden.pending)
            assertEquals(0, forbidden.uploaded)

            transport.status = 200
            val recovered = coordinator.flushDetailed()
            assertEquals(1, recovered.uploaded)
            assertEquals(0, recovered.pending)
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun retryableNetworkFailureAndDeleteRequestRemainStructured() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val transport = FakeTransport().apply { throwNetwork = true }
            val current = NotificationCaptureCoordinator.CaptureAccount("a", "device-a", "token-a", true)
            val queue = NotificationOfflineQueue.inDirectory(dir, "a")
            queue.enqueueRequest(
                "delete-event-a",
                OfflineNotificationQueue.DELETE_PATH,
                """{"event_id":"event-a"}""",
            )
            val coordinator = coordinator(dir, transport) { current }
            val offline = coordinator.flushDetailed()
            assertEquals(1, offline.pending)
            assertEquals(1, offline.retryableFailures)

            transport.throwNetwork = false
            val recovered = coordinator.flushDetailed()
            assertEquals(1, recovered.uploaded)
            assertEquals(0, recovered.pending)
            assertTrue(transport.calls.last().startsWith(OfflineNotificationQueue.DELETE_PATH))
        } finally {
            dir.deleteRecursively()
        }
    }
}
