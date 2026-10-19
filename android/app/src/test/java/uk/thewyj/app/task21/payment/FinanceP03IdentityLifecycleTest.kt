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

/** Real product coordinator/Room/hook; all source data are synthetic. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class FinanceP03IdentityLifecycleTest {
    private lateinit var db: NotificationDatabase
    private lateinit var store: RoomPaymentRecognitionStore
    private lateinit var c: PaymentRecognitionCoordinator
    private val owner = "synthetic-p03-owner"
    private var clock = 1000L

    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), NotificationDatabase::class.java)
            .allowMainThreadQueries().build()
        store = RoomPaymentRecognitionStore(db)
        c = PaymentRecognitionCoordinator(store, now = { clock })
    }
    @After fun close() { db.close() }
    private fun wechat(id: String, ref: String = "SYNTH-P03-ORDER-A", amount: Int = 648) =
        c.onSourceEvent(owner, "com.tencent.mm", PaymentSourceType.NOTIFICATION, id,
            "微信支付", "支付成功 实付 CNY $amount.00 交易号 $ref", uploadEventId = id)
    private fun bank(id: String, text: String, source: String = "95555") =
        c.onSourceEvent(owner, source, if (source == "cmb.pb") PaymentSourceType.BANK_NOTIFICATION else PaymentSourceType.SMS,
            id, "【招商银行】", text, uploadEventId = id)
    private fun expense() = store.localBookings(owner).filter { it.direction == "EXPENSE" }.sumOf { it.amountMinor }
    private fun phase(recognitionId: String): Any? = store.recognition(owner, recognitionId)?.let { record ->
        record.javaClass.declaredFields.firstOrNull { it.name == "financialPhase" }?.let { f -> f.isAccessible = true; f.get(record) }
    }
    private fun hook(): AndroidPaymentRecognitionHook {
        val sink = object : NotificationArchiveSink {
            override fun store(accountId: String, input: NotificationCaptureInput, parsed: StructuredNotificationEvent?) = false
            override fun markRemoved(accountId: String, input: NotificationCaptureInput) = Unit
            override fun storeMediaStoreScreenshot(accountId: String, event: ScreenshotMediaEvent) = ScreenshotArchiveOutcome.SKIPPED
        }
        return AndroidPaymentRecognitionHook(RuntimeEnvironment.getApplication(), sink, store, testing = true,
            notifierOverride = object : PaymentStatusNotifier {
                override fun notify(message: PaymentStatusNotificationMessage) = true
                override fun cancel(notificationId: Int) = Unit
            })
    }

    @Test fun profileQualifiedMessageProofKeepsSeparateOccurrencesAndLongReplays() {
        val context = RuntimeEnvironment.getApplication()
        var next = 0
        val registry = AndroidPaymentNotificationLifecycleRegistry(context, now = { clock }, idFactory = { "synthetic-profile-${next++}" })
        val input = NotificationCaptureInput("com.tencent.mm", title = "微信支付", text = "支付成功¥648.00",
            notificationKey = "synthetic-same-slot", notificationId = 7, receivedAtMs = 1000, postTime = 1000,
            messageIdentity = NotificationFingerprint.sha256Hex("synthetic-message"), sourceUid = 10030)
        val p = PaymentIngestOutcome(true, 64800, FinanceDirection.EXPENSE, 950, "", "", "wechat", "wechat-4")
        val first = registry.eventId(owner, input, p)
        val second = registry.eventId(owner, input.copy(sourceUid = 20030), p)
        assertNotEquals(first, second)
        clock += 21600000
        assertEquals(first, registry.eventId(owner, input.copy(postTime = clock), p))
        assertEquals(second, registry.eventId(owner, input.copy(sourceUid = 20030, postTime = clock), p))
    }
    @Test fun durableMessageProofSurvivesRegistryCacheReplacement() {
        val h = hook()
        val input = NotificationCaptureInput("com.tencent.mm", title = "微信支付", text = "支付成功¥648.00",
            notificationKey = "synthetic-message-slot", notificationId = 7, receivedAtMs = 1000,
            paymentEventId = "synthetic-message-before", messageIdentity = NotificationFingerprint.sha256Hex("synthetic-durable-message"), sourceUid = 10030)
        h.onCapture(owner, input, "微信", input.paymentEventId)
        val before = store.localBookings(owner).single()
        repeat(30) { i -> val newer = input.copy(paymentEventId = "synthetic-cache-replacement-$i", postTime = 21600000L + i)
            h.onCapture(owner, newer, "微信", newer.paymentEventId) }
        assertEquals(listOf(before), store.localBookings(owner))
        assertEquals(before.transactionId, h.localFinanceTransactionId(owner, "synthetic-cache-replacement-29"))
    }
    @Test fun multipleOrdersOnOneMessageProofForceASeparateReviewSeries() {
        val h = hook()
        val input = NotificationCaptureInput("com.tencent.mm", title = "微信支付", text = "支付成功¥648.00 交易号 SYNTH-MSG-ORDER-A",
            notificationKey = "synthetic-message-many-orders", notificationId = 7, receivedAtMs = 1000,
            messageIdentity = NotificationFingerprint.sha256Hex("synthetic-ambiguous-message"), sourceUid = 10030)
        h.onCapture(owner, input.copy(paymentEventId = "synthetic-msg-ref-a"), "微信", "synthetic-msg-ref-a")
        val b = input.copy(text = "支付成功¥648.00 交易号 SYNTH-MSG-ORDER-B", paymentEventId = "synthetic-msg-ref-b")
        h.onCapture(owner, b, "微信", b.paymentEventId)
        assertEquals(2, store.localBookings(owner).size)
        val unclear = input.copy(text = "支付成功¥648.00")
        val p = h.prepareIdentity(owner, unclear, h.outcomeFor(unclear)!!)
        assertEquals("message_identity_ambiguous", p.identityReviewReason)
        assertFalse(p.confirmed)
        val registry = AndroidPaymentNotificationLifecycleRegistry(RuntimeEnvironment.getApplication(), now = { 1000 }, idFactory = { "synthetic-msg-review" })
        val reviewId = registry.eventId(owner, unclear, p)
        h.onCapture(owner, unclear.copy(paymentEventId = reviewId), "微信", reviewId)
        assertEquals(2, store.localBookings(owner).size)
        assertEquals("message_identity_ambiguous", store.recognitionByUploadEvent(owner, reviewId)?.identityReviewReason)
        assertEquals(1, store.pendingCandidateCount(owner))
    }
    @Test fun laterReferenceEvidenceAttachesWithoutRenamingEarlierBooking() {
        val h = hook()
        val input = NotificationCaptureInput("com.tencent.mm", title = "微信支付", text = "支付成功¥648.00",
            notificationKey = "synthetic-promote-slot", notificationId = 7, receivedAtMs = 1000,
            paymentEventId = "synthetic-before-reference", messageIdentity = NotificationFingerprint.sha256Hex("synthetic-promote-message"))
        h.onCapture(owner, input, "微信", input.paymentEventId)
        val original = store.localBookings(owner).single()
        h.onCapture(owner, input.copy(text = input.text + " 交易号 SYNTH-LATE-REF"), "微信", input.paymentEventId)
        h.onCapture(owner, input.copy(text = input.text + " 交易号 SYNTH-LATE-REF", paymentEventId = "synthetic-new-ref-alias", messageIdentity = ""), "微信", "synthetic-new-ref-alias")
        assertEquals(listOf(original), store.localBookings(owner))
    }

    @Test fun thirtySameEventDeliveriesAndThirtyReferenceAliasesStayOne() {
        repeat(30) { wechat("synthetic-p03-replay") }
        repeat(30) { wechat("synthetic-p03-alias-$it") }
        assertEquals(1, store.localBookings(owner).size)
        assertEquals(64800L, expense())
    }
    @Test fun independentReliableReferencesAtZeroAndShortIntervalsStaySeparate() {
        wechat("synthetic-p03-new-a", "SYNTH-P03-NEW-A")
        wechat("synthetic-p03-new-b", "SYNTH-P03-NEW-B")
        clock += 5000
        wechat("synthetic-p03-new-c", "SYNTH-P03-NEW-C")
        assertEquals(3, store.localBookings(owner).size)
        assertEquals(194400L, expense())
    }
    @Test fun aConflictingReferenceCannotBecomeItsOwnProofOnRepeatedDelivery() {
        wechat("synthetic-authoritative-ref", "SYNTH-CONFLICT-REF", 648)
        repeat(30) { wechat("synthetic-conflicting-replay", "SYNTH-CONFLICT-REF", 646) }
        assertEquals(1, store.localBookings(owner).size)
        assertEquals(64800L, expense())
        assertEquals("reference_money_or_instance_conflict", store.recognitionBySourceEvent(owner, "synthetic-conflicting-replay")?.identityReviewReason)
        assertEquals(1, store.pendingCandidateCount(owner))
    }
    @Test fun bankAppAndSmsWithSameIssuerReferenceShareOneReceipt() {
        val app = bank("synthetic-p03-bank-app", "已扣款 CNY 34.00 交易号 SYNTH-P03-BANK-REF", "cmb.pb")
        clock += 21600000
        val sms = bank("synthetic-p03-bank-sms", "已扣款 CNY 34.00 交易号 SYNTH-P03-BANK-REF")
        assertTrue(app.recognitionId.isNotBlank())
        assertTrue(sms.recognitionId.isNotBlank())
        assertNotNull(store.recognitionBySourceEvent(owner, "synthetic-p03-bank-sms"))
        assertEquals(1, store.localBookings(owner).size)
        assertEquals(3400L, expense())
    }
    @Test fun issuerNameInUntrustedSmsTextDoesNotCreateCommonReferenceScope() {
        bank("synthetic-p03-issuer-app", "已扣款 CNY 34.00 交易号 SYNTH-P03-ISSUER-REF", "cmb.pb")
        bank("synthetic-p03-unknown-sms", "已扣款 CNY 34.00 交易号 SYNTH-P03-ISSUER-REF", "sms")
        assertEquals(2, store.localBookings(owner).size)
    }
    @Test fun differentProvidersWithSameLiteralReferenceRemainIndependent() {
        wechat("synthetic-p03-cross-a", "SYNTH-P03-CROSS", 34)
        bank("synthetic-p03-cross-b", "已扣款 CNY 34.00 交易号 SYNTH-P03-CROSS")
        assertEquals(2, store.localBookings(owner).size)
    }
    @Test fun actualHookKeepsIdentityUnprovenCaptureForReviewWithoutBooking() {
        val sink = object : NotificationArchiveSink {
            override fun store(accountId: String, input: NotificationCaptureInput, parsed: StructuredNotificationEvent?) = false
            override fun markRemoved(accountId: String, input: NotificationCaptureInput) = Unit
            override fun storeMediaStoreScreenshot(accountId: String, event: ScreenshotMediaEvent) = ScreenshotArchiveOutcome.SKIPPED
        }
        val hook = AndroidPaymentRecognitionHook(RuntimeEnvironment.getApplication(), sink, store, testing = true,
            notifierOverride = object : PaymentStatusNotifier {
                override fun notify(message: PaymentStatusNotificationMessage) = true
                override fun cancel(notificationId: Int) = Unit
            })
        val input = NotificationCaptureInput(sourcePackage = "com.tencent.mm", notificationKey = "synthetic-slot",
            notificationId = 7, title = "微信支付", text = "支付成功 实付¥648.00", postTime = 1000,
            receivedAtMs = 1000, paymentEventId = "synthetic-p03-weak")
        repeat(30) { hook.onCapture(owner, input.copy(postTime = 1000L + it), "微信", "synthetic-p03-weak") }
        assertEquals(0, store.localBookings(owner).size)
        assertNotNull(store.recognitionBySourceEvent(owner, AndroidPaymentRecognitionHook.sourceEventIdOf(input)))
        assertEquals(1, store.pendingCandidateCount(owner))
    }
    @Test fun twelveExplicitIsoInputsNeverCreateCnyBookings() {
        for (source in listOf("com.tencent.mm", "sms")) for ((iso, text) in listOf(
            "USD" to "已扣款 100 USD", "USD" to "已扣款 USD 100.00", "JPY" to "已扣款 JPY 1000",
            "EUR" to "支付成功 实付 EUR 100.00", "HKD" to "支付成功 实付 HKD 100.00", "GBP" to "支付成功 实付 GBP 100.00")) {
            db.clearAllTables()
            val result = c.onSourceEvent(owner, source, if (source == "sms") PaymentSourceType.SMS else PaymentSourceType.NOTIFICATION,
                "synthetic-p03-iso", if (source == "sms") "【合成银行】" else "微信支付", text)
            val record = store.recognition(owner, result.recognitionId)
            assertNotNull(text, record)
            assertEquals(text, iso, record!!.currency)
            assertTrue(text, store.localBookings(owner).all { it.currency == iso })
            if (store.localBookings(owner).isEmpty()) assertNotNull(store.candidateForRecognition(owner, result.recognitionId))
        }
    }
    @Test fun unsupportedButExplicitIsoCodesStayReviewableWithoutCnyFallback() {
        for (code in listOf("AUD", "CAD", "BHD")) {
            db.clearAllTables()
            val r = c.onSourceEvent(owner, "com.tencent.mm", PaymentSourceType.NOTIFICATION, "synthetic-other-iso",
                "微信支付", "已扣款 $code 100.00 交易号 SYNTH-UNSUPPORTED-REF")
            assertEquals(code, store.recognition(owner, r.recognitionId)?.currency)
            assertEquals(0, store.localBookings(owner).size)
            assertNotNull(store.candidateForRecognition(owner, r.recognitionId))
        }
    }
    @Test fun currencyLikeMerchantWordDoesNotOverrideExplicitCnyMoney() {
        c.onSourceEvent(owner, "com.tencent.mm", PaymentSourceType.NOTIFICATION, "synthetic-cny-merchant",
            "微信支付", "支付成功 实付 CNY 100.00 商户 ALL 交易号 SYNTH-CNY-ONLY")
        assertEquals("CNY", store.localBookings(owner).single().currency)
        assertEquals(10000L, expense())
    }
    @Test fun authorizationSettlementReleaseAndDuplicateSettlementCountOnlyFinalMoney() {
        val a = bank("synthetic-p03-hold", "预授权 USD 200.00 交易号 SYNTH-P03-AUTH-A")
        assertEquals(0L, expense())
        assertEquals(20000L, store.recognition(owner, a.recognitionId)?.amountMinor)
        assertEquals("AUTHORIZED", phase(a.recognitionId))
        repeat(30) { bank("synthetic-p03-settlement-$it", "结算成功 已扣款 USD 170.00 交易号 SYNTH-P03-AUTH-A") }
        bank("synthetic-p03-release", "预授权解除 USD 200.00 交易号 SYNTH-P03-AUTH-A")
        assertEquals(17000L, expense())
        assertEquals(1, store.localBookings(owner).size)
        assertTrue(store.localBookings(owner).all { it.currency == "USD" })
    }
    @Test fun settlementBeforeAuthorizationAndLaterRefundKeepExpenseAndRefundSeparate() {
        bank("synthetic-p03-post-first", "结算成功 已扣款 CNY 80.00 交易号 SYNTH-P03-AUTH-B")
        bank("synthetic-p03-hold-last", "预授权 CNY 100.00 交易号 SYNTH-P03-AUTH-B")
        bank("synthetic-p03-refund", "退款成功 CNY 80.00 授权号 SYNTH-P03-AUTH-B 交易号 SYNTH-P03-REFUND-B")
        assertEquals(8000L, expense())
        assertEquals(8000L, store.localBookings(owner).filter { it.direction == "REFUND" }.sumOf { it.amountMinor })
        assertEquals(2, store.localBookings(owner).size)
    }
    @Test fun refundSharingTheOrderReferencePreservesItsOwnRefundLedgerIdentity() {
        bank("synthetic-refund-hold", "预授权 USD 200.00 交易号 SYNTH-SHARED-AUTH")
        bank("synthetic-refund-settle", "结算成功 已扣款 USD 170.00 交易号 SYNTH-SHARED-AUTH")
        repeat(30) { bank("synthetic-refund-$it", "退款成功 USD 50.00 交易号 SYNTH-SHARED-AUTH") }
        assertEquals(17000L, expense())
        assertEquals(5000L, store.localBookings(owner).filter { it.direction == "REFUND" }.sumOf { it.amountMinor })
        assertEquals(2, store.localBookings(owner).size)
    }
    @Test fun releasedOrExpiredAuthorizationNeverBecomesExpense() {
        for ((id, terminal) in listOf("A" to "预授权解除", "B" to "预授权过期")) {
            val a = bank("synthetic-p03-unused-$id", "预授权 CNY 100.00 交易号 SYNTH-P03-UNUSED-$id")
            bank("synthetic-p03-terminal-$id", "$terminal CNY 100.00 交易号 SYNTH-P03-UNUSED-$id")
            assertNotNull(store.recognition(owner, a.recognitionId))
        }
        assertEquals(0, store.localBookings(owner).size)
    }
    @Test fun incompleteAssociationAndPartialClearingStayReviewable() {
        bank("synthetic-p03-no-ref-hold", "预授权 CNY 100.00")
        val noRef = bank("synthetic-p03-no-ref-post", "结算成功 已扣款 CNY 80.00")
        val partial = bank("synthetic-p03-partial", "部分结算 已扣款 CNY 20.00 交易号 SYNTH-P03-PARTIAL")
        val release = bank("synthetic-p03-partial-release", "部分解除 CNY 50.00 交易号 SYNTH-P03-PARTIAL")
        assertEquals(0, store.localBookings(owner).size)
        assertNotNull(store.candidateForRecognition(owner, noRef.recognitionId))
        assertNotNull(store.candidateForRecognition(owner, partial.recognitionId))
        assertNotNull(store.candidateForRecognition(owner, release.recognitionId))
    }
    @Test fun distinctClearingReferencesShareOnlyTheirExplicitAuthorizationFamily() {
        bank("synthetic-family-a", "预授权 USD 200.00 交易号 SYNTH-FAMILY-A")
        val b = bank("synthetic-family-b", "预授权 USD 200.00 交易号 SYNTH-FAMILY-B")
        repeat(30) { bank("synthetic-capture-a-$it", "结算成功 已扣款 USD 80.00 授权号 SYNTH-FAMILY-A 交易号 SYNTH-CAPTURE-A") }
        bank("synthetic-capture-b", "结算成功 已扣款 USD 90.00 授权号 SYNTH-FAMILY-A 交易号 SYNTH-CAPTURE-B")
        bank("synthetic-family-release", "预授权解除 USD 200.00 交易号 SYNTH-FAMILY-A")
        assertEquals(17000L, expense())
        assertEquals(2, store.localBookings(owner).size)
        assertEquals("FINANCE_PENDING_CONFIRMATION", store.recognition(owner, b.recognitionId)?.state)
        clock += 7L * 86400000L
        c.expireTickets(owner)
        assertEquals("AUTHORIZED", phase(b.recognitionId))
        assertEquals("FINANCE_PENDING_CONFIRMATION", store.recognition(owner, b.recognitionId)?.state)
    }
    @Test fun twoMatchingAmountTimeCandidatesNeverChooseTheFirst() {
        repeat(2) { i -> store.saveCandidate(PaymentCandidate("synthetic-c-$i", owner, "synthetic-r-$i", "pending",
            3400, "EXPENSE", "", "synthetic", 1000, "wechat", 900, "synthetic", createdAtMs = 1000, updatedAtMs = 1000)) }
        assertNull(c.reconcile(owner, 3400, 1000))
    }
    @Test fun lateConflictingReceiptCannotRenameAcknowledgedTransaction() {
        val result = wechat("synthetic-p03-receipt")
        val first = store.localBookings(owner).single()
        store.acknowledgeLocalBooking(owner, first.eventId, "synthetic-p03-canonical-receipt")
        store.acknowledgeLocalBooking(owner, first.eventId, "synthetic-p03-late-wrong-receipt")
        assertEquals("synthetic-p03-canonical-receipt", store.localBookings(owner).single().transactionId)
        assertNotNull(store.recognition(owner, result.recognitionId))
    }
    @Test fun ambiguousLegacyMoneyWaitsForACompleteUnanimousReceiptSet() {
        store.saveRecognition(PaymentRecognitionRecord("synthetic-ambiguous-legacy", owner, "FINANCE_PENDING_CONFIRMATION", 7,
            "com.tencent.mm", "NOTIFICATION", "notification#legacy-slot#1000", "", "wechat", 3400,
            "CNY", "EXPENSE", "", "", 1000, 1000, completionConfirmed = true))
        assertNull(c.autoBook(owner, "synthetic-ambiguous-legacy", syncState = "identity_pending"))
        assertEquals(0, store.localBookings(owner).size)
        assertNotNull(store.candidateForRecognition(owner, "synthetic-ambiguous-legacy"))
        val archive = object : NotificationArchiveSink {
            override fun store(accountId: String, input: NotificationCaptureInput, parsed: StructuredNotificationEvent?) = false
            override fun markRemoved(accountId: String, input: NotificationCaptureInput) = Unit
            override fun storeMediaStoreScreenshot(accountId: String, event: ScreenshotMediaEvent) = ScreenshotArchiveOutcome.SKIPPED
            override fun structuredEventIdsForRecognition(accountId: String, recognitionSourceEventId: String) = listOf("synthetic-alias-a", "synthetic-alias-b")
        }
        fun receipt(event: String, tx: String) = uk.thewyj.app.core.network.PendingReviewIdentity("booking", event, event, "synthetic-device", "confirmed", tx)
        assertEquals(0, LocalPaymentReceiptReconciler.apply(owner, store, archive, listOf(receipt("synthetic-alias-a", "synthetic-tx-a"),receipt("synthetic-alias-b", "synthetic-tx-b"))))
        assertEquals(0, LocalPaymentReceiptReconciler.apply(owner, store, archive, listOf(receipt("synthetic-alias-a", "synthetic-tx-a"),receipt("synthetic-alias-b", ""))))
        assertEquals(0, store.localBookings(owner).size)
        assertEquals(1, LocalPaymentReceiptReconciler.apply(owner, store, archive, listOf(receipt("synthetic-alias-a", "synthetic-canonical-tx"),receipt("synthetic-alias-b", "synthetic-canonical-tx"))))
        assertEquals("synthetic-canonical-tx", store.localBookings(owner).single().transactionId)
        assertEquals("synced", store.localBookings(owner).single().syncState)
    }
}
