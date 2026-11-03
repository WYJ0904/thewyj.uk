package uk.thewyj.app.core.web

import org.junit.Assert.*
import org.junit.Test

class PaymentPublicationGateTest {
    @Test fun delayedSnapshotCannotReplaceNewerPublication() {
        val gate = PaymentPublicationGate()
        val a = gate.begin(); val b = gate.begin()
        assertTrue(gate.isCurrent(b)); assertFalse(gate.isCurrent(a))
    }
    @Test fun reloadPauseAndDisposalInvalidateOldDocumentResults() {
        val gate = PaymentPublicationGate()
        val old = gate.begin(); gate.invalidate()
        assertFalse(gate.isCurrent(old))
        val resumed = gate.begin(); assertTrue(gate.isCurrent(resumed))
    }
}
