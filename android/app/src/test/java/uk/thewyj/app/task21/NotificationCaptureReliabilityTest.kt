package uk.thewyj.app.task21

import android.content.Context
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.store.NotificationArchiveSinkFactory
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.NotificationQuery
import uk.thewyj.app.task21.store.RoomNotificationStore
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Reliability regression for the real capture pipeline: many packages, many
 * notification ids, in-place updates, budget duplicates, rapid bursts and
 * listener reconnects must all be archived without loss, and capture must
 * never depend on the network.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class NotificationCaptureReliabilityTest {
    private val context: Context = RuntimeEnvironment.getApplication()
    private lateinit var database: NotificationDatabase
    private lateinit var store: RoomNotificationStore
    private lateinit var root: File
    // Every test method gets its own account scope: the production database is
    // shared, and history counts must never depend on test order.
    private val accountId = "reliability-" + UUID.randomUUID()
    private val worker = Executors.newSingleThreadExecutor()

    /**
     * The production pipeline writes on its own executor; the JVM test mirrors
     * that so the Room main-thread guard stays enabled for everyone.
     */
    private fun <T> onWorker(block: () -> T): T = try {
        worker.submit(block).get()
    } catch (error: ExecutionException) {
        throw error.cause ?: error
    }

    private class RecordingTransport : NotificationIngestTransport {
        val calls = AtomicInteger(0)
        var delayMs = 0L
        override fun post(path: String, sessionToken: String, body: String): IngestResponse {
            calls.incrementAndGet()
            if (delayMs > 0) Thread.sleep(delayMs)
            return IngestResponse(ok = true, status = 200, body = "{}")
        }
    }

    private fun input(
        packageName: String,
        id: Int,
        title: String,
        text: String,
        postTime: Long,
    ) = NotificationCaptureInput(
        sourcePackage = packageName,
        sourceType = "notification",
        notificationKey = "$packageName|$id|",
        notificationId = id,
        tag = "",
        groupKey = "",
        channelId = "default",
        postTime = postTime,
        isGroup = false,
        isGroupSummary = false,
        title = title,
        text = text,
        bigText = "",
        subText = "",
        infoText = "",
        summaryText = "",
        textLines = emptyList(),
        receivedAtMs = postTime,
    )

    @Before fun setUp() {
        database = NotificationDatabase.get(context)
        store = RoomNotificationStore(database)
        root = File(context.filesDir, "reliability-${System.nanoTime()}").apply { mkdirs() }
    }

    @After fun tearDown() {
        worker.shutdownNow()
        root.deleteRecursively()
    }

    private fun coordinator(
        transport: RecordingTransport,
        financeEntitled: Boolean = true,
        archiveEntitled: Boolean = true,
    ) = NotificationCaptureCoordinator(
        archiveFor = { id -> LocalNotificationArchive.inDirectory(root, id) },
        queueFor = { id -> NotificationOfflineQueue.inDirectory(root, id) },
        transport = transport,
        account = {
            NotificationCaptureCoordinator.CaptureAccount(
                accountId = accountId,
                deviceId = "device",
                sessionToken = "token",
                financeEntitled = financeEntitled,
                archiveEntitled = archiveEntitled,
            )
        },
        archiveSink = NotificationArchiveSinkFactory.forContext(context),
    )

    private fun historyIds(): List<String> =
        store.history(accountId, NotificationQuery(includeRemoved = true, limit = 500)).map { it.instanceId }

    @Test fun burstAcrossPackagesIdsAndUpdatesIsArchivedWithoutNetwork() {
        onWorker {
            val transport = RecordingTransport().apply { delayMs = 2_000 }
            val coordinator = coordinator(transport)
            val started = System.currentTimeMillis()
            for (index in 0 until 60) {
                coordinator.onNotification(
                    input(
                        packageName = if (index % 3 == 0) "com.tencent.mm" else if (index % 3 == 1) "com.eg.android.AlipayGphone" else "com.bank.app",
                        id = index,
                        title = "通知 $index",
                        text = "内容 $index",
                        postTime = 1_000L + index,
                    ),
                )
            }
            val elapsed = System.currentTimeMillis() - started
            assertEquals("capture must not wait for uploads", 0, transport.calls.get())
            assertTrue("capture of 60 notifications took ${elapsed}ms", elapsed < 2_000)
            assertEquals(60, historyIds().size)
        }
    }

    /**
     * Task 24.1: the list shows one row per saved snapshot, so three content
     * changes are three history entries of the same conversation instance.
     */
    @Test fun updatingOneNotificationKeepsOneInstanceAndListsEverySnapshot() {
        onWorker {
            val coordinator = coordinator(RecordingTransport())
            coordinator.onNotification(input("com.tencent.mm", 7, "转账", "已收款 ¥10.00", 1_000L))
            coordinator.onNotification(input("com.tencent.mm", 7, "转账", "已收款 ¥20.00", 2_000L))
            coordinator.onNotification(input("com.tencent.mm", 7, "转账", "已收款 ¥30.00", 3_000L))
            val history = store.history(accountId, NotificationQuery(includeRemoved = true, limit = 10))
            assertEquals(3, history.size)
            assertEquals(3, history.first().revisionCount)
            assertEquals(1, history.map { it.instanceId }.distinct().size)
            assertEquals(listOf("已收款 ¥30.00", "已收款 ¥20.00", "已收款 ¥10.00"), history.map { it.text })
        }
    }

    @Test fun listenerReconnectReplayDoesNotDuplicateHistory() {
        onWorker {
            val coordinator = coordinator(RecordingTransport())
            val batch = listOf(
                input("com.tencent.mm", 1, "微信", "第一条", 1_000L),
                input("com.tencent.mm", 2, "微信", "第二条", 1_100L),
                input("com.eg.android.AlipayGphone", 3, "支付宝", "第三条", 1_200L),
            )
            batch.forEach(coordinator::onNotification)
            val afterFirstConnect = historyIds().size
            // Reconnect replays the currently active notifications exactly.
            batch.forEach(coordinator::onNotification)
            assertEquals(afterFirstConnect, historyIds().size)
            assertEquals(3, afterFirstConnect)
        }
    }

    @Test fun sameAmountFromDifferentNotificationsStaysSeparate() {
        onWorker {
            val coordinator = coordinator(RecordingTransport())
            coordinator.onNotification(input("com.tencent.mm", 21, "付款", "支付成功 ¥28.00", 1_000L))
            coordinator.onNotification(input("com.tencent.mm", 22, "付款", "支付成功 ¥28.00", 1_001L))
            assertEquals(2, historyIds().size)
        }
    }

    @Test fun archiveOnlyAccountStoresWithoutFinancePipeline() {
        onWorker {
            val transport = RecordingTransport()
            val coordinator = coordinator(transport, financeEntitled = false, archiveEntitled = true)
            coordinator.onNotification(input("com.tencent.mm", 31, "付款", "支付成功 ¥28.00", 1_000L))
            assertEquals(1, historyIds().size)
            assertEquals(0, coordinator.flush())
            assertEquals(0, transport.calls.get())
        }
    }

    @Test fun financeOnlyAccountNeverWritesTheNotificationArchive() {
        onWorker {
            val transport = RecordingTransport()
            val coordinator = coordinator(transport, financeEntitled = true, archiveEntitled = false)
            coordinator.onNotification(input("com.tencent.mm", 41, "付款", "支付成功 ¥28.00", 1_000L))
            assertEquals(0, historyIds().size)
            assertEquals(1, coordinator.flush())
            assertEquals(1, transport.calls.get())
        }
    }

    /**
     * The UI must observe the database: a notification written by the listener
     * is visible through the change flow without any polling or refresh call.
     */
    @Test fun storedNotificationIsObservableImmediately() {
        runBlocking {
            val emissions = CopyOnWriteArrayList<Unit>()
            val job = launch(Dispatchers.IO) { store.observeChanges(accountId).collect { emissions.add(it) } }
            try {
                delay(300)
                val baseline = emissions.size
                withContext(Dispatchers.IO) {
                    coordinator(RecordingTransport()).onNotification(
                        input("com.tencent.mm", 77, "微信支付", "已支付100", 5_000L),
                    )
                }
                delay(600)
                assertTrue(
                    "history change flow must emit after a capture (baseline=$baseline, now=${emissions.size})",
                    emissions.size > baseline,
                )
            } finally {
                job.cancel()
            }
        }
    }

    /**
     * Only an explicit "off" row blocks a package. Unknown/new apps must keep
     * being captured, otherwise notifications silently disappear after the user
     * touches the app selector.
     */
    @Test fun unknownAppsStayCapturedOncePoliciesExist() {
        onWorker {
            val coordinator = coordinator(RecordingTransport())
            store.setAppPolicy(accountId, "com.tencent.mm", enabled = false)
            coordinator.onNotification(input("com.tencent.mm", 51, "微信", "普通消息", 1_000L))
            assertEquals("explicitly disabled app must be skipped", 0, historyIds().size)
            coordinator.onNotification(input("com.newly.installed.app", 52, "新应用", "普通消息", 1_100L))
            assertEquals("unknown app must still be captured", 1, historyIds().size)
        }
    }

    /**
     * Real-device regression: download progress, system screenshots and
     * background-service notices must be archived like any other notification;
     * being ongoing/system/non-payment may never cause a silent drop.
     */
    /**
     * Task 24.1: group summaries are still archived, but progress, ongoing and
     * foreground-service status notifications are classified out of the archive
     * so a live readout can never flood the history or the UI.
     */
    @Test fun groupSummaryIsArchivedWhileProgressAndOngoingAreFiltered() {
        onWorker {
            val coordinator = coordinator(RecordingTransport())
            val systemNotice = input("com.android.systemui", 91, "系统", "已截屏", 2_000L).copy(
                sourceType = "notification",
                isGroupSummary = true,
            )
            val downloadProgress = input("com.android.providers.downloads", 92, "下载", "正在下载 42%", 2_100L)
                .copy(isOngoing = true)
            val serviceNotice = input("com.example.background", 93, "后台服务", "正在同步", 2_200L).copy(
                isGroup = true,
                isForegroundService = true,
            )
            coordinator.onNotification(systemNotice)
            coordinator.onNotification(downloadProgress)
            coordinator.onNotification(serviceNotice)
            assertEquals(1, historyIds().size)
        }
    }

    @Test fun paymentAndArchiveLifecyclesAreIndependent() {
        onWorker {
            val transport = RecordingTransport()
            val coordinator = coordinator(transport, financeEntitled = true, archiveEntitled = true)
            // A payment notification is archived and uploaded.
            coordinator.onNotification(input("com.tencent.mm", 61, "微信支付", "已支付100", 3_000L))
            assertEquals(1, historyIds().size)
            assertEquals(1, coordinator.flush())
            // A plain chat notification is archived but never uploaded.
            coordinator.onNotification(input("com.tencent.mm", 62, "微信", "张三：明天见面聊", 3_100L))
            assertEquals(2, historyIds().size)
            assertEquals(0, coordinator.flush())
            assertEquals(1, transport.calls.get())
        }
    }
}
