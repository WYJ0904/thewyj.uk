package uk.thewyj.app.finance

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
import uk.thewyj.app.task21.payment.*
import uk.thewyj.app.task21.store.*

/** V2 account-currency preconditions; original frozen methods remain unchanged. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class FinanceClosureContractTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var database: NotificationDatabase
    @Before fun setup() {
        CurrencyRuntimePreferences.save(app, "account-a", "CNY")
        CurrencyRuntimePreferences.save(app, "synthetic-p03-owner", "CNY")
        database = Room.inMemoryDatabaseBuilder(app, NotificationDatabase::class.java)
            .allowMainThreadQueries().build()
    }
    @After fun close() {
        database.close()
        CurrencyRuntimePreferences.save(app, "account-a", null)
        CurrencyRuntimePreferences.save(app, "synthetic-p03-owner", null)
    }
    private fun hook() = AndroidPaymentRecognitionHook(app, object : NotificationArchiveSink {
        override fun store(accountId: String, input: NotificationCaptureInput, parsed: StructuredNotificationEvent?) = false
        override fun markRemoved(accountId: String, input: NotificationCaptureInput) = Unit
        override fun storeMediaStoreScreenshot(accountId: String, event: ScreenshotMediaEvent) =
            uk.thewyj.app.task21.screenshot.ScreenshotArchiveOutcome.SKIPPED
    },
        recognitionStore = RoomPaymentRecognitionStore(database), testing = true)
    private fun input() = NotificationCaptureInput("com.tencent.mm", sourceType = "notification",
        notificationKey = "0|com.tencent.mm|1|null|100", notificationId = 1, postTime = 1000L,
        title = "老周横眉", text = "", textLines = listOf("已支付¥100"))
    private fun identity(run: (FinanceP03IdentityLifecycleTest) -> Unit) {
        val original = FinanceP03IdentityLifecycleTest()
        original.setup()
        try { run(original) } finally { original.close() }
    }
    @Test fun originalLaterReferenceAssertionsWithExplicitAccountCurrency() = identity {
        it.laterReferenceEvidenceAttachesWithoutRenamingEarlierBooking()
    }
    @Test fun originalDurableMessageAssertionsWithExplicitAccountCurrency() = identity {
        it.durableMessageProofSurvivesRegistryCacheReplacement()
    }
    @Test fun originalMultipleOrderAssertionsWithExplicitAccountCurrency() = identity {
        it.multipleOrdersOnOneMessageProofForceASeparateReviewSeries()
    }
    @Test fun originalOfflineReceiptAndReplayAssertionsWithExplicitAccountCurrency() {
        val original = LocalPaymentBookingTest()
        original.setUp()
        try { original.offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive() }
        finally { original.close() }
    }
    @Test fun originalMessagingLinesReachParserWithExplicitAccountCurrency() {
        val outcome = hook().outcomeFor("account-a", input())!!
        assertEquals(10000L, outcome.amountMinor)
        assertTrue(outcome.confirmed)
        assertEquals(FinanceDirection.EXPENSE, outcome.direction)
        assertEquals("CNY", outcome.currency)
        assertTrue(outcome.currencyReviewRequired)
    }
    @Test fun sameOriginalMessagingLinesWithoutAccountMustRemainUnproven() {
        val outcome = hook().outcomeFor(input())!!
        assertEquals(0L, outcome.amountMinor)
        assertFalse(outcome.confirmed)
        assertTrue(outcome.missingFields.contains("currency"))
        assertEquals(0, RoomPaymentRecognitionStore(database).localBookings("account-a").size)
    }
    @Test fun originalMissingMoneyMetadataExplicitlyIncludesUnprovenCurrency() {
        val outcome = hook().outcomeFor(NotificationCaptureInput("cmb.pb", sourceType = "notification",
            notificationKey = "payment-hint", notificationId = 9, postTime = 9000L,
            title = "招商银行", text = "交易提醒"))!!
        assertEquals("bank-notification-4", outcome.parserVersion)
        assertEquals(listOf("bank_notification_without_amount"), outcome.reasons)
        assertEquals(setOf("amount", "direction", "currency"), outcome.missingFields)
        assertFalse(outcome.reasons.joinToString().contains("交易提醒"))
        assertFalse(outcome.confirmed)
    }
    @Test fun anotherAccountCannotInheritTheCnyDefault() {
        CurrencyRuntimePreferences.save(app, "different-owner", null)
        val outcome = hook().outcomeFor("different-owner", input())!!
        assertEquals(0L, outcome.amountMinor)
        assertFalse(outcome.confirmed)
    }
    @Test fun incompatibleDollarDefaultCannotInventMeaningForYenSymbol() {
        CurrencyRuntimePreferences.save(app, "account-a", "USD")
        val outcome = hook().outcomeFor("account-a", input())!!
        assertEquals(0L, outcome.amountMinor)
        assertFalse(outcome.confirmed)
    }
    @Test fun originalProfileQualifiedIdentityAssertionsStaySeparate() = identity {
        it.profileQualifiedMessageProofKeepsSeparateOccurrencesAndLongReplays()
    }
}
