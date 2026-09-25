package uk.thewyj.app.task21.payment

import androidx.room.Room
import java.io.File
import java.util.UUID
import java.util.concurrent.Executor
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.NotificationArchiveSink
import uk.thewyj.app.task21.NotificationCaptureInput
import uk.thewyj.app.task21.ScreenshotMediaEvent
import uk.thewyj.app.task21.StructuredNotificationEvent
import uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome
import uk.thewyj.app.task21.store.NotificationCapture
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomNotificationStore

/**
 * T24.3-03 regression: a payment the server booked automatically has no local
 * recognition/candidate row. The archive must still reach the terminal
 * `confirmed` state with the transaction id, so the notification list stops
 * showing 「等待确认记账」 for a booked payment.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class AndroidPaymentRecognitionHookArchiveTest {
    @Test fun oneCentEnrichmentPublishesWithoutReviewScreen() {
        val accountId = "account-a"
        val recognitionStore = uk.thewyj.app.task21.store.RoomPaymentRecognitionStore(database)
        recognitionStore.saveRecognition(PaymentRecognitionRecord(
            recognitionId = "rec-one-cent", accountId = accountId,
            state = PaymentRecognitionState.WAITING_FOR_ENRICHMENT.name,
            notificationId = 15, sourcePackage = "com.tencent.mm", sourceType = "notification",
            sourceEventId = "notification#event#evt-one-cent", uploadEventId = "evt-one-cent",
            paymentChannel = "wechat", amountMinor = null, currency = "CNY", direction = "UNKNOWN",
            merchant = "", providerReference = "", createdAtMs = 1_000L, updatedAtMs = 1_000L,
        ))
        recognitionStore.saveTicket(PaymentTicketEngine().create(
            accountId = accountId, recognitionId = "rec-one-cent", sourcePackage = "com.tencent.mm",
            sourceEventId = "notification#event#evt-one-cent", paymentChannel = "wechat",
            missingFields = setOf("amount", "direction"),
        ))
        var attempts = 0
        var amountAtPublish: Long? = null
        val hook = AndroidPaymentRecognitionHook(
            RuntimeEnvironment.getApplication(), archiveSink = sink(), recognitionStore = recognitionStore,
            testing = true,
            publishOverride = { account, recognitionId ->
                attempts += 1
                amountAtPublish = recognitionStore.recognition(account, recognitionId)?.amountMinor
                false // Simulate a failed network POST; the Room result must stay.
            },
            enrichmentExecutor = Executor { it.run() },
            notifierOverride = object : PaymentStatusNotifier {
                override fun notify(message: PaymentStatusNotificationMessage) = true
                override fun cancel(notificationId: Int) = Unit
            },
        )
        val outcome = hook.onAccessibilityEnrichment(accountId, PaymentEnrichment(
            sourcePackage = "com.tencent.mm", amountMinor = 1L, currency = "CNY",
            direction = null, merchant = null, counterparty = null, providerReference = null,
            occurredAtMs = 1_000L, confidence = 820,
        ))
        assertTrue(outcome is EnrichmentOutcome.Applied)
        assertEquals(1, attempts)
        assertEquals(1L, amountAtPublish)
        assertEquals(1L, recognitionStore.recognition(accountId, "rec-one-cent")?.amountMinor)
        assertEquals(PaymentRecognitionState.ENRICHMENT_VERIFIED.name,
            recognitionStore.recognition(accountId, "rec-one-cent")?.state)
    }
    @Test fun canonicalPaymentEventIdIgnoresMutableNotificationPostTime() {
        val first = NotificationCaptureInput(
            sourcePackage = "com.tencent.mm",
            notificationKey = "same-platform-key",
            notificationId = 7,
            postTime = 1_000L,
            receivedAtMs = 1_000L,
            paymentEventId = "payment-event-0001",
        )
        assertEquals(
            AndroidPaymentRecognitionHook.sourceEventIdOf(first),
            AndroidPaymentRecognitionHook.sourceEventIdOf(
                first.copy(postTime = 12_000L, receivedAtMs = 12_000L),
            ),
        )
        assertEquals(
            "notification#event#payment-event-0001",
            AndroidPaymentRecognitionHook.sourceEventIdOf(first),
        )
    }

    private lateinit var database: NotificationDatabase
    private lateinit var store: RoomNotificationStore
    private val account = "account-a"

    @Before fun setUp() {
        // In-memory: this class only needs the archive tables, and a file-backed
        // Robolectric database adds no coverage for the ordering rule under test.
        database = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), NotificationDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        store = RoomNotificationStore(database)
    }

    @After fun tearDown() {
        database.close()
    }

    private fun sink() = object : NotificationArchiveSink {
        override fun store(
            accountId: String,
            input: NotificationCaptureInput,
            parsed: StructuredNotificationEvent?,
        ): Boolean = false

        override fun markRemoved(accountId: String, input: NotificationCaptureInput) = Unit

        override fun storeMediaStoreScreenshot(accountId: String, event: ScreenshotMediaEvent) =
            ScreenshotArchiveOutcome.SKIPPED

        override fun markFinanceOutcome(
            accountId: String,
            sourceEventId: String,
            state: String,
            transactionId: String,
        ): Boolean = store.markFinanceOutcome(accountId, sourceEventId, state, transactionId)

        override fun recognitionSourceEventIds(accountId: String, sourceEventId: String): List<String> =
            store.recognitionSourceEventIds(accountId, sourceEventId)
    }

    @Test fun autoBookedPaymentStillClosesTheArchiveWithoutALocalCandidate() {
        val eventId = "evt-auto-booked"
        store.record(
            account,
            NotificationCapture(
                sourcePackage = "cmb.pb",
                sourceType = "notification",
                notificationKey = "key:$eventId",
                notificationId = 11,
                tag = "",
                groupKey = "",
                channelId = "bank",
                postTime = 1_000L,
                isGroup = false,
                isGroupSummary = false,
                title = "招商银行",
                text = "已支付 ¥28.00",
                bigText = "",
                subText = "",
                sourceEventId = eventId,
            ),
        )
        store.markFinanceOutcome(account, eventId, "pending")

        val hook = AndroidPaymentRecognitionHook(
            RuntimeEnvironment.getApplication(),
            archiveSink = sink(),
            recognitionStore = uk.thewyj.app.task21.store.RoomPaymentRecognitionStore(database),
            testing = true,
        )
        hook.onFinanceOutcome(account, eventId, "txn-auto-1")

        val instanceId = database.notificationDao().instanceIdForEventId(account, eventId)
        val instance = database.notificationDao().instance(account, instanceId!!)
        assertEquals("confirmed", instance!!.financeState)
        assertEquals("txn-auto-1", instance.financeTransactionId)
    }

    @Test fun serverBookingClosesRecognitionEvenWithoutLocalCandidate() {
        val eventId = "evt-auto-booked-recognition"
        val recognitionStore = uk.thewyj.app.task21.store.RoomPaymentRecognitionStore(database)
        recognitionStore.saveRecognition(
            PaymentRecognitionRecord(
                recognitionId = "rec-auto-booked",
                accountId = account,
                state = PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION.name,
                notificationId = 77,
                sourcePackage = "cmb.pb",
                sourceType = PaymentSourceType.NOTIFICATION.name,
                sourceEventId = "notification#bank#77",
                uploadEventId = eventId,
                paymentChannel = "bank",
                amountMinor = 2_800L,
                currency = "CNY",
                direction = uk.thewyj.app.task21.FinanceDirection.EXPENSE.name,
                merchant = "",
                providerReference = "",
                createdAtMs = 1_000L,
                updatedAtMs = 1_000L,
            ),
        )

        val hook = AndroidPaymentRecognitionHook(
            RuntimeEnvironment.getApplication(),
            archiveSink = sink(),
            recognitionStore = recognitionStore,
            testing = true,
        )
        hook.onFinanceOutcome(account, eventId, "txn-auto-2")

        val stored = recognitionStore.recognition(account, "rec-auto-booked")
        assertNotNull(stored)
        assertEquals(PaymentRecognitionState.FINANCE_RECORDED.name, stored!!.state)
    }

    @Test fun serverBookingClosesLegacyRecognitionWithBlankUploadId() {
        val eventId = "evt-auto-booked-legacy"
        store.record(account, NotificationCapture(
            sourcePackage = "com.tencent.mm", sourceType = "notification",
            notificationKey = "key:$eventId", notificationId = 78, tag = "", groupKey = "",
            channelId = "payment", postTime = 1_000L, isGroup = false,
            isGroupSummary = false, title = "微信", text = "支付成功", bigText = "",
            subText = "", sourceEventId = eventId,
        ))
        val recognitionStore = uk.thewyj.app.task21.store.RoomPaymentRecognitionStore(database)
        recognitionStore.saveRecognition(PaymentRecognitionRecord(
            recognitionId = "rec-legacy-blank", accountId = account,
            state = PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION.name,
            notificationId = 78, sourcePackage = "com.tencent.mm",
            sourceType = PaymentSourceType.NOTIFICATION.name,
            sourceEventId = "notification#event#$eventId", uploadEventId = "",
            paymentChannel = "wechat", amountMinor = 1L, currency = "CNY",
            direction = "EXPENSE", merchant = "", providerReference = "",
            createdAtMs = 1_000L, updatedAtMs = 1_000L,
        ))
        val hook = AndroidPaymentRecognitionHook(
            RuntimeEnvironment.getApplication(), archiveSink = sink(),
            recognitionStore = recognitionStore, testing = true,
        )
        hook.onFinanceOutcome(account, eventId, "txn-legacy-blank")
        assertEquals(PaymentRecognitionState.FINANCE_RECORDED.name,
            recognitionStore.recognition(account, "rec-legacy-blank")?.state)
    }

    /**
     * Task 24 reopen (real device 2026-09-13): WeChat chat/payment notifications
     * arrive as MessagingStyle, so the message body lives in `EXTRA_TEXT_LINES`
     * while EXTRA_TEXT stays empty. The payment parser must see those lines,
     * otherwise a literal「已支付¥100」is reported as 暂未识别到金额.
     */
    @Test fun messagingStyleLinesReachThePaymentParser() {
        val hook = AndroidPaymentRecognitionHook(
            RuntimeEnvironment.getApplication(),
            archiveSink = sink(),
            recognitionStore = uk.thewyj.app.task21.store.RoomPaymentRecognitionStore(database),
            testing = true,
        )
        val input = uk.thewyj.app.task21.NotificationCaptureInput(
            sourcePackage = "com.tencent.mm",
            sourceType = "notification",
            notificationKey = "0|com.tencent.mm|1|null|100",
            notificationId = 1,
            postTime = 1_000L,
            title = "老周横眉",
            text = "",
            textLines = listOf("已支付¥100"),
        )

        val outcome = hook.outcomeFor(input)

        assertNotNull("the messaging lines must produce a payment outcome", outcome)
        assertEquals(10_000L, outcome!!.amountMinor)
        assertEquals(uk.thewyj.app.task21.FinanceDirection.EXPENSE, outcome.direction)
    }

    /**
     * Task 24 reopen #3 (false positives): the same MessagingStyle path must not
     * turn ordinary chat lines into money. A friend talking about a transfer, a
     * group message and a marketing line all stay without an amount.
     */
    @Test fun messagingStyleChatLinesNeverInventAnAmount() {
        val hook = AndroidPaymentRecognitionHook(
            RuntimeEnvironment.getApplication(),
            archiveSink = sink(),
            recognitionStore = uk.thewyj.app.task21.store.RoomPaymentRecognitionStore(database),
            testing = true,
        )
        val chatCases = listOf(
            listOf("张三：明天给你转账"),
            listOf("李四：一会儿转给你"),
            listOf("群里：撤回了一条消息 转账199元"),
            listOf("优惠活动：满100减20，点击领取优惠券"),
            listOf("支付订单号 202609110001"),
            listOf("支付验证码 123456"),
        )
        chatCases.forEachIndexed { index, lines ->
            val input = uk.thewyj.app.task21.NotificationCaptureInput(
                sourcePackage = "com.tencent.mm",
                sourceType = "notification",
                notificationKey = "0|com.tencent.mm|${index + 1}|null|100",
                notificationId = index + 1,
                postTime = 1_000L + index,
                title = "微信",
                text = "",
                textLines = lines,
            )
            val outcome = hook.outcomeFor(input)
            assertTrue(
                "${lines.first()} must not become a confirmed payment: $outcome",
                outcome == null || outcome.confirmed.not() || outcome.amountMinor <= 0,
            )
        }
    }

    @Test fun incompletePaymentCarriesAuditableReasonCodesWithoutRawText() {
        val hook = AndroidPaymentRecognitionHook(
            RuntimeEnvironment.getApplication(),
            archiveSink = sink(),
            recognitionStore = uk.thewyj.app.task21.store.RoomPaymentRecognitionStore(database),
            testing = true,
        )
        val outcome = hook.outcomeFor(
            uk.thewyj.app.task21.NotificationCaptureInput(
                sourcePackage = "cmb.pb",
                sourceType = "notification",
                notificationKey = "payment-hint",
                notificationId = 9,
                postTime = 9_000L,
                title = "招商银行",
                text = "交易提醒",
            ),
        )

        assertNotNull(outcome)
        assertEquals("bank-notification-2", outcome!!.parserVersion)
        assertEquals(listOf("bank_notification_without_amount"), outcome.reasons)
        assertEquals(setOf("amount", "direction"), outcome.missingFields)
        assertFalse(outcome.reasons.joinToString().contains("交易提醒"))
    }
}
