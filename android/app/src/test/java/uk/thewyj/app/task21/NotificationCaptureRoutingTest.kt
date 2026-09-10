package uk.thewyj.app.task21

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Entitlement matrix for the capture pipeline:
 *  - finance_access: recognise and ingest transactions, never archive chat;
 *  - notification_archive_access: archive history, never touch Finance;
 *  - both / all_features: archive + ingest;
 *  - neither: nothing at all.
 */
class NotificationCaptureRoutingTest {
    private class FakeTransport : NotificationIngestTransport {
        val calls = mutableListOf<String>()
        override fun post(path: String, sessionToken: String, body: String): IngestResponse {
            calls.add(body)
            return IngestResponse(true, 200, "{}")
        }
    }

    private class FakeArchive : NotificationArchiveStore {
        val records = mutableListOf<LocalNotificationRecord>()
        override fun append(record: LocalNotificationRecord): Boolean {
            records.add(record)
            return true
        }
        override fun containsFingerprint(fingerprint: String): Boolean = records.any { it.fingerprint == fingerprint }
        override fun listRecent(limit: Int): List<LocalNotificationRecord> = records.takeLast(limit)
        override fun delete(id: String): Boolean = records.removeAll { it.id == id }
        override fun clearForAccount(accountId: String) {
            records.clear()
        }
    }

    private class FakeSink : NotificationArchiveSink {
        val stored = mutableListOf<Pair<String, String>>()
        var removals = 0
        override fun store(
            accountId: String,
            input: NotificationCaptureInput,
            parsed: StructuredNotificationEvent?,
        ): Boolean {
            stored.add(accountId to input.text)
            return true
        }
        override fun markRemoved(accountId: String, input: NotificationCaptureInput) {
            removals += 1
        }
    }

    private fun tempRoot(): File = File.createTempFile("wyj-routing", ".tmp").let {
        it.delete()
        it.mkdirs()
        it
    }

    private fun coordinator(
        root: File,
        account: NotificationCaptureCoordinator.CaptureAccount,
        transport: FakeTransport,
        archive: FakeArchive,
        sink: FakeSink,
    ) = NotificationCaptureCoordinator(
        archiveFor = { archive },
        queueFor = { id -> NotificationOfflineQueue.inDirectory(root, id) },
        transport = transport,
        account = { account },
        archiveSink = sink,
    )

    @Test fun financeOnlyClassifiesInMemoryAndNeverArchivesChat() {
        val root = tempRoot()
        try {
            val transport = FakeTransport()
            val archive = FakeArchive()
            val sink = FakeSink()
            val coordinator = coordinator(
                root,
                NotificationCaptureCoordinator.CaptureAccount("a", "d", "t", financeEntitled = true, archiveEntitled = false),
                transport,
                archive,
                sink,
            )

            coordinator.onNotification("org.telegram.messenger", "老周", "你好", "", "", 1_000L)
            assertEquals(0, coordinator.flush())

            coordinator.onNotification("com.tencent.mm", "微信支付", "支付成功 ￥28.00", "", "", 2_000L)
            assertEquals(1, coordinator.flush())

            assertTrue("finance-only must not write the archive", archive.records.isEmpty())
            assertTrue("finance-only must not write the archive sink", sink.stored.isEmpty())
            assertTrue(transport.calls.first().contains("\"amount_minor\":2800"))
            assertTrue(
                "raw notification text must never be uploaded",
                transport.calls.none { it.contains("支付成功") || it.contains("老周") },
            )
        } finally {
            root.deleteRecursively()
        }
    }

    @Test fun archiveOnlyStoresHistoryAndNeverCreatesFinanceEvents() {
        val root = tempRoot()
        try {
            val transport = FakeTransport()
            val archive = FakeArchive()
            val sink = FakeSink()
            val coordinator = coordinator(
                root,
                NotificationCaptureCoordinator.CaptureAccount("a", "d", "t", financeEntitled = false, archiveEntitled = true),
                transport,
                archive,
                sink,
            )

            coordinator.onNotification("com.tencent.mm", "微信支付", "支付成功 ￥28.00", "", "", 3_000L)
            assertEquals(1, sink.stored.size)
            assertEquals(0, coordinator.flush())
            assertTrue("archive-only must not queue finance events", transport.calls.isEmpty())
        } finally {
            root.deleteRecursively()
        }
    }

    @Test fun bothEntitlementsArchiveAndIngest() {
        val root = tempRoot()
        try {
            val transport = FakeTransport()
            val archive = FakeArchive()
            val sink = FakeSink()
            val coordinator = coordinator(
                root,
                NotificationCaptureCoordinator.CaptureAccount("a", "d", "t", financeEntitled = true, archiveEntitled = true),
                transport,
                archive,
                sink,
            )

            coordinator.onNotification("com.tencent.mm", "微信支付", "支付成功 ￥28.00", "", "", 4_000L)
            assertEquals(1, coordinator.flush())
            assertEquals(1, sink.stored.size)
            assertEquals(1, transport.calls.size)
            assertTrue(transport.calls.first().contains("\"amount_minor\":2800"))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test fun neitherEntitlementCapturesNothing() {
        val root = tempRoot()
        try {
            val transport = FakeTransport()
            val archive = FakeArchive()
            val sink = FakeSink()
            val coordinator = coordinator(
                root,
                NotificationCaptureCoordinator.CaptureAccount("a", "d", "t", financeEntitled = false, archiveEntitled = false),
                transport,
                archive,
                sink,
            )

            coordinator.onNotification("com.tencent.mm", "微信支付", "支付成功 ￥28.00", "", "", 5_000L)
            coordinator.onRemoved(NotificationCaptureInput(sourcePackage = "com.tencent.mm"))
            assertEquals(0, coordinator.flush())
            assertTrue(archive.records.isEmpty())
            assertTrue(sink.stored.isEmpty())
            assertEquals(0, sink.removals)
            assertTrue(transport.calls.isEmpty())
        } finally {
            root.deleteRecursively()
        }
    }

    @Test fun removalOnlyTouchesArchiveEntitledAccounts() {
        val root = tempRoot()
        try {
            val sink = FakeSink()
            val archiveSinkCoordinator = coordinator(
                root,
                NotificationCaptureCoordinator.CaptureAccount("a", "d", "t", financeEntitled = false, archiveEntitled = true),
                FakeTransport(),
                FakeArchive(),
                sink,
            )
            archiveSinkCoordinator.onRemoved(
                NotificationCaptureInput(sourcePackage = "com.tencent.mm", notificationKey = "com.tencent.mm|1|"),
            )
            assertEquals(1, sink.removals)

            val financeOnly = coordinator(
                root,
                NotificationCaptureCoordinator.CaptureAccount("b", "d", "t", financeEntitled = true, archiveEntitled = false),
                FakeTransport(),
                FakeArchive(),
                sink,
            )
            financeOnly.onRemoved(
                NotificationCaptureInput(sourcePackage = "com.tencent.mm", notificationKey = "com.tencent.mm|1|"),
            )
            assertEquals("finance-only accounts have no archive to update", 1, sink.removals)
        } finally {
            root.deleteRecursively()
        }
    }
}
