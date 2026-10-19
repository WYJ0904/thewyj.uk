package uk.thewyj.app.task21.payment

import android.app.Application
import androidx.room.Room
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.*
import uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome
import uk.thewyj.app.task21.store.*

private const val OWNER = "synthetic-p03-bridge-owner"
internal class Bridge(private val transport: NotificationIngestTransport, private val firstId: Int) : AutoCloseable {
    val output = File(System.getProperty("finance.p03.output")).apply { mkdirs() }
    val context: Application = RuntimeEnvironment.getApplication()
    val db = Room.databaseBuilder(context, NotificationDatabase::class.java, File(output, "bridge.db").absolutePath)
        .addMigrations(NotificationDatabase.MIGRATION_10_11, NotificationDatabase.MIGRATION_11_12).allowMainThreadQueries().build()
    val store = RoomPaymentRecognitionStore(db)
    val queue = NotificationOfflineQueue.inDirectory(File(output, "queue"), OWNER)
    private val sink = object : NotificationArchiveSink {
        override fun store(accountId: String, input: NotificationCaptureInput, parsed: StructuredNotificationEvent?) = false
        override fun markRemoved(accountId: String, input: NotificationCaptureInput) = Unit
        override fun storeMediaStoreScreenshot(accountId: String, event: ScreenshotMediaEvent) = ScreenshotArchiveOutcome.SKIPPED
    }
    val hook = AndroidPaymentRecognitionHook(context, sink, store, testing = true, notifierOverride = object : PaymentStatusNotifier {
        override fun notify(message: PaymentStatusNotificationMessage) = true
        override fun cancel(notificationId: Int) = Unit
    })
    private var sequence = firstId
    val registry = AndroidPaymentNotificationLifecycleRegistry(context, now = { 1000L }, idFactory = { "synthetic-bridge-${sequence++}" })
    val pipeline = NotificationCaptureCoordinator(
        archiveFor = { LocalNotificationArchive.inDirectory(File(output, "archive"), it) }, queueFor = { queue },
        transport = transport, account = { NotificationCaptureCoordinator.CaptureAccount(OWNER, "synthetic-bridge-device", "synthetic-no-auth-session", true, false) },
        archiveSink = sink, paymentHook = hook, paymentLifecycleRegistry = registry,
    )
    fun capture(text: String, bank: Boolean = false, key: String = "synthetic-bridge-wechat", uid: Int = if (bank) 10040 else 10030) {
        pipeline.onNotification(NotificationCaptureInput(
            sourcePackage = if (bank) "cmb.pb" else "com.tencent.mm", sourceType = if (bank) "bank" else "notification",
            notificationKey = key, notificationId = 7, title = if (bank) "招商银行" else "微信支付", text = text,
            postTime = 1000, receivedAtMs = 1000, sourceUid = uid,
        ))
    }
    fun snapshot(): JSONObject {
        val bookings = JSONArray(store.localBookings(OWNER).map { b -> JSONObject()
            .put("event_id", b.eventId).put("transaction_id", b.transactionId).put("amount_minor", b.amountMinor)
            .put("currency", b.currency).put("sync_state", b.syncState) })
        return JSONObject().put("pid", ProcessHandle.current().pid()).put("bookings", bookings)
            .put("queue", JSONArray(queue.peekRequests().map { q -> JSONObject().put("operation_id", q.operationId).put("path", q.path).put("body", JSONObject(q.body)) }))
    }
    override fun close() = db.close()
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class P03BridgeSeedTest {
    @Test fun persistRealCaptureBookingsAndFailedNetworkQueue() {
        val output = File(System.getProperty("finance.p03.output")).apply { mkdirs() }
        assertFalse("preserve the previous seed", File(output, "bridge.db").exists())
        val offline = object : NotificationIngestTransport { override fun post(path: String, sessionToken: String, body: String) = IngestResponse(false, 503, "{}") }
        Bridge(offline, 0).use { b ->
            repeat(30) { b.capture("支付成功 实付¥648.00 交易号 SYNTH-BRIDGE-A") }
            b.capture("支付成功 实付¥648.00 交易号 SYNTH-BRIDGE-B")
            b.capture("支付成功 实付¥648.00", key = "synthetic-bridge-weak")
            b.capture("预授权 USD 200.00 交易号 SYNTH-BRIDGE-AUTH", true, "synthetic-bridge-bank")
            b.capture("结算成功 已扣款 USD 170.00 交易号 SYNTH-BRIDGE-AUTH", true, "synthetic-bridge-bank")
            b.capture("预授权解除 USD 200.00 交易号 SYNTH-BRIDGE-AUTH", true, "synthetic-bridge-bank")
            repeat(30) { b.capture("支付成功 实付¥648.00 交易号 SYNTH-BRIDGE-A", uid = 20030) }
            assertEquals(3, b.store.localBookings(OWNER).size)
            assertEquals(7, b.queue.peekRequests().size)
            val conflict = b.queue.peekRequests().map { JSONObject(it.body).getJSONArray("operations").getJSONObject(0).getJSONObject("payload") }
                .single { it.optString("identity_review_reason") == "reference_money_or_instance_conflict" }
            assertEquals("candidate", conflict.getString("parse_status"))
            val flush = b.pipeline.flushDetailed()
            assertTrue(flush.retryableFailures > 0)
            assertEquals(7, flush.pending)
            File(output, "seed.json").writeText(b.snapshot().put("status", "PASS").toString(2))
        }
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class P03BridgeRestoreTest {
    @Test fun freshJvmReplaysLostAcknowledgementThenReceivesStableCanonicalIds() {
        val output = File(System.getProperty("finance.p03.output"))
        val port = JSONObject(File(output, "port.json").readText()).getInt("port")
        val seed = JSONObject(File(output, "seed.json").readText())
        assertNotEquals(seed.getLong("pid"), ProcessHandle.current().pid())
        Bridge(HttpNotificationIngestTransport("http://127.0.0.1:$port"), 100).use { b ->
            assertEquals(3, b.store.localBookings(OWNER).size)
            assertEquals(7, b.queue.peekRequests().size)
            val lostAck = b.pipeline.flushDetailed()
            assertTrue("server commits then deliberately drops only its first acknowledgement", lostAck.retryableFailures > 0)
            assertEquals(7, lostAck.pending)
            val recovered = b.pipeline.flushDetailed()
            assertEquals(0, recovered.pending)
            assertEquals(3, b.store.localBookings(OWNER).size)
            assertTrue(b.store.localBookings(OWNER).all { it.syncState == "synced" })
            val stableIds = b.store.localBookings(OWNER).associate { it.eventId to it.transactionId }
            // The new JVM's empty lifecycle cache creates a new delivery alias.
            // Persistent reference proof must still retain the first ledger ID.
            repeat(30) { b.capture("支付成功 实付¥648.00 交易号 SYNTH-BRIDGE-A") }
            assertEquals(0, b.pipeline.flushDetailed().pending)
            assertEquals(stableIds, b.store.localBookings(OWNER).associate { it.eventId to it.transactionId })
            stableIds.forEach { (event, _) -> b.hook.onFinanceOutcome(OWNER, event, "synthetic-late-wrong-receipt") }
            assertEquals(stableIds, b.store.localBookings(OWNER).associate { it.eventId to it.transactionId })
            File(output, "restore.json").writeText(b.snapshot().put("status", "PASS").put("old_pid", seed.getLong("pid")).toString(2))
        }
    }
}
