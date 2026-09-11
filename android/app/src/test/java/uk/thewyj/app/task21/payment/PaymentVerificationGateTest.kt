package uk.thewyj.app.task21.payment

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.thewyj.app.ui.PaymentVerificationState

/**
 * Guards for the real-device accessibility fixes (SM-S9360 / Android 16):
 *
 *  - the service used to query Room for every accessibility event and therefore
 *    reported `no_active_ticket` for SystemUI/launcher/IME noise dozens of times
 *    per second;
 *  - the booking identity must be stable so a retry never books twice.
 */
class PaymentVerificationGateTest {
    private class Clock(var value: Long = 0L)

    @Test fun packageCacheOnlyMatchesRefreshedTicketPackages() {
        val clock = Clock()
        val cache = PaymentTicketPackageCache(refreshIntervalMs = 3_000L, now = { clock.value })
        assertTrue(cache.isEmpty())
        assertFalse(cache.contains("com.tencent.mm"))

        cache.refreshWith(listOf("com.tencent.mm", "com.eg.android.AlipayGphone"))
        assertTrue(cache.contains("com.tencent.mm"))
        // Accessibility events report the package exactly as installed; the gate
        // must not be case sensitive.
        assertTrue(cache.contains("COM.TENCENT.MM"))
        assertTrue(cache.contains("com.eg.android.alipaygphone"))
        assertFalse(cache.contains("com.android.systemui"))
    }

    @Test fun packageCacheAsksForARefreshOnlyAfterTheInterval() {
        val clock = Clock()
        val cache = PaymentTicketPackageCache(refreshIntervalMs = 3_000L, now = { clock.value })
        cache.refreshWith(emptyList())
        assertFalse(cache.needsRefresh())
        clock.value = 2_999L
        assertFalse(cache.needsRefresh())
        clock.value = 3_000L
        assertTrue(cache.needsRefresh())
        cache.refreshWith(listOf("com.tencent.mm"))
        assertFalse(cache.needsRefresh())
    }

    @Test fun logThrottleCollapsesRepeatsButKeepsStateChanges() {
        val clock = Clock()
        val throttle = PaymentLogThrottle(intervalMs = 15_000L, now = { clock.value })
        assertTrue(throttle.allow("no_active_ticket"))
        assertFalse(throttle.allow("no_active_ticket"))
        // A different outcome is a real state change: always reported.
        assertTrue(throttle.allow("amount=2800 direction=EXPENSE"))
        clock.value = 15_000L
        assertTrue(throttle.allow("no_active_ticket"))
    }

    @Test fun bookingIdentityIsDeterministicPerRecognition() {
        val first = recognition("rec-1")
        val second = recognition("rec-2")
        assertEquals("pay-verify:rec-1", PaymentVerificationCenter.bookingEventId(first))
        assertEquals(
            PaymentVerificationCenter.bookingEventId(first),
            PaymentVerificationCenter.bookingEventId(recognition("rec-1")),
        )
        assertNotEquals(
            PaymentVerificationCenter.bookingEventId(first),
            PaymentVerificationCenter.bookingEventId(second),
        )
    }

    /**
     * Double-booking guard: a payment that already had an amount was uploaded
     * and is confirmed on the Finance page. A legacy row (created before the
     * upload identity was persisted) must be treated the same way, otherwise
     * the upgrade would book every historical candidate a second time.
     */
    @Test fun bookingAuthorityNeverLetsTheDeviceDoubleBookAnUploadedPayment() {
        val state = { name: String -> name }
        assertEquals(
            PaymentVerificationCenter.Authority.SERVER,
            PaymentVerificationCenter.authorityOf(
                recognition("rec-amount-known", state = PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION.name),
            ),
        )
        // Legacy row: state from before the fix, no stored upload identity.
        assertEquals(
            PaymentVerificationCenter.Authority.SERVER,
            PaymentVerificationCenter.authorityOf(recognition("rec-legacy")),
        )
        // Amount-unknown capture: still waiting for the user.
        assertEquals(
            PaymentVerificationCenter.Authority.NEEDS_AMOUNT,
            PaymentVerificationCenter.authorityOf(
                recognition("rec-waiting", state = PaymentRecognitionState.WAITING_FOR_ENRICHMENT.name),
            ),
        )
        // Verified on this device: this side owns the booking.
        assertEquals(
            PaymentVerificationCenter.Authority.DEVICE,
            PaymentVerificationCenter.authorityOf(
                recognition("rec-verified", state = PaymentRecognitionState.ENRICHMENT_VERIFIED.name),
            ),
        )
        assertEquals(
            PaymentVerificationCenter.Authority.SERVER,
            PaymentVerificationCenter.authorityOf(
                recognition(
                    "rec-verified-uploaded",
                    state = PaymentRecognitionState.ENRICHMENT_VERIFIED.name,
                    uploadEventId = "evt-1",
                ),
            ),
        )
    }

    @Test fun amountTextParsingRejectsAmbiguousInput() {
        assertEquals(2800L, PaymentVerificationState.parseMinor("28"))
        assertEquals(2800L, PaymentVerificationState.parseMinor("28.00"))
        assertEquals(2850L, PaymentVerificationState.parseMinor("28.5"))
        assertEquals(0L, PaymentVerificationState.parseMinor("0"))
        assertEquals(null, PaymentVerificationState.parseMinor(""))
        assertEquals(null, PaymentVerificationState.parseMinor("12.345"))
        assertEquals(null, PaymentVerificationState.parseMinor("28元"))
        assertEquals(null, PaymentVerificationState.parseMinor("abc"))
        assertEquals("28.00", PaymentVerificationState.formatMinor(2800L))
        assertEquals("28.05", PaymentVerificationState.formatMinor(2805L))
    }

    /**
     * Users must never see a package name or the generic 「该应用」 in a payment
     * notification. Dual-app / Secure Folder installs make the system label
     * lookup fail, so the payment apps keep a stable display name.
     */
    @Test fun paymentAppLabelsNeverFallBackToPackageNames() {
        assertEquals("微信", PaymentAppLabels.known("com.tencent.mm"))
        assertEquals("支付宝", PaymentAppLabels.known("com.eg.android.AlipayGphone"))
        assertEquals(null, PaymentAppLabels.known("com.example.unknown"))
    }

    private fun recognition(
        id: String,
        state: String = "FINANCE_PENDING_CONFIRMATION",
        uploadEventId: String = "",
    ) = PaymentRecognitionRecord(
        recognitionId = id,
        accountId = "account-a",
        state = state,
        notificationId = 1,
        sourcePackage = "com.tencent.mm",
        sourceType = "NOTIFICATION",
        sourceEventId = "notification#key#1",
        uploadEventId = uploadEventId,
        paymentChannel = "wechat",
        amountMinor = null,
        currency = "CNY",
        direction = "",
        merchant = "",
        providerReference = "",
        createdAtMs = 1_000L,
        updatedAtMs = 1_000L,
    )
}
