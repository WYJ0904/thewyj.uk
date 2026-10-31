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

    /** Fixture of a booking already durably committed by an older app. */
    private fun seedExistingLegacyBooking(recognitionId: String) {
        val r = store.recognition("account-a", recognitionId)!!
        val event = PaymentAutoBook.eventId(r)
        val transaction = PaymentAutoBook.transactionId(r.accountId, event)
        val booking = LocalPaymentBooking(r.accountId, event, r.recognitionId, transaction, r.amountMinor!!,
            r.direction, r.currency, r.merchant, r.createdAtMs, r.sourcePackage, r.paymentChannel, r.providerReference,
            "identity_pending", r.createdAtMs)
        val candidate = PaymentCandidate("cand-" + recognitionId, r.accountId, r.recognitionId, "confirmed", r.amountMinor,
            r.direction, "", r.merchant, r.createdAtMs, r.paymentChannel, 900, "synthetic_existing_receipt",
            financeTransactionId = transaction, createdAtMs = r.createdAtMs, updatedAtMs = r.updatedAtMs)
        store.bookLocally(booking, r.copy(state = "FINANCE_RECORDED"), candidate)
    }

    @Test fun pendingReceiptWithKnownMoneyDoesNotCreateALedgerEntry() {
        val outcome = coordinator.onSourceEvent("account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#event#pending-ten-cents", "微信支付", "转账¥0.10，待你收款")
        assertNotEquals(PaymentRecognitionState.FINANCE_RECORDED, outcome.state)
        assertTrue(store.localBookings("account-a").isEmpty())
        assertFalse(store.recognition("account-a", outcome.recognitionId)!!.completionConfirmed)
        assertNull(coordinator.autoBook("account-a", outcome.recognitionId))
    }

    @Test fun unverifiedClonePageCannotSettleTheSourceNotification() {
        val first = coordinator.onSourceEvent("account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#event#clone-pending", "微信支付", "转账¥0.10，待你收款", sourceUid = 9_510_123)
        val record = store.recognition("account-a", first.recognitionId)!!
        assertEquals(9_510_123, record.sourceUid)
        val result = coordinator.onAccessibilityEnrichment("account-a", PaymentEnrichment(
            "com.tencent.mm", 10, "CNY", FinanceDirection.INCOME, null, null, null, 1000, 900,
            completionConfirmed = true, sourceInstanceUncertain = true), first.ticketId)
        assertTrue(result is EnrichmentOutcome.Applied)
        assertFalse(store.recognition("account-a", first.recognitionId)!!.completionConfirmed)
        assertEquals("source_instance_unverified", store.candidateForRecognition("account-a", first.recognitionId)!!.reason)
        assertTrue(store.localBookings("account-a").isEmpty())
    }

    @Test fun unprovenLegacyMoneyDoesNotBecomeACompletedPaymentOnReplay() {
        store.saveRecognition(PaymentRecognitionRecord("legacy-unproven", "account-a", "FINANCE_PENDING_CONFIRMATION", 2345,
            "com.tencent.mm", "NOTIFICATION", "notification#event#legacy-unproven", "", "wechat", 50000,
            "CNY", "INCOME", "", "", 1000, 1000))
        assertNull(coordinator.autoBook("account-a", "legacy-unproven"))
        assertTrue(store.localBookings("account-a").isEmpty())
    }

    @Test fun laterSettlementOfSameSourceUpdatesProofWithoutDuplicatingIdentity() {
        val first = coordinator.onSourceEvent("account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#event#same-transfer", "微信支付", "转账¥0.10，待你收款")
        val second = coordinator.onSourceEvent("account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#event#same-transfer", "微信支付", "已收款¥0.10，资金已到账")
        assertEquals(first.recognitionId, second.recognitionId)
        assertEquals(PaymentRecognitionState.FINANCE_RECORDED, second.state)
        assertEquals(1, store.localBookings("account-a").size)
        assertTrue(store.recognition("account-a", first.recognitionId)!!.completionConfirmed)
    }

    @Test fun laterSettlementPersistsASeparateProofAcrossOutboxRestart() {
        val context = RuntimeEnvironment.getApplication()
        val account = "settlement-${UUID.randomUUID()}"
        val eventId = "event-late-settlement"
        coordinator.onSourceEvent(account, "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#event#$eventId", "微信支付", "转账¥0.10，待你收款", uploadEventId = eventId)
        val queue = NotificationOfflineQueue.inDirectory(context.filesDir, account)
        val pending = StructuredNotificationEvent(eventId, "f".repeat(64), "com.tencent.mm",
            NotificationEventType.TRANSACTION, "wechat-4", ParseStatus.CANDIDATE,
            FinanceDirection.INCOME, 10, "CNY", "wechat", "", "", 820, 1000, 1000)
        queue.enqueue(eventId, StructuredEventJson.ingestPayload("1", "device-late-settlement", eventId, pending))
        coordinator.onSourceEvent(account, "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#event#$eventId", "微信支付", "已收款¥0.10，资金已到账", uploadEventId = eventId)
        LocalPaymentLedger.recover(context, account, "device-late-settlement", db, coordinator)
        LocalPaymentLedger.recover(context, account, "device-late-settlement", db, coordinator)
        val restored = NotificationOfflineQueue.inDirectory(context.filesDir, account).peekRequests()
        assertEquals(2, restored.size)
        assertEquals(setOf(eventId, "hint:$eventId"), restored.map { it.operationId }.toSet())
        val proof = org.json.JSONObject(restored.single { it.operationId == "hint:$eventId" }.body)
            .getJSONArray("hints").getJSONObject(0)
        assertEquals("CONFIRMED_PAYMENT", proof.getString("recognition_status"))
        assertEquals("payment-settled-4", proof.getJSONObject("evidence").getString("parser_version"))
        assertEquals(1, store.localBookings(account).size)
    }

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

    @Test fun ambiguousUploadIdentityWithProvenCompletionKeepsLocalBooking() {
        store.saveRecognition(PaymentRecognitionRecord("rec-ambiguous", "account-a", "FINANCE_PENDING_CONFIRMATION", 2304,
            "com.tencent.mm", "NOTIFICATION", "notification#legacy-key#1000", "", "wechat", 3400,
            "CNY", "EXPENSE", "", "", 1000, 1000, completionConfirmed = true))
        seedExistingLegacyBooking("rec-ambiguous")
        val booking = coordinator.autoBook("account-a", "rec-ambiguous", syncState = "identity_pending")!!
        assertEquals("identity_pending", booking.syncState)
        assertEquals("FINANCE_RECORDED", store.recognition("account-a", "rec-ambiguous")?.state)
        assertEquals(0, store.pendingCandidateCount("account-a"))
        assertEquals(3400, booking.amountMinor)
    }

    @Test fun ambiguousIdentityRequiresOneProvedCanonicalTransactionWithoutRebooking() {
        store.saveRecognition(PaymentRecognitionRecord("rec-alias", "account-a", "FINANCE_PENDING_CONFIRMATION", 2305,
            "com.tencent.mm", "NOTIFICATION", "notification#legacy-key#1000", "", "wechat", 3400,
            "CNY", "EXPENSE", "", "", 1000, 1000, completionConfirmed = true))
        seedExistingLegacyBooking("rec-alias")
        val booking = coordinator.autoBook("account-a", "rec-alias", syncState = "identity_pending")!!
        val archive = object : NotificationArchiveSink {
            override fun store(accountId: String, input: NotificationCaptureInput, parsed: StructuredNotificationEvent?) = false
            override fun markRemoved(accountId: String, input: NotificationCaptureInput) {}
            override fun structuredEventIdsForRecognition(accountId: String, recognitionSourceEventId: String) = listOf("evt-alias-a", "evt-alias-b")
        }
        fun receipt(event: String, transaction: String) = uk.thewyj.app.core.network.PendingReviewIdentity(
            "booking", event, event, "device-a", "confirmed", transaction)
        assertEquals(0, LocalPaymentReceiptReconciler.apply("account-a", store, archive,
            listOf(receipt("evt-alias-a", "txn:one"), receipt("evt-alias-b", "txn:two"))))
        assertEquals("identity_pending", store.localBookings("account-a").single().syncState)
        assertEquals(1, LocalPaymentReceiptReconciler.apply("account-a", store, archive,
            listOf(receipt("evt-alias-a", "txn:canonical"), receipt("evt-alias-b", "txn:canonical"))))
        assertEquals("synced", store.localBookings("account-a").single().syncState)
        assertEquals("txn:canonical", store.localBooking("account-a", booking.eventId)?.transactionId)
        assertEquals(1, store.localBookings("account-a").size)
    }

    @Test fun persistedLocalBookingRemovesAliasedManualReviewWithoutFabricatingReceipt() {
        val summary = uk.thewyj.app.core.network.PendingReviewSummary("now", 2, 2, 0, false, listOf(
            uk.thewyj.app.core.network.PendingReviewIdentity("hint", "hint-booked", "evt-old-alias", "device-a"),
            uk.thewyj.app.core.network.PendingReviewIdentity("hint", "hint-needs-money", "evt-needs-money", "device-a")))
        val projected = LocalPaymentReviewProjection.apply(summary, setOf("evt-old-alias", "evt-local-booking"))
        assertEquals(1, projected.totalCount)
        assertEquals("evt-needs-money", projected.records.single().eventId)
        assertTrue(projected.records.none { it.state == "confirmed" })
        assertTrue(projected.records.all { it.transactionId.isEmpty() })
    }

    @Test fun provenLocalRecoveryBooksOnceAndReceiptSurvivesRestart() {
        val recognition = PaymentRecognitionRecord("rec-old-34", "account-a", "FINANCE_PENDING_CONFIRMATION", 2301,
            "com.tencent.mm", "NOTIFICATION", "notification#legacy#1", "", "wechat", 3400, "CNY", "EXPENSE", "", "", 1000, 1000,
            completionConfirmed = true)
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
            completionConfirmed = true,
        ))
        assertTrue(result is EnrichmentOutcome.Applied)
        assertEquals("FINANCE_RECORDED", store.recognition("account-a", outcome.recognitionId)?.state)
        assertEquals("evt-ocr-34", store.localBookings("account-a").single().eventId)
        assertEquals(0, store.pendingCandidateCount("account-a"))
    }

    @Test fun concurrentRecoveryCannotCreateTwoTransactions() {
        val recognition = PaymentRecognitionRecord("rec-race", "account-a", "ENRICHMENT_VERIFIED", 2302,
            "com.tencent.mm", "NOTIFICATION", "notification#event#evt-race-34", "evt-race-34", "wechat", 3400,
            "CNY", "EXPENSE", "", "", 1000, 1000, completionConfirmed = true)
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
                notificationId = 34, title = "微信支付", text = "支付成功 ¥34.00 交易号 SYNTH-LOCAL-BOOK-REF", postTime = 1_791_024_978_000L,
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
