package uk.thewyj.app.task21.payment

import org.junit.Assert.*
import org.junit.Test

class PaymentPageRetryPoolTest {
    @Test fun detailLoadingAfterTwelveSecondsCanStillUseAnUnexpiredTicket() {
        val pool = PaymentPageRetryPool()
        val first = pool.budget("account-a", "ticket-a", 1000)
        assertTrue(first.beginAttempt(1000))
        val detail = pool.budget("account-a", "ticket-a", 21000)
        assertSame(first, detail)
        assertTrue(detail.beginAttempt(21000))
        assertFalse(detail.beginAttempt(91001))
    }

    @Test fun windowChangesCannotResetTheEightReadLimitOrCrossAccount() {
        val pool = PaymentPageRetryPool()
        repeat(8) { assertTrue(pool.budget("account-a", "ticket-a", it * 1000L).beginAttempt(it * 1000L)) }
        assertFalse(pool.budget("account-a", "ticket-a", 12000).beginAttempt(12000))
        assertTrue(pool.budget("account-b", "ticket-a", 12000).beginAttempt(12000))
        assertTrue(pool.budget("account-a", "ticket-b", 12000).beginAttempt(12000))
    }

    @Test fun closingTheServiceInvalidatesPendingCallbacksAndBudgets() {
        val pool = PaymentPageRetryPool()
        val old = pool.budget("account-a", "ticket-a", 0)
        pool.clear()
        assertFalse(old.beginAttempt(1000))
        assertNotSame(old, pool.budget("account-a", "ticket-a", 1000))
    }
}
