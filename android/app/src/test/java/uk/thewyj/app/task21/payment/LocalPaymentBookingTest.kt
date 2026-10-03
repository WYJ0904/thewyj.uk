package uk.thewyj.app.task21.payment

import androidx.room.Room
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.FinanceDirection
import uk.thewyj.app.task21.*
import uk.thewyj.app.task21.store.*
import java.util.concurrent.Executors
import java.io.File
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class LocalPaymentBookingTest {
    private lateinit var db: NotificationDatabase
    private lateinit var store: RoomPaymentRecognitionStore
    private lateinit var coordinator: PaymentRecognitionCoordinator
    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), NotificationDatabase::class.java)
            .allowMainThreadQueries().build()
        store = RoomPaymentRecognitionStore(db)
        coordinator = PaymentRecognitionCoordinator(store, now = { 1_791_024_978_000L })
    }
    @After fun close() { db.close() }

    @Test fun completeWeChatAlipayAndIncomeBookWithoutMerchantOrNetwork() {
        val fixtures = listOf(
            Triple("com.tencent.mm", "微信支付", "支付成功 ¥34.00"),
            Triple("com.eg.android.AlipayGphone", "支付宝", "付款成功 ¥8.00"),
            Triple("com.tencent.mm", "微信支付", "收款成功 ¥12.00"),
        )
        fixtures.forEachIndexed { index, (pkg, title, text) ->
            val outcome = coordinator.onSourceEvent("account-a", pkg, PaymentSourceType.NOTIFICATION,
                "notification#event#evt-complete-$index", title, text, uploadEventId = "evt-complete-$index")
            assertEquals(PaymentRecognitionState.FINANCE_RECORDED, outcome.state)
            assertEquals("confirmed", store.candidateForRecognition("account-a", outcome.recognitionId)?.status)
        }
        assertEquals(3, store.localBookings("account-a").size)
        assertEquals(0, store.pendingCandidateCount("account-a"))
        assertTrue(store.localBookings("account-a").all { it.syncState == "pending" && it.merchant.isEmpty() })
        assertEquals("INCOME", store.localBookings("account-a").last().direction)
    }

    @Test fun onlyMissingMoneyFieldsRemainActionable() {
        val missingAmount = coordinator.onSourceEvent("account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "missing-amount", "微信支付", "转账")
        assertTrue(missingAmount.recognitionId.isNotBlank())
        val missingDirection = coordinator.onSourceEvent("account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "missing-direction", "微信支付", "¥34.00")
        assertNotEquals(PaymentRecognitionState.FINANCE_RECORDED, missingAmount.state)
        assertNotEquals(PaymentRecognitionState.FINANCE_RECORDED, missingDirection.state)
        assertTrue(store.localBookings("account-a").isEmpty())
        assertEquals(2, store.recognitionsByState("account-a", PaymentVerificationCenter.ATTENTION_STATES).size)
    }

    @Test fun exactArchiveReceiptClosesLegacyRecordEvenWithoutCandidate() {
        store.saveRecognition(PaymentRecognitionRecord("rec-receipt", "account-a", "FINANCE_PENDING_CONFIRMATION", 2303,
            "com.tencent.mm", "NOTIFICATION", "notification#event#evt-receipt-34", "evt-receipt-34", "wechat", 3400,
            "CNY", "EXPENSE", "", "", 1000, 1000))
        val booking = coordinator.autoBook("account-a", "rec-receipt", "txn:existing-cloud-record")!!
        assertEquals("txn:existing-cloud-record", booking.transactionId)
        assertEquals("synced", booking.syncState)
        assertEquals(0, store.pendingCandidateCount("account-a"))
    }

    @Test fun oldLocalRecoveryCompleteMoneyBooksOnceAndReceiptSurvivesRestart() {
        val recognition = PaymentRecognitionRecord("rec-old-34", "account-a", "FINANCE_PENDING_CONFIRMATION", 2301,
            "com.tencent.mm", "NOTIFICATION", "notification#legacy#1", "", "wechat", 3400, "CNY", "EXPENSE", "", "", 1000, 1000)
        store.saveRecognition(recognition)
        val booking = coordinator.autoBook("account-a", recognition.recognitionId)!!
        assertEquals("pay-verify:rec-old-34", booking.eventId)
        assertEquals(3400, booking.amountMinor)
        assertEquals("FINANCE_RECORDED", store.recognition("account-a", "rec-old-34")?.state)
        val restarted = PaymentRecognitionCoordinator(RoomPaymentRecognitionStore(db))
        repeat(4) { assertEquals(booking.transactionId, restarted.autoBook("account-a", "rec-old-34")?.transactionId) }
        assertEquals(1, store.localBookings("account-a").size)
        store.acknowledgeLocalBooking("account-a", booking.eventId, "txn:legacy-server-receipt")
        assertEquals("txn:legacy-server-receipt", restarted.autoBook("account-a", "rec-old-34")?.transactionId)
        assertEquals("synced", store.localBookings("account-a").single().syncState)
        assertTrue(store.localBookings("another-account").isEmpty())
    }

    @Test fun ocrCompleteEvidenceAutomaticallyBooksSameEvent() {
        val outcome = coordinator.onSourceEvent("account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#event#evt-ocr-34", "微信支付", "转账", uploadEventId = "evt-ocr-34")
        val result = coordinator.onAccessibilityEnrichment("account-a", PaymentEnrichment(
            sourcePackage = "com.tencent.mm", amountMinor = 3400, direction = FinanceDirection.EXPENSE,
            merchant = null, occurredAtMs = 1_791_024_978_000L, confidence = 800,
            evidenceSource = PaymentEvidenceSource.OCR, currency = "CNY", counterparty = null, providerReference = null,
        ))
        assertTrue(result is EnrichmentOutcome.Applied)
        assertEquals("FINANCE_RECORDED", store.recognition("account-a", outcome.recognitionId)?.state)
        assertEquals("evt-ocr-34", store.localBookings("account-a").single().eventId)
        assertEquals(0, store.pendingCandidateCount("account-a"))
    }

    @Test fun concurrentRecoveryCannotCreateTwoTransactions() {
        val recognition = PaymentRecognitionRecord("rec-race", "account-a", "ENRICHMENT_VERIFIED", 2302,
            "com.tencent.mm", "NOTIFICATION", "notification#event#evt-race-34", "evt-race-34", "wechat", 3400,
            "CNY", "EXPENSE", "", "", 1000, 1000)
        store.saveRecognition(recognition)
        val pool = Executors.newFixedThreadPool(4)
        try {
            val results = (1..12).map { pool.submit<String> {
                PaymentRecognitionCoordinator(RoomPaymentRecognitionStore(db)).autoBook("account-a", "rec-race")!!.transactionId
            } }.map { it.get() }
            assertEquals(1, results.toSet().size)
            assertEquals(1, store.localBookings("account-a").size)
        } finally { pool.shutdownNow() }
    }

    @Test fun offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive() {
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
            override fun markRemoved(accountId: String, input: NotificationCaptureInput) {}
            override fun markFinanceOutcome(accountId: String, sourceEventId: String, state: String, transactionId: String) =
                notificationStore.markFinanceOutcome(accountId, sourceEventId, state, transactionId)
            override fun recognitionSourceEventIds(accountId: String, sourceEventId: String) =
                notificationStore.recognitionSourceEventIds(accountId, sourceEventId)
        }
        val hook = AndroidPaymentRecognitionHook(context, archive, store, testing = true,
            notifierOverride = object : PaymentStatusNotifier {
                override fun notify(message: PaymentStatusNotificationMessage) = true
                override fun cancel(notificationId: Int) {}
            })
        val directory = File(context.cacheDir, "autobook-${UUID.randomUUID()}").apply { mkdirs() }
        val queue = OfflineNotificationQueue(File(directory, "queue.jsonl"))
        var connected = false
        var receipt = false
        val transport = object : NotificationIngestTransport {
            override fun post(path: String, sessionToken: String, body: String): IngestResponse {
                if (!connected) return IngestResponse(false, 503, "{}")
                if (!receipt) return IngestResponse(true, 200, "{}")
                val id = org.json.JSONObject(body).getJSONArray("operations").getJSONObject(0)
                    .getJSONObject("payload").getString("event_id")
                return IngestResponse(true, 200, """{"operation_results":[{"event":{"event_id":"$id"},"transaction_id":"txn:real-server-receipt"}]}""")
            }
        }
        fun pipeline() = NotificationCaptureCoordinator(
            archiveFor = { LocalNotificationArchive.inDirectory(directory, it) }, queueFor = { queue },
            transport = transport, account = { NotificationCaptureCoordinator.CaptureAccount("account-a", "device-local-book", "test-session", true, true) },
            archiveSink = archive, paymentHook = hook, paymentLifecycleRegistry = AndroidPaymentNotificationLifecycleRegistry(context),
        )
        try {
            val input = NotificationCaptureInput("com.tencent.mm", notificationKey = "test-autobook-${UUID.randomUUID()}",
                notificationId = 34, title = "微信支付", text = "支付成功 ¥34.00", postTime = 1_791_024_978_000L,
                receivedAtMs = 1_791_024_978_000L)
            val original = pipeline()
            original.onNotification(input)
            val booking = store.localBookings("account-a").single()
            assertEquals("pending", booking.syncState)
            assertEquals(0, store.recognitionsByState("account-a", PaymentVerificationCenter.ATTENTION_STATES).size)
            val instanceId = db.notificationDao().instanceIdForEventId("account-a", booking.eventId)!!
            assertEquals("confirmed", db.notificationDao().instance("account-a", instanceId)?.financeState)
            assertEquals(1, original.flushDetailed().pending)
            connected = true
            assertEquals(0, original.flushDetailed().uploaded) // 200 without transaction receipt is not synced.
            assertEquals(1, queue.pendingCount())
            receipt = true
            val restarted = pipeline()
            assertEquals(1, restarted.flushDetailed().uploaded)
            assertEquals("synced", store.localBookings("account-a").single().syncState)
            assertEquals("txn:real-server-receipt", store.localBookings("account-a").single().transactionId)
            restarted.onNotification(input.copy(postTime = input.postTime + 1000, receivedAtMs = input.receivedAtMs + 1000))
            restarted.flushDetailed()
            assertEquals(1, store.localBookings("account-a").size)
            assertEquals(0, queue.pendingCount())
            assertEquals("txn:real-server-receipt", db.notificationDao().instance("account-a", instanceId)?.financeTransactionId)
        } finally { directory.listFiles()?.forEach { it.delete() }; directory.delete() }
    }
}
