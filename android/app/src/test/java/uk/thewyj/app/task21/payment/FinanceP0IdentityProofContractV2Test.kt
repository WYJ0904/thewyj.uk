package uk.thewyj.app.task21.payment

import android.app.Application
import androidx.room.Room
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.*
import uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome
import uk.thewyj.app.task21.store.*
import java.io.File
import java.util.UUID
import java.nio.file.Files

/** New explicit-currency contracts, not replacements for the frozen raw tests. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class FinanceP0IdentityProofContractV2Test {
    private lateinit var db: NotificationDatabase
    private lateinit var store: RoomPaymentRecognitionStore
    private val owner = "synthetic-p0-proof-v2"

    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), NotificationDatabase::class.java)
            .allowMainThreadQueries().build()
        store = RoomPaymentRecognitionStore(db)
    }
    @After fun close() { db.close() }
    private fun hook(sink: NotificationArchiveSink? = null): AndroidPaymentRecognitionHook {
        val noArchive = object : NotificationArchiveSink {
            override fun store(accountId: String, input: NotificationCaptureInput, parsed: StructuredNotificationEvent?) = false
            override fun markRemoved(accountId: String, input: NotificationCaptureInput) = Unit
            override fun storeMediaStoreScreenshot(accountId: String, event: ScreenshotMediaEvent) = ScreenshotArchiveOutcome.SKIPPED
        }
        return AndroidPaymentRecognitionHook(RuntimeEnvironment.getApplication(), sink ?: noArchive, store, testing = true,
            notifierOverride = object : PaymentStatusNotifier {
                override fun notify(message: PaymentStatusNotificationMessage) = true
                override fun cancel(notificationId: Int) = Unit
            })
    }
    private fun message(id: String, text: String = "支付成功 CNY 648.00", proof: String = "synthetic-durable-message") =
        NotificationCaptureInput("com.tencent.mm", title = "微信支付", text = text,
            notificationKey = "synthetic-message-slot", notificationId = 7, receivedAtMs = 1000,
            paymentEventId = id, messageIdentity = NotificationFingerprint.sha256Hex(proof), sourceUid = 10030)

    @Test fun explicitCurrencyDurableMessageProofSurvivesCacheReplacement() {
        val h = hook()
        val input = message("synthetic-message-before")
        h.onCapture(owner, input, "微信", input.paymentEventId)
        val before = store.localBookings(owner).single()
        repeat(30) { i ->
            val newer = input.copy(paymentEventId = "synthetic-cache-replacement-$i", postTime = 21600000L + i)
            h.onCapture(owner, newer, "微信", newer.paymentEventId)
        }
        assertEquals(listOf(before), store.localBookings(owner))
        assertEquals(before.transactionId, h.localFinanceTransactionId(owner, "synthetic-cache-replacement-29"))
    }

    @Test fun explicitCurrencyMultipleOrdersOnOneMessageForceSeparateReview() {
        val h = hook()
        val input = message("synthetic-msg-ref-a", "支付成功 CNY 648.00 交易号 SYNTH-MSG-ORDER-A", "synthetic-ambiguous-message")
        h.onCapture(owner, input, "微信", input.paymentEventId)
        val b = input.copy(text = "支付成功 CNY 648.00 交易号 SYNTH-MSG-ORDER-B", paymentEventId = "synthetic-msg-ref-b")
        h.onCapture(owner, b, "微信", b.paymentEventId)
        assertEquals(2, store.localBookings(owner).size)
        val unclear = input.copy(text = "支付成功 CNY 648.00")
        val payment = h.prepareIdentity(owner, unclear, h.outcomeFor(unclear)!!)
        assertEquals("message_identity_ambiguous", payment.identityReviewReason)
        assertFalse(payment.confirmed)
        val registry = AndroidPaymentNotificationLifecycleRegistry(RuntimeEnvironment.getApplication(), now = { 1000 }, idFactory = { "synthetic-msg-review" })
        val reviewId = registry.eventId(owner, unclear, payment)
        h.onCapture(owner, unclear.copy(paymentEventId = reviewId), "微信", reviewId)
        assertEquals(2, store.localBookings(owner).size)
        assertEquals("message_identity_ambiguous", store.recognitionByUploadEvent(owner, reviewId)?.identityReviewReason)
        assertEquals(1, store.pendingCandidateCount(owner))
    }

    @Test fun explicitCurrencyLateReferenceKeepsEarlierBookingId() {
        val h = hook()
        val input = message("synthetic-before-reference", proof = "synthetic-promote-message").copy(sourceUid = null)
        h.onCapture(owner, input, "微信", input.paymentEventId)
        val before = store.localBookings(owner).single()
        h.onCapture(owner, input.copy(text = input.text + " 交易号 SYNTH-LATE-REF"), "微信", input.paymentEventId)
        h.onCapture(owner, input.copy(text = input.text + " 交易号 SYNTH-LATE-REF", paymentEventId = "synthetic-new-ref-alias", messageIdentity = ""), "微信", "synthetic-new-ref-alias")
        assertEquals(listOf(before), store.localBookings(owner))
    }

    @Test fun ambiguousYenStillNeedsCurrencyAndCannotBook() {
        val h = hook()
        val input = message("synthetic-unproven-currency", "支付成功 ¥648.00 交易号 SYNTH-UNKNOWN-CURRENCY")
        h.onCapture(owner, input, "微信", input.paymentEventId)
        assertTrue(store.localBookings(owner).isEmpty())
        val recognition = store.recognitionByUploadEvent(owner, input.paymentEventId)!!
        assertEquals("XXX", recognition.currency)
        assertTrue(recognition.identityReviewReason in setOf("currency_symbol_ambiguous", "currency_review_required"))
        assertEquals(1, store.pendingCandidateCount(owner))
    }

    @Test fun explicitCurrencyMessageProofSurvivesDatabaseReopenAndRegistryEviction() {
        val context = RuntimeEnvironment.getApplication()
        // The default Robolectric path includes the full method name. Keep the
        // owned persistent fixture short enough for native Windows SQLite.
        val directory = Files.createTempDirectory("p0-proof-").toFile()
        val file = File(directory, "proof.db")
        db.close()
        try {
            db = Room.databaseBuilder(context, NotificationDatabase::class.java, file.absolutePath).allowMainThreadQueries().build()
            store = RoomPaymentRecognitionStore(db)
            val input = message("synthetic-reopen-source")
            hook().onCapture(owner, input, "微信", input.paymentEventId)
            val before = store.localBookings(owner).single()
            val registry = AndroidPaymentNotificationLifecycleRegistry(context, now = { 100000 }, idFactory = { UUID.randomUUID().toString() })
            repeat(300) { i -> registry.eventId(owner, input.copy(notificationKey = "synthetic-slot-$i", messageIdentity = NotificationFingerprint.sha256Hex("synthetic-other-$i")), null) }
            db.close()
            db = Room.databaseBuilder(context, NotificationDatabase::class.java, file.absolutePath).allowMainThreadQueries().build()
            store = RoomPaymentRecognitionStore(db)
            val replay = input.copy(paymentEventId = "synthetic-after-db-reopen", postTime = 21600000)
            hook().onCapture(owner, replay, "微信", replay.paymentEventId)
            assertEquals(listOf(before), store.localBookings(owner))
            assertEquals(before.transactionId, hook().localFinanceTransactionId(owner, replay.paymentEventId))
            assertTrue(store.localBookings("synthetic-other-account").isEmpty())
        } finally { db.close(); directory.listFiles()?.forEach { it.delete() }; directory.delete() }
    }

    @Test fun explicitCurrencyOfflineReceiptLossReplayKeepsOneLedgerAndClosesArchive() {
        val context = RuntimeEnvironment.getApplication()
        val notificationStore = RoomNotificationStore(db)
        val archive = object : NotificationArchiveSink {
            override fun store(accountId: String, input: NotificationCaptureInput, parsed: StructuredNotificationEvent?): Boolean {
                notificationStore.record(accountId, NotificationCapture(input.sourcePackage, input.sourceType,
                    input.notificationKey, input.notificationId, input.tag, input.groupKey, input.channelId,
                    input.postTime, input.isGroup, input.isGroupSummary, input.title, input.text, input.bigText, input.subText,
                    sourceEventId = parsed!!.eventId))
                return true
            }
            override fun markRemoved(accountId: String, input: NotificationCaptureInput) = Unit
            override fun markFinanceOutcome(accountId: String, sourceEventId: String, state: String, transactionId: String) =
                notificationStore.markFinanceOutcome(accountId, sourceEventId, state, transactionId)
            override fun recognitionSourceEventIds(accountId: String, sourceEventId: String) =
                notificationStore.recognitionSourceEventIds(accountId, sourceEventId)
        }
        val h = hook(archive)
        val directory = File(context.cacheDir, "synthetic-p0-outbox-${UUID.randomUUID()}").apply { mkdirs() }
        val queue = OfflineNotificationQueue(File(directory, "queue.jsonl"))
        var connected = false
        var receipt = false
        val transport = object : NotificationIngestTransport {
            override fun post(path: String, sessionToken: String, body: String): IngestResponse {
                if (!connected) return IngestResponse(false, 503, "{}")
                if (!receipt) return IngestResponse(true, 200, "{}")
                val id = org.json.JSONObject(body).getJSONArray("operations").getJSONObject(0).getJSONObject("payload").getString("event_id")
                return IngestResponse(true, 200, """{"operation_results":[{"event":{"event_id":"$id"},"transaction_id":"txn:synthetic-server-receipt"}]}""")
            }
        }
        fun pipeline() = NotificationCaptureCoordinator(archiveFor = { LocalNotificationArchive.inDirectory(directory, it) }, queueFor = { queue },
            transport = transport, account = { NotificationCaptureCoordinator.CaptureAccount(owner, "synthetic-device", "synthetic-session", true, true) },
            archiveSink = archive, paymentHook = h, paymentLifecycleRegistry = AndroidPaymentNotificationLifecycleRegistry(context))
        try {
            val input = NotificationCaptureInput("com.tencent.mm", notificationKey = "synthetic-offline-${UUID.randomUUID()}", notificationId = 34,
                title = "微信支付", text = "支付成功 CNY 34.00 交易号 SYNTH-LOCAL-BOOK-REF", postTime = 1_791_024_978_000L, receivedAtMs = 1_791_024_978_000L)
            val original = pipeline()
            original.onNotification(input)
            val booking = store.localBookings(owner).single()
            assertEquals("pending", booking.syncState)
            assertEquals(0, store.recognitionsByState(owner, PaymentVerificationCenter.ATTENTION_STATES).size)
            val instanceId = db.notificationDao().instanceIdForEventId(owner, booking.eventId)!!
            assertEquals("confirmed", db.notificationDao().instance(owner, instanceId)?.financeState)
            assertEquals(1, original.flushDetailed().pending)
            connected = true
            assertEquals(0, original.flushDetailed().uploaded)
            assertEquals(1, queue.pendingCount())
            receipt = true
            val restarted = pipeline()
            assertEquals(1, restarted.flushDetailed().uploaded)
            assertEquals("synced", store.localBookings(owner).single().syncState)
            assertEquals("txn:synthetic-server-receipt", store.localBookings(owner).single().transactionId)
            restarted.onNotification(input.copy(postTime = input.postTime + 1000, receivedAtMs = input.receivedAtMs + 1000))
            restarted.flushDetailed()
            assertEquals(1, store.localBookings(owner).size)
            assertEquals(0, queue.pendingCount())
            assertEquals("txn:synthetic-server-receipt", db.notificationDao().instance(owner, instanceId)?.financeTransactionId)
        } finally { directory.listFiles()?.forEach { it.delete() }; directory.delete() }
    }
}
