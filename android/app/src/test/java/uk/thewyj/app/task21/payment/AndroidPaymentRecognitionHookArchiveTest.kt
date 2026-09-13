package uk.thewyj.app.task21.payment

import androidx.room.Room
import java.io.File
import java.util.UUID
import org.junit.After
import org.junit.Assert.assertEquals
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
}
