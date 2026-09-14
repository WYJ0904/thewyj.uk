package uk.thewyj.app.task21

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.thewyj.app.task21.screenshot.ScreenshotEvidence
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

    /** Payment hook that keeps the identity the coordinator recorded locally. */
    private class RecordingPaymentHook(private val parsed: PaymentIngestOutcome) : PaymentRecognitionHook {
        val uploadEventIds = mutableListOf<String>()

        override fun onCapture(
            accountId: String,
            input: NotificationCaptureInput,
            sourceAppLabel: String,
            uploadEventId: String,
        ) {
            uploadEventIds.add(uploadEventId)
        }

        override fun outcomeFor(input: NotificationCaptureInput): PaymentIngestOutcome = parsed
    }

    /** Archive sink double that keeps every capture it was asked to store. */
    private class RecordingSink : NotificationArchiveSink {
        val inputs = mutableListOf<NotificationCaptureInput>()

        override fun store(
            accountId: String,
            input: NotificationCaptureInput,
            parsed: StructuredNotificationEvent?,
        ): Boolean {
            inputs.add(input)
            return true
        }

        override fun markRemoved(accountId: String, input: NotificationCaptureInput) = Unit
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
    @Test fun directionUnknownPaymentBecomesAPendingHintNotATransaction() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val transport = FakeTransport()
            val coordinator = paymentCoordinator(
                dir,
                transport,
                parsedOutcome(2800, FinanceDirection.UNKNOWN, confirmed = false),
            )
            coordinator.onNotification("com.tencent.mm", "微信支付", "已支付 ¥28.00", "", "", 1L)
            val queued = coordinator.queuedRequests()
            assertEquals(1, queued.size)
            // It goes to the unified pending-hint endpoint only: never an event
            // ingest that could book a transaction without a direction.
            assertTrue(queued.first().path.endsWith("/api/notification/hints"))
            assertTrue(transport.calls.none { it.contains("/api/notification/ingest") })
            assertEquals(1, coordinator.flush())
            assertTrue(coordinator.flushDetailed().outcomes.isEmpty())
        } finally {
            dir.deleteRecursively()
        }
    }

    /**
     * Task 24.4 real-device regression (¥104.49 / 招商银行): an incomplete
     * payment is published as a pending hint, so the local recognition must
     * remember that same event id. Leaving it blank made the server pull unable
     * to match a Web-side confirm back to the Android row, and the item stayed
     * in 「待核实 / 待确认」forever.
     */
    @Test fun incompletePaymentRecordsTheHintEventIdForTheServerPull() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val transport = FakeTransport()
            val hook = RecordingPaymentHook(parsedOutcome(10449, FinanceDirection.UNKNOWN, confirmed = false))
            val coordinator = NotificationCaptureCoordinator(
                archiveFor = { id -> LocalNotificationArchive.inDirectory(dir, id) },
                queueFor = { id -> NotificationOfflineQueue.inDirectory(dir, id) },
                transport = transport,
                account = { NotificationCaptureCoordinator.CaptureAccount("a", "device-a", "token-a", true) },
                paymentHook = hook,
            )
            coordinator.onNotification("cmb.pb", "招商银行", "已支付 ¥104.49", "", "", 1L)
            coordinator.flush()

            assertTrue(transport.calls.any { it.contains("/api/notification/hints") })
            val hintEventId = Regex("\"source_event_id\":\"([^\"]+)\"")
                .find(transport.calls.first { it.contains("/api/notification/hints") })
                ?.groupValues
                ?.getOrNull(1)
                .orEmpty()
            assertTrue("the hint must carry a source event id", hintEventId.isNotBlank())
            assertEquals(
                "the local recognition must record the same event id the hint is uploaded under",
                hintEventId,
                hook.uploadEventIds.single(),
            )
        } finally {
            dir.deleteRecursively()
        }
    }

    /**
     * Task 24 device regression (WeChat dual-app, 2026-09-14): one Android
     * notification key was updated eleven seconds later with a new postTime.
     * Treating postTime as identity produced a second recognition and a second
     * cloud hint for the same payment lifecycle.
     */
    @Test fun paymentUpdatesReuseOneEventUntilTheNotificationIsRemoved() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val hook = RecordingPaymentHook(parsedOutcome(0, FinanceDirection.UNKNOWN, confirmed = false))
            val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002"))
            val coordinator = NotificationCaptureCoordinator(
                archiveFor = { id -> LocalNotificationArchive.inDirectory(dir, id) },
                queueFor = { id -> NotificationOfflineQueue.inDirectory(dir, id) },
                transport = FakeTransport(),
                account = { NotificationCaptureCoordinator.CaptureAccount("a", "device-a", "token-a", true) },
                paymentHook = hook,
                paymentLifecycleRegistry = InMemoryPaymentNotificationLifecycleRegistry { ids.removeFirst() },
            )
            val first = NotificationCaptureInput(
                sourcePackage = "com.tencent.mm",
                notificationKey = "95|com.tencent.mm|-243922068|null|9510390",
                notificationId = -243922068,
                title = "微信支付",
                text = "转账待确认",
                postTime = 1_000L,
                receivedAtMs = 1_000L,
            )
            val update = first.copy(text = "转账状态已经更新", postTime = 12_000L, receivedAtMs = 12_000L)

            coordinator.onNotification(first)
            coordinator.onNotification(update)

            assertEquals(listOf("payment-event-0001", "payment-event-0001"), hook.uploadEventIds)
            assertEquals("same lifecycle must leave one pending operation", 1, coordinator.queuedRequests().size)
            assertTrue(coordinator.queuedRequests().single().operationId.endsWith("payment-event-0001"))

            coordinator.onRemoved(update)
            coordinator.onNotification(first.copy(postTime = 30_000L, receivedAtMs = 30_000L))
            assertEquals("removal must open a new lifecycle", "payment-event-0002", hook.uploadEventIds.last())
            assertEquals(2, coordinator.queuedRequests().size)
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
                    IngestResponse(
                        false,
                        409,
                        """{"ok":true,"duplicate":true,"operation_results":[{"duplicate":true,"transaction_id":"txn-1"}]}""",
                    )
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

    /**
     * P0 real-device regression: a `duplicate` answer *without* a transaction or
     * candidate id means the server saw the event but never booked it. The
     * payload must stay queued and be reported as a failure instead of being
     * deleted (that silent delete is why a recognised amount never reached
     * Finance).
     */
    @Test fun duplicateWithoutLedgerIdentityKeepsThePaymentAndReportsFailure() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val transport = object : NotificationIngestTransport {
                override fun post(path: String, sessionToken: String, body: String): IngestResponse =
                    IngestResponse(false, 409, """{"ok":true,"duplicate":true}""")
            }
            val coordinator = paymentCoordinator(dir, transport, parsedOutcome(2800, FinanceDirection.EXPENSE))
            coordinator.onNotification("cmb.pb", "招商银行", "已支付 ¥28.00", "", "", 1L)
            val result = coordinator.flushDetailed()
            assertEquals("a bare duplicate must not be discarded", 0, result.discardedInvalid)
            assertEquals(1, result.rejected.size)
            assertEquals(1, coordinator.queuedRequests().size)
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

    /**
     * Task 24 reopen #5: the coordinator owns the identity. A per-second readout
     * that the classifier recognised as an update must reach the archive marked
     * `coalesceWithPrevious`, so the store rewrites the row instead of appending
     * one history entry per second.
     */
    @Test fun updatingNotificationReachesTheArchiveAsACoalescedUpdate() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val sink = RecordingSink()
            val current = NotificationCaptureCoordinator.CaptureAccount("a", "device-a", "token-a", true)
            val coordinator = NotificationCaptureCoordinator(
                archiveFor = { id -> LocalNotificationArchive.inDirectory(dir, id) },
                queueFor = { id -> NotificationOfflineQueue.inDirectory(dir, id) },
                transport = FakeTransport(),
                account = { current },
                archiveSink = sink,
            )
            fun post(text: String, at: Long) = coordinator.onNotification(
                NotificationCaptureInput(
                    sourcePackage = "com.samsung.android.app.screenrecorder",
                    notificationKey = "recorder|1|",
                    notificationId = 1,
                    channelId = "recording",
                    postTime = at,
                    title = "屏幕录制",
                    text = text,
                    receivedAtMs = at,
                ),
            )
            post("录屏中 00:01", 1_000L)
            post("录屏中 00:02", 2_000L)
            post("录屏中 00:03", 3_000L)

            assertEquals(3, sink.inputs.size)
            assertFalse(sink.inputs.first().coalesceWithPrevious)
            assertFalse(sink.inputs[1].coalesceWithPrevious)
            assertTrue(
                "the timer tick must update the existing archive row",
                sink.inputs.last().coalesceWithPrevious,
            )
        } finally {
            dir.deleteRecursively()
        }
    }

    /**
     * B-5 Samsung SM-S9360 regression: SmartCapture owns both screenshots and
     * screen recording. The package-only screenshot detector gave every timer
     * tick a timestamp identity, so 100 seconds produced roughly 100 durable
     * revisions even though the platform marked the notification ongoing.
     */
    @Test fun samsungScreenRecordingHasABoundedPersistentLifecycleAcross121Ticks() {
        val dir = File.createTempFile("wyj", ".tmp").let { it.delete(); it.mkdirs(); it }
        try {
            val sink = RecordingSink()
            val current = NotificationCaptureCoordinator.CaptureAccount("a", "device-a", "token-a", true)
            val coordinator = NotificationCaptureCoordinator(
                archiveFor = { id -> LocalNotificationArchive.inDirectory(dir, id) },
                queueFor = { id -> NotificationOfflineQueue.inDirectory(dir, id) },
                transport = FakeTransport(),
                account = { current },
                archiveSink = sink,
            )
            fun post(text: String, at: Long, ongoing: Boolean) {
                val screenshot = ScreenshotEvidence.isScreenshotEvent(
                    sourcePackage = "com.samsung.android.app.smartcapture",
                    channelId = "screen_recording",
                    title = "屏幕录制",
                    text = text,
                    bigText = "",
                    hasMedia = true,
                )
                coordinator.onNotification(
                    NotificationCaptureInput(
                        sourcePackage = "com.samsung.android.app.smartcapture",
                        notificationKey = "0|com.samsung.android.app.smartcapture|42|null|1000",
                        notificationId = 42,
                        channelId = "screen_recording",
                        postTime = at,
                        eventTimeMs = at,
                        isOngoing = ongoing,
                        title = "屏幕录制",
                        text = text,
                        mediaState = "unavailable",
                        screenshotEvent = screenshot,
                        receivedAtMs = at,
                    ),
                )
            }

            for (tick in 0..120) {
                post("录屏中 %02d:%02d".format(tick / 60, tick % 60), 1_000L + tick * 1_000L, ongoing = true)
            }
            assertEquals(
                "an ongoing recorder must never persist one revision per tick",
                0,
                sink.inputs.size,
            )

            post("录屏已保存", 123_000L, ongoing = false)
            assertEquals("one meaningful terminal transition may be archived", 1, sink.inputs.size)
            assertFalse(sink.inputs.single().screenshotEvent)
        } finally {
            dir.deleteRecursively()
        }
    }
}
