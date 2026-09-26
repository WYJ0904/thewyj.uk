package uk.thewyj.app.task21.payment

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.thewyj.app.core.network.PendingReviewIdentity
import uk.thewyj.app.core.network.PendingReviewSummary

class PendingReviewReconcilerTest {
    @Test fun summaryCannotClaimCompletionWhenItsIdentityCountDiffersFromN() {
        val remote = PendingReviewSummary("now", 2, 2, 0, false,
            listOf(PendingReviewIdentity("hint", "hint-one", "event-one", "device-a")))
        val result = PendingReviewReconciler.reconcile(emptyList(), remote)
        assertEquals(2, result.total)
        assertFalse(result.complete)
    }
    @Test fun offlineQueueIsRecoveryAndNeverInflatesCanonicalPending() {
        val ids = setOf("event-offline")
        assertEquals(PendingReviewVisibility.Placement.RECOVERY,
            PendingReviewVisibility.classify(ids, "pay-verify:rec-offline", emptySet(), setOf("hint:event-offline")))
        assertEquals(PendingReviewVisibility.Placement.CANONICAL,
            PendingReviewVisibility.classify(ids, "pay-verify:rec-offline", ids, setOf("hint:event-offline")))
        assertEquals(PendingReviewVisibility.Placement.HIDDEN,
            PendingReviewVisibility.classify(setOf("event-old"), "pay-verify:rec-old", emptySet(), emptySet()))
    }
    @Test
    fun reconcilesByStableEventIdentityInsteadOfAddingCounts() {
        val local = listOf(
            recognition("local-a", "event-shared"),
            recognition("local-b", "event-local"),
            recognition("legacy-local", ""),
        )
        val remote = summary(
            PendingReviewIdentity("hint", "hint-a", "event-shared", "device-a"),
            PendingReviewIdentity("hint", "hint-b", "event-remote", "device-b"),
            PendingReviewIdentity("candidate", "cand-c", "event-candidate", "device-b"),
        )

        val result = PendingReviewReconciler.reconcile(local, remote)

        assertEquals(3, result.total)
        assertEquals(3, result.local)
        assertEquals(3, result.remote)
        assertEquals(1, result.overlap)
        assertEquals(1, result.localOnly)
        assertEquals(1, result.unresolved)
        assertEquals(2, result.remoteOnly)
        assertTrue(result.complete)
        assertEquals(remote.totalCount, result.total)
    }

    @Test
    fun equalAmountsOrCloseTimesCannotMergeDifferentEventIds() {
        val first = recognition("one", "event-amount-280-a")
        val second = recognition("two", "event-amount-280-b")
        val remote = summary(
            PendingReviewIdentity("candidate", "candidate-one", "event-amount-280-a", "device-a"),
            PendingReviewIdentity("candidate", "candidate-two", "event-amount-280-b", "device-a"),
        )

        val result = PendingReviewReconciler.reconcile(listOf(first, second), remote)

        assertEquals(2, result.total)
        assertEquals(2, result.overlap)
        assertEquals(0, result.localOnly)
        assertEquals(0, result.remoteOnly)
    }

    @Test
    fun truncatedServerObservationIsExplicitlyNotComplete() {
        val record = PendingReviewIdentity("hint", "hint-a", "event-a", "device-a")
        val remote = summary(record).copy(totalCount = 3, truncated = true)

        val result = PendingReviewReconciler.reconcile(emptyList(), remote)

        assertEquals(3, result.total)
        assertEquals(3, result.remoteOnly)
        assertFalse(result.complete)
    }

    @Test fun terminalCloudIdentityRemovesTheMatchingLocalPendingItem() {
        val local = recognition("local-terminal", "event-terminal")
        val terminal = PendingReviewIdentity(
            kind = "hint",
            id = "hint-terminal",
            eventId = "event-terminal",
            deviceId = "device-a",
            state = "confirmed",
            transactionId = "txn-terminal",
        )
        val result = PendingReviewReconciler.reconcile(
            listOf(local),
            PendingReviewSummary("now", 0, 0, 0, false, listOf(terminal)),
        )
        assertEquals(0, result.total)
        assertEquals(0, result.local)
        assertEquals(0, result.remote)
    }

    @Test fun completeCloudObservationDoesNotTreatAnAbsentUploadedEventAsNormalPending() {
        val observation = PaymentHintSync.Result(
            refreshed = 0, confirmed = 0, ignored = 0, ok = true,
            observedStates = emptyMap(), completeObservation = true,
        )
        assertEquals(
            PaymentVerificationCenter.SyncState.UNRESOLVED_REMOTE,
            paymentSyncStateFor("event-uploaded", "", false, false, false, observation),
        )
        assertEquals(
            PaymentVerificationCenter.SyncState.LOCAL_ONLY,
            paymentSyncStateFor("", "", false, false, false, observation),
        )
        assertEquals(
            PaymentVerificationCenter.SyncState.PENDING_SYNC,
            paymentSyncStateFor("event-pending", "", false, false, false,
                observation.copy(observedStates = mapOf("event-pending" to "pending"))),
        )
    }

    private fun recognition(id: String, uploadEventId: String) = PaymentRecognitionRecord(
        recognitionId = id,
        accountId = "account-a",
        state = PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION.name,
        notificationId = 1,
        sourcePackage = "com.example.pay",
        sourceType = "NOTIFICATION",
        sourceEventId = "source-$id",
        uploadEventId = uploadEventId,
        paymentChannel = "wechat",
        amountMinor = 280,
        currency = "CNY",
        direction = "EXPENSE",
        merchant = "",
        providerReference = "",
        createdAtMs = 1_000,
        updatedAtMs = 1_000,
    )

    private fun summary(vararg records: PendingReviewIdentity) = PendingReviewSummary(
        observedAt = "2026-09-14T12:00:00Z",
        totalCount = records.size,
        hintCount = records.count { it.kind == "hint" },
        candidateCount = records.count { it.kind == "candidate" },
        truncated = false,
        records = records.toList(),
    )
}
