package uk.thewyj.app.task21

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * P0 root-cause guard: "金额已识别但没有进入 Finance".
 *
 * The client used to delete a queued payment as soon as the server answered
 * `duplicate: true`. When that answer carried no transaction and no candidate,
 * the recognition result was silently thrown away. A duplicate may only be
 * treated as handled when the answer proves the server owns a ledger record.
 */
class NotificationFinanceLedgerIdentityTest {
    @Test fun bareDuplicateIsNotProofOfALedgerRecord() {
        val body = """{"ok":true,"duplicate":true,"operation_results":[{"duplicate":true}]}"""
        assertTrue(NotificationCaptureCoordinator.ingestWasAlreadyHandled(body))
        assertFalse(
            "a duplicate without transaction_id/candidate_id must stay queued",
            NotificationCaptureCoordinator.ingestOwnsLedgerIdentity(body),
        )
    }

    @Test fun duplicateWithTransactionIsHandled() {
        val body = """{"ok":true,"operation_results":[{"duplicate":true,"transaction_id":"txn-1"}]}"""
        assertTrue(NotificationCaptureCoordinator.ingestWasAlreadyHandled(body))
        assertTrue(NotificationCaptureCoordinator.ingestOwnsLedgerIdentity(body))
    }

    @Test fun duplicateWithCandidateIsHandled() {
        val body = """{"duplicate":true,"operation_results":[{"candidate_id":"cand-1"}]}"""
        assertTrue(NotificationCaptureCoordinator.ingestWasAlreadyHandled(body))
        assertTrue(NotificationCaptureCoordinator.ingestOwnsLedgerIdentity(body))
    }

    @Test fun concreteLedgerIdentityCountsAsHandledEvidence() {
        val body = """{"ok":true,"operation_results":[{"transaction_id":"txn-2","candidate_id":""}]}"""
        assertTrue(NotificationCaptureCoordinator.ingestOwnsLedgerIdentity(body))
    }

    @Test fun malformedBodiesAreNeverTreatedAsHandled() {
        assertFalse(NotificationCaptureCoordinator.ingestWasAlreadyHandled("not json"))
        assertFalse(NotificationCaptureCoordinator.ingestOwnsLedgerIdentity("not json"))
        assertFalse(NotificationCaptureCoordinator.ingestOwnsLedgerIdentity("{}"))
    }
}
