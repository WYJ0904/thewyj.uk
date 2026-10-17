package uk.thewyj.app.task21.payment

import org.junit.Assert.assertEquals
import org.junit.Test

class PaymentCountdownTest {
    @Test fun ninetySecondsCountsDownWithoutRefreshingItem() {
        val clock = PaymentCountdown()
        assertEquals(90_000L, clock.remainingMs("a", 100_000, 10_000, 1_000))
        assertEquals(45_000L, clock.remainingMs("a", 100_000, 55_000, 46_000))
        assertEquals(0L, clock.remainingMs("a", 100_000, 110_000, 101_000))
    }
    @Test fun recompositionAndResumeDoNotRenewExpiry() {
        val clock = PaymentCountdown()
        repeat(20) { assertEquals(90_000L, clock.remainingMs("a", 100_000, 10_000, 1_000)) }
        assertEquals(10_000L, clock.remainingMs("a", 100_000, 90_000, 81_000))
        assertEquals(0L, clock.remainingMs("a", 100_000, 101_000, 92_000))
    }
    @Test fun backwardsWallClockCannotExtendAndForwardsClockCanExpire() {
        val clock = PaymentCountdown()
        clock.remainingMs("a", 100_000, 10_000, 1_000)
        assertEquals(60_000L, clock.remainingMs("a", 100_000, 5_000, 31_000))
        assertEquals(0L, clock.remainingMs("a", 100_000, 120_000, 32_000))
        assertEquals(0L, clock.remainingMs("a", 100_000, 10_000, 33_000))
    }
    @Test fun multipleTicketsAreIndependentAndNewTicketHasItsOwnWindow() {
        val clock = PaymentCountdown()
        assertEquals(90_000L, clock.remainingMs("a", 100_000, 10_000, 1_000))
        assertEquals(50_000L, clock.remainingMs("b", 60_000, 10_000, 1_000))
        assertEquals(30_000L, clock.remainingMs("a", 100_000, 70_000, 61_000))
        assertEquals(0L, clock.remainingMs("b", 60_000, 70_000, 61_000))
        assertEquals(90_000L, clock.remainingMs("a-new", 160_000, 70_000, 61_000))
    }
}
