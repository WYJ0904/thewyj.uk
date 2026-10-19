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
import uk.thewyj.app.task21.store.NotificationDatabase
import uk.thewyj.app.task21.store.RoomPaymentRecognitionStore

/** Actual coordinator + Room. Frozen P02 inputs/expectations are not changed. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class FinanceP03ClearingCloseoutTest {
    private lateinit var db: NotificationDatabase
    private lateinit var store: RoomPaymentRecognitionStore
    private lateinit var c: PaymentRecognitionCoordinator
    private val owner = "synthetic-p03-closeout"
    private val family = "SYNTH-CLOSEOUT-AUTH"
    @Before fun setup() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), NotificationDatabase::class.java).allowMainThreadQueries().build()
        store = RoomPaymentRecognitionStore(db)
        c = PaymentRecognitionCoordinator(store, now = { 1000L })
    }
    @After fun close() = db.close()
    private fun event(id: String, text: String) = c.onSourceEvent(owner, "95555", PaymentSourceType.SMS,
        "synthetic-closeout-$id", "招商银行", text, uploadEventId = "synthetic-closeout-$id")
    private fun auth(amount: Int = 200) = event("auth", "预授权 USD $amount.00 交易号 $family")
    private fun capture(id: String, amount: Int, revision: Int = 0) = event("capture-$id",
        "部分结算成功 已扣款 USD $amount.00 授权号 $family 交易号 SYNTH-CAPTURE-$id" + if (revision > 0) " 状态版本 $revision" else "")
    private fun release(id: String, amount: Int) = event("release-$id",
        "预授权部分解除 USD $amount.00 授权号 $family 交易号 SYNTH-RELEASE-$id")
    private fun refund(id: String, amount: Int) = event("refund-$id",
        "部分退款成功 USD $amount.00 授权号 $family 交易号 SYNTH-REFUND-$id")
    private fun money(direction: String) = store.localBookings(owner).filter { it.direction == direction }.sumOf { it.amountMinor }
    // Reflection makes the pre-fix run fail on missing behavior, not compilation.
    private fun balance(): Any {
        val method = c.javaClass.methods.firstOrNull { it.name == "lifecycleBalance" && it.parameterCount == 3 }
        assertNotNull("the product must expose an auditable lifecycle projection", method)
        return requireNotNull(method!!.invoke(c, owner, "bank_card:cmb", family))
    }
    private fun number(name: String): Long? = balance().javaClass.getDeclaredField(name).let { it.isAccessible = true; (it.get(balance()) as? Number)?.toLong() }

    @Test fun twoPartialCapturesAndTwoPartialReleasesConserveTheOriginalHold() {
        auth()
        repeat(30) { capture("one", 80) }
        capture("two", 90)
        assertEquals(17000L, money("EXPENSE"))
        assertEquals(20000L, number("authorizedMinor"))
        assertEquals(17000L, number("clearedMinor"))
        assertEquals(3000L, number("remainingFrozenMinor"))
        release("one", 10)
        assertEquals(1000L, number("releasedMinor"))
        assertEquals(2000L, number("remainingFrozenMinor"))
        repeat(30) { release("two", 20) }
        assertEquals(3000L, number("releasedMinor"))
        assertEquals(0L, number("remainingFrozenMinor"))
        assertEquals(2, store.localBookings(owner).size)
    }
    @Test fun aTrustedCaptureMayExceedTheOriginalReservationWithoutNegativeHold() {
        auth(100); capture("over", 120)
        assertEquals(12000L, money("EXPENSE"))
        assertEquals(10000L, number("authorizedMinor"))
        assertEquals(2000L, number("overCapturedMinor"))
        assertEquals(0L, number("remainingFrozenMinor"))
    }
    @Test fun severalPartialRefundsAndFinalRefundNeverExceedCapturedMoney() {
        auth(100); capture("paid", 80)
        repeat(30) { refund("one", 20) }
        refund("two", 30); refund("three", 30)
        assertEquals(8000L, money("EXPENSE"))
        assertEquals(8000L, money("REFUND"))
        assertEquals(8000L, number("refundedMinor"))
        assertEquals(0L, number("netExpenseMinor"))
        val excess = refund("excess", 1)
        assertEquals(8000L, money("REFUND"))
        assertEquals("lifecycle_refund_exceeds_capture", store.recognition(owner, excess.recognitionId)?.identityReviewReason)
    }
    @Test fun refundBeforeCaptureIsRetainedThenResumesFromTheExactFamily() {
        auth(100)
        val early = refund("early", 20)
        assertEquals(0L, money("REFUND"))
        assertEquals("lifecycle_capture_missing", store.recognition(owner, early.recognitionId)?.identityReviewReason)
        capture("later", 80)
        assertEquals(2000L, money("REFUND"))
        assertEquals(6000L, number("netExpenseMinor"))
        assertEquals(2, store.localBookings(owner).size)
    }
    @Test fun partialReleaseCannotUnfreezeMoreThanTheProvenRemainingBalance() {
        val hold = auth(100); capture("paid", 80)
        val wrong = release("excess", 30)
        assertEquals("lifecycle_release_exceeds_remaining", store.recognition(owner, wrong.recognitionId)?.identityReviewReason)
        assertEquals("FINANCE_PENDING_CONFIRMATION", store.recognition(owner, hold.recognitionId)?.state)
        assertEquals(0L, number("releasedMinor"))
        assertNull("unresolved contradictory evidence makes the current hold uncertain", number("remainingFrozenMinor"))
    }
    @Test fun explicitExpiryClosesOnlyTheUnusedReservationAndKeepsExpense() {
        auth(100); capture("paid", 80)
        event("expiry", "预授权过期 USD 100.00 交易号 $family")
        assertEquals(8000L, money("EXPENSE"))
        assertEquals(2000L, number("releasedMinor"))
        assertEquals(0L, number("remainingFrozenMinor"))
    }
    @Test fun lateAuthorizationSuppliesTheOriginalLimitWithoutAnotherExpense() {
        capture("first", 80)
        assertEquals(8000L, money("EXPENSE"))
        assertNull(number("authorizedMinor"))
        auth(100)
        assertEquals(10000L, number("authorizedMinor"))
        assertEquals(2000L, number("remainingFrozenMinor"))
        assertEquals(1, store.localBookings(owner).size)
    }
    @Test fun versionedCorrectionIsIdentifiedAndQuarantinedWithoutRenamingOldLedger() {
        auth(); capture("versioned", 80, 1)
        val original = store.localBookings(owner).single()
        repeat(30) { event("revision-$it", "部分结算成功 已扣款 USD 90.00 授权号 $family 交易号 SYNTH-CAPTURE-versioned 状态版本 2") }
        assertEquals(listOf(original), store.localBookings(owner))
        val review = store.recognitionBySourceEvent(owner, "synthetic-closeout-revision-29")!!
        assertEquals("lifecycle_revision_requires_reconciliation", review.identityReviewReason)
        val version = review.javaClass.getDeclaredField("lifecycleRevision").let { it.isAccessible = true; it.get(review) }
        assertEquals(2L, (version as Number).toLong())
    }
    @Test fun c005AndC007KeepTheirOriginalEvidenceAndCannotInventTheMissingIdentity() {
        auth()
        event("ambiguous-a", "结算成功 已扣款 USD 80.00 交易号 $family")
        val conflict = event("ambiguous-b", "结算成功 已扣款 USD 90.00 交易号 $family")
        assertEquals(8000L, money("EXPENSE"))
        assertEquals(9000L, store.recognition(owner, conflict.recognitionId)?.amountMinor)
        assertEquals("reference_money_or_instance_conflict", store.recognition(owner, conflict.recognitionId)?.identityReviewReason)
        assertNull(number("remainingFrozenMinor"))
        event("ambiguous-close", "预授权解除 USD 200.00 交易号 $family")
        assertNull("the released residual is unknown while capture identity is unresolved", number("releasedMinor"))
        event("missing-auth", "预授权 USD 200.00")
        event("missing-cap", "结算成功 已扣款 USD 170.00")
        assertEquals(8000L, money("EXPENSE"))
        assertEquals(1, store.localBookings(owner).size)
    }

    @Test fun expiryBeforeAuthorizationKeepsTheReleasedAmountUnknownUntilTheLimitArrives() {
        capture("first",80)
        event("close-before-auth","预授权过期 USD 100.00 交易号 $family")
        assertNull(number("releasedMinor"))
        auth(100)
        assertEquals(2000L,number("releasedMinor"))
        assertEquals(0L,number("remainingFrozenMinor"))
        assertEquals(8000L,money("EXPENSE"))
    }

    @Test fun unsafeHistoricalAggregateIsPreservedButCannotAcceptAnotherCapture() {
        auth();capture("legacy-range",80)
        val existing=store.localBookings(owner).single()
        val amount=9_007_199_254_740_891L
        db.openHelper.writableDatabase.execSQL("UPDATE payment_recognitions SET amountMinor=$amount WHERE recognitionId=?",arrayOf(existing.recognitionId))
        db.openHelper.writableDatabase.execSQL("UPDATE local_payment_bookings SET amountMinor=$amount WHERE eventId=?",arrayOf(existing.eventId))
        val rejected=capture("range-extra",2)
        assertEquals("lifecycle_total_out_of_range",store.recognition(owner,rejected.recognitionId)?.identityReviewReason)
        assertEquals(existing.transactionId,store.localBookings(owner).single().transactionId)
        assertEquals(amount,store.localBookings(owner).single().amountMinor)
        assertNull(number("remainingFrozenMinor"))
    }
}
