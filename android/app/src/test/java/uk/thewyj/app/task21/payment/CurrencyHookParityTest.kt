package uk.thewyj.app.task21.payment

import android.app.Application
import androidx.room.Room
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.finance.CurrencyRuntimePreferences
import uk.thewyj.app.task21.*
import uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome
import uk.thewyj.app.task21.store.*

/** Storage substitution must not change monetary interpretation or its wire units. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class CurrencyHookParityTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private val sink = object : NotificationArchiveSink {
        override fun store(accountId: String, input: NotificationCaptureInput, parsed: StructuredNotificationEvent?) = false
        override fun markRemoved(accountId: String, input: NotificationCaptureInput) = Unit
        override fun storeMediaStoreScreenshot(accountId: String, event: ScreenshotMediaEvent) = ScreenshotArchiveOutcome.SKIPPED
    }
    private val notifier = object : PaymentStatusNotifier {
        override fun notify(message: PaymentStatusNotificationMessage) = true
        override fun cancel(notificationId: Int) = Unit
    }
    private fun input() = NotificationCaptureInput(
        sourcePackage = "com.tencent.mm", title = "微信支付", text = "已扣款 $100.00",
        notificationKey = "synthetic-currency-parity", notificationId = 11,
        postTime = 1000, receivedAtMs = 1000, paymentEventId = "synthetic-currency-parity-event",
    )
    private fun hook(store: PaymentRecognitionStoreContract? = null) = AndroidPaymentRecognitionHook(
        context, sink, store, testing = true, notifierOverride = notifier,
        publishOverride = { _, _ -> false },
    )

    @Test fun accountAwareOutcomesKeepTheSamePolicyForDefaultAndInjectedStorage() {
        val db = Room.inMemoryDatabaseBuilder(context, NotificationDatabase::class.java).allowMainThreadQueries().build()
        try {
            val owner = "synthetic-currency-outcome-owner"
            val actualHook = hook()
            val substitutedHook = hook(RoomPaymentRecognitionStore(db))
            for (currency in listOf<String?>(null, "USD", "HKD")) {
                CurrencyRuntimePreferences.save(context, owner, currency)
                val expected = actualHook.outcomeFor(owner, input())!!
                val actual = substitutedHook.outcomeFor(owner, input())!!
                assertEquals("Storage cannot decide currency policy: $currency", expected, actual)
                assertEquals(currency ?: "XXX", actual.currency)
                assertEquals(if (currency == null) 0L else 10000L, actual.amountMinor)
                assertEquals(currency != null, actual.confirmed)
            }
        } finally { db.close() }
    }

    @Test fun accountlessNewCaptureCannotInventRenminbiOrAmountUnits() {
        val actual = hook().outcomeFor(input())!!
        assertFalse(actual.confirmed)
        assertEquals("XXX", actual.currency)
        assertEquals(0L, actual.amountMinor)
        assertNull(actual.amountExponent)
        assertEquals("currency_review_required", actual.identityReviewReason)
    }

    @Test fun notificationCaptureUsesTheSameAccountDefaultWithAnInjectedRoomStore() {
        val db = Room.inMemoryDatabaseBuilder(context, NotificationDatabase::class.java).allowMainThreadQueries().build()
        val worker = Executors.newSingleThreadExecutor()
        try {
            val owner = "synthetic-currency-capture-owner"
            CurrencyRuntimePreferences.save(context, owner, "USD")
            val injected = RoomPaymentRecognitionStore(db)
            val actualHook = hook()
            val substitutedHook = hook(injected)
            val records = worker.submit<Pair<PaymentRecognitionRecord, PaymentRecognitionRecord>> {
                actualHook.onCapture(owner, input(), "微信", "synthetic-currency-parity-event")
                substitutedHook.onCapture(owner, input(), "微信", "synthetic-currency-parity-event")
                val source = AndroidPaymentRecognitionHook.sourceEventIdOf(input())
                RoomPaymentRecognitionStore(NotificationDatabase.get(context)).recognitionBySourceEvent(owner, source)!! to
                    injected.recognitionBySourceEvent(owner, source)!!
            }.get(20, TimeUnit.SECONDS)
            assertEquals("USD", records.first.currency)
            assertEquals(records.first.currency, records.second.currency)
            assertEquals(records.first.amountMinor, records.second.amountMinor)
            assertEquals(records.first.direction, records.second.direction)
            assertEquals(records.first.identityReviewReason, records.second.identityReviewReason)
            assertTrue(injected.localBookings(owner).isEmpty())
        } finally { worker.shutdownNow(); db.close() }
    }
}
