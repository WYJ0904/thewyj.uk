package uk.thewyj.app.task21.payment

import kotlinx.coroutines.async
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class PaymentReviewSignalsTest {
    @Test fun updateBeforeSubscriptionRemainsReadableOnResume() = runTest {
        PaymentReviewSignals.publish()
        val first = async { PaymentReviewSignals.changes.first() }
        runCurrent()
        try { assertTrue("a returning page must observe retained invalidation", first.isCompleted) }
        finally { first.cancel() }
    }
    @Test fun slowCollectorObservesLatestInvalidationEvenWhenCountIsUnchanged() = runTest {
        val blocked = CompletableDeferred<Unit>()
        val values = mutableListOf<Long>()
        val job = launch { PaymentReviewSignals.changes.collect { values += it; if (values.size == 1) blocked.await() } }
        runCurrent()
        repeat(100) { PaymentReviewSignals.publish() }
        val latest = PaymentReviewSignals.changes.value
        blocked.complete(Unit); runCurrent()
        assertEquals(2, values.size)
        assertEquals(latest, values.last())
        job.cancelAndJoin()
    }
}
