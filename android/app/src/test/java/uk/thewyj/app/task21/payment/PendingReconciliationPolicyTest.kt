package uk.thewyj.app.task21.payment

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Task 24 reopen #4 (fake clock): the catch-up pull that closes the
 * "Web confirmed, Android screen still shows 待确认" gap must be bounded.
 *
 * A permanent poll would drain the battery for a screen the user may have left
 * open; no pull at all leaves the row stale until the user navigates away. This
 * pins the middle ground: a few pulls with a growing delay, then stop.
 */
class PendingReconciliationPolicyTest {
    @Test fun terminalOrLocalRecordsNeverTriggerAPull() {
        assertFalse(PendingReconciliationPolicy.needsReconciliation(listOf("SYNCED")))
        assertFalse(PendingReconciliationPolicy.needsReconciliation(listOf("LOCAL_ONLY")))
        assertFalse(PendingReconciliationPolicy.needsReconciliation(listOf("SYNC_REJECTED")))
        assertFalse(PendingReconciliationPolicy.needsReconciliation(emptyList()))
        assertNull(PendingReconciliationPolicy.nextDelayMs(0, listOf("SYNCED", "LOCAL_ONLY")))
        assertNull(PendingReconciliationPolicy.nextDelayMs(0, emptyList()))
    }

    @Test fun serverOwnedAndFailedRecordsDoTriggerAPull() {
        assertTrue(PendingReconciliationPolicy.needsReconciliation(listOf("PENDING_SYNC")))
        assertTrue(PendingReconciliationPolicy.needsReconciliation(listOf("SYNC_FAILED")))
        assertTrue(
            "one pending record is enough, even next to terminal ones",
            PendingReconciliationPolicy.needsReconciliation(listOf("SYNCED", "PENDING_SYNC")),
        )
        assertEquals(1_500L, PendingReconciliationPolicy.nextDelayMs(0, listOf("PENDING_SYNC")))
    }

    @Test fun catchUpIsBoundedAndBacksOff() {
        val states = listOf("PENDING_SYNC")
        val delays = mutableListOf<Long>()
        var attempt = 0
        // Fake clock: ask the policy for the next delay until it says stop.
        while (true) {
            val delayMs = PendingReconciliationPolicy.nextDelayMs(attempt, states) ?: break
            delays.add(delayMs)
            attempt += 1
            if (attempt > 32) break
        }
        assertEquals(listOf(1_500L, 3_000L, 6_000L, 12_000L), delays)
        assertEquals("exactly four catch-up pulls inside one window", 4, attempt)
        assertEquals(22_500L, PendingReconciliationPolicy.windowMs)
        assertEquals(PendingReconciliationPolicy.BACKOFF_MS.sum(), PendingReconciliationPolicy.windowMs)
        assertNull(
            "the device must stop after the bounded window",
            PendingReconciliationPolicy.nextDelayMs(attempt, states),
        )
    }

    @Test fun clearingThePendingRecordStopsTheLoopImmediately() {
        assertEquals(1_500L, PendingReconciliationPolicy.nextDelayMs(0, listOf("PENDING_SYNC")))
        assertNull(
            "a Web-side confirm arriving between two attempts stops the catch-up",
            PendingReconciliationPolicy.nextDelayMs(1, listOf("SYNCED")),
        )
    }

    @Test fun everyDelayIsPositiveAndStrictlyGrowing() {
        val delays = PendingReconciliationPolicy.BACKOFF_MS
        assertTrue(delays.isNotEmpty())
        delays.forEach { assertTrue("delay must be positive: $it", it > 0) }
        for (index in 1 until delays.size) {
            assertTrue("delay ${delays[index]} must be longer than ${delays[index - 1]}", delays[index] > delays[index - 1])
        }
        assertTrue(
            "the whole catch-up window stays under half a minute",
            PendingReconciliationPolicy.windowMs < 30_000L,
        )
    }
}
