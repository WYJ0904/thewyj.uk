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

    /** Payment hook that returns a fixed parse outcome for every capture. */
    private class FixedPaymentHook(private val parsed: PaymentIngestOutcome) : PaymentRecognitionHook {
        override fun onCapture(
            accountId: String,
            input: NotificationCaptureInput,
            sourceAppLabel: String,
            uploadEventId: String,
        ) = Unit

        override fun outcomeFor(input: NotificationCaptureInput): PaymentIngestOutcome = parsed
    }

    private fun paymentCoordinator(
        root: File,
        transport: NotificationIngestTransport,
        parsed: PaymentIngestOutcome,
    ) = NotificationCaptureCoordinator(
        archiveFor = { id -> LocalNotificationArchive.inDirectory(root, id) },
        queueFor = { id -> NotificationOfflineQueue.inDirectory(root, id) },
        transport = transport,
        account = { NotificationCaptureCoordinator.CaptureAccount("a", "device-a", "token-a", true) },
        paymentHook = FixedPaymentHook(parsed),
    )

    private fun parsedOutcome(
        amountMinor: Long,
        direction: FinanceDirection,
        confirmed: Boolean = true,
    ) = PaymentIngestOutcome(
        confirmed = confirmed,
        amountMinor = amountMinor,
        direction = direction,
        confidence = 950,
        merchant = "示例商户",
        counterparty = "示例商户",
        paymentChannel = "wechat",
        parserVersion = "test",
    )

    /**
     * Real-device root cause: the API rejects parsed/candidate events without a
     * direction (`structured_fields_required`). Sending them produced a 400 whose
     * payload the client deleted, so a recognised payment could never reach
     * Finance. Such a hint stays local until the user completes it.
     */
    @Test fun directionUnknownPaymentIsNeverUploaded() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val transport = FakeTransport()
            val coordinator = paymentCoordinator(
                dir,
                transport,
                parsedOutcome(2800, FinanceDirection.UNKNOWN, confirmed = false),
            )
            coordinator.onNotification("com.tencent.mm", "微信支付", "已支付 ¥28.00", "", "", 1L)
            assertEquals(0, coordinator.flush())
            assertEquals(0, transport.calls.size)
            assertEquals(0, coordinator.queuedRequests().size)
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun completePaymentIsUploaded() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val transport = FakeTransport()
            val coordinator = paymentCoordinator(dir, transport, parsedOutcome(2800, FinanceDirection.EXPENSE))
            coordinator.onNotification("com.tencent.mm", "微信支付", "已支付 ¥28.00", "", "", 1L)
            assertEquals(1, coordinator.flush())
            assertEquals(1, transport.calls.size)
        } finally {
            dir.deleteRecursively()
        }
    }

    /**
     * A 400 used to delete the queued payload, which is why the app could show
     * 「等待同步到云端账本」 forever while Finance stayed at 0 entries. The payload
     * must survive and the reason must be reported.
     */
    @Test fun rejectedUploadKeepsPayloadAndReportsTheReason() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val transport = object : NotificationIngestTransport {
                override fun post(path: String, sessionToken: String, body: String): IngestResponse =
                    IngestResponse(
                        false,
                        400,
                        """{"error":"支付渠道无效","code":"payment_channel_invalid"}""",
                    )
            }
            val coordinator = paymentCoordinator(dir, transport, parsedOutcome(2800, FinanceDirection.EXPENSE))
            coordinator.onNotification("cmb.pb", "招商银行", "已支付 ¥28.00", "", "", 1L)
            val result = coordinator.flushDetailed()
            assertEquals(0, result.uploaded)
            assertEquals(1, result.rejected.size)
            assertEquals("payment_channel_invalid", result.rejected.first().reason)
            assertEquals("the payload must not be deleted", 1, coordinator.queuedRequests().size)
            assertEquals(1, coordinator.queuedRequests().first().attempts)
        } finally {
            dir.deleteRecursively()
        }
    }

    /** A replay the server already accepted loses nothing when it is dropped. */
    @Test fun idempotentReplayIsNotTreatedAsARejection() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val transport = object : NotificationIngestTransport {
                override fun post(path: String, sessionToken: String, body: String): IngestResponse =
                    IngestResponse(false, 409, """{"ok":true,"duplicate":true}""")
            }
            val coordinator = paymentCoordinator(dir, transport, parsedOutcome(2800, FinanceDirection.EXPENSE))
            coordinator.onNotification("cmb.pb", "招商银行", "已支付 ¥28.00", "", "", 1L)
            val result = coordinator.flushDetailed()
            assertEquals(1, result.discardedInvalid)
            assertEquals(0, result.rejected.size)
            assertEquals(0, coordinator.queuedRequests().size)
        } finally {
            dir.deleteRecursively()
        }
    }

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
