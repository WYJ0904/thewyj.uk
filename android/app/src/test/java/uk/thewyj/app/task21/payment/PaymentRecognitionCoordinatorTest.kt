package uk.thewyj.app.task21.payment

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.thewyj.app.task21.FinanceDirection
import uk.thewyj.app.task21.store.PaymentRecognitionStoreContract

/**
 * Phase 7-9 software side: the single payment pipeline, the 90 second ticket
 * flow, candidate edit-before-confirm and finance correction reporting.
 */
class PaymentRecognitionCoordinatorTest {
    private class Clock(var value: Long = 1_000L) {
        fun advance(ms: Long) {
            value += ms
        }
    }

    private class FakeNotifier : PaymentStatusNotifier {
        val messages = mutableListOf<PaymentStatusNotificationMessage>()
        val cancelled = mutableListOf<Int>()
        var allowed = true
        override fun notify(message: PaymentStatusNotificationMessage): Boolean {
            if (!allowed) return false
            messages.add(message)
            return true
        }
        override fun cancel(notificationId: Int) {
            cancelled.add(notificationId)
        }
    }

    private class FakeStore : PaymentRecognitionStoreContract {
        val recognitions = mutableMapOf<String, PaymentRecognitionRecord>()
        val tickets = mutableMapOf<String, PaymentTicket>()
        val candidates = mutableMapOf<String, PaymentCandidate>()

        override fun saveRecognition(record: PaymentRecognitionRecord) {
            recognitions[record.recognitionId] = record
        }
        override fun recognition(accountId: String, recognitionId: String) =
            recognitions[recognitionId]?.takeIf { it.accountId == accountId }
        override fun recognitionBySourceEvent(accountId: String, sourceEventId: String) =
            recognitions.values.firstOrNull { it.accountId == accountId && it.sourceEventId == sourceEventId }

        override fun saveTicket(ticket: PaymentTicket) {
            tickets[ticket.ticketId] = ticket
        }
        override fun ticket(accountId: String, ticketId: String) =
            tickets[ticketId]?.takeIf { it.accountId == accountId }
        override fun activeTicketForPackage(accountId: String, sourcePackage: String) =
            tickets.values
                .filter { it.accountId == accountId && it.sourcePackage == sourcePackage && it.state.active }
                .maxByOrNull { it.createdAtMs }
        override fun ticketsForRecognition(accountId: String, recognitionId: String) =
            tickets.values.filter { it.accountId == accountId && it.recognitionId == recognitionId }
        override fun activeTicketPackages(accountId: String, nowMs: Long) =
            tickets.values
                .filter { it.accountId == accountId && it.state.active && it.expiresAtMs > nowMs }
                .map { it.sourcePackage }
                .toSet()
        override fun openTickets(accountId: String, limit: Int) =
            tickets.values
                .filter { it.accountId == accountId && it.state in setOf(PaymentTicketState.CREATED, PaymentTicketState.WAITING_FOR_ACCESSIBILITY) }
                .sortedByDescending { it.createdAtMs }
                .take(limit)
        override fun recognitionsByState(accountId: String, states: List<String>, limit: Int) =
            recognitions.values
                .filter { it.accountId == accountId && it.state in states }
                .sortedByDescending { it.updatedAtMs }
                .take(limit)

        override fun saveCandidate(candidate: PaymentCandidate) {
            candidates[candidate.candidateId] = candidate
        }
        override fun candidate(accountId: String, candidateId: String) =
            candidates[candidateId]?.takeIf { it.accountId == accountId }
        override fun candidateForRecognition(accountId: String, recognitionId: String) =
            candidates.values.firstOrNull { it.accountId == accountId && it.recognitionId == recognitionId }
        override fun candidates(accountId: String, status: String, limit: Int) =
            candidates.values.filter { it.accountId == accountId && it.status == status }.take(limit)
        override fun pendingCandidateCount(accountId: String) =
            candidates.values.count { it.accountId == accountId && it.status == "pending" }
        override fun observePendingCandidateCount(accountId: String) =
            kotlinx.coroutines.flow.flowOf(pendingCandidateCount(accountId))
        override fun reconciliationMatch(
            accountId: String,
            amountMinor: Long,
            occurredAtMs: Long,
            windowMs: Long,
        ) = candidates.values.firstOrNull {
            it.accountId == accountId && it.status in setOf("pending", "confirmed") &&
                it.amountMinor == amountMinor &&
                kotlin.math.abs(it.occurredAtMs - occurredAtMs) <= windowMs
        }
    }

    private fun coordinator(
        store: FakeStore,
        notifier: FakeNotifier,
        clock: Clock,
    ) = PaymentRecognitionCoordinator(
        store = store,
        tickets = PaymentTicketEngine(now = { clock.value }),
        statusMachine = PaymentStatusStateMachine(now = { clock.value }),
        notifier = notifier,
        now = { clock.value },
    )

    @Test fun confirmedAmountCreatesCandidateAndNotifiesOnce() {
        val store = FakeStore()
        val notifier = FakeNotifier()
        val clock = Clock()
        val coordinator = coordinator(store, notifier, clock)

        val outcome = coordinator.onSourceEvent(
            accountId = "account-a",
            sourcePackage = "com.tencent.mm",
            sourceType = PaymentSourceType.NOTIFICATION,
            sourceEventId = "notification#key-1#1000",
            title = "微信支付",
            text = "支付成功 ￥28.00",
            sourceAppLabel = "微信",
        )
        assertNotNull(outcome.state)
        assertTrue(outcome.candidateId.isNotBlank())
        assertEquals(1, store.pendingCandidateCount("account-a"))
        assertEquals(PaymentRecognitionState.FINANCE_PENDING_CONFIRMATION.name, store.recognition("account-a", outcome.recognitionId)?.state)
        // Two state transitions, but they reuse one notification id so the user
        // sees a single notification that updates in place.
        assertEquals(1, notifier.messages.map { it.notificationId }.distinct().size)
        assertTrue(notifier.messages.last().body.contains("28.00"))
    }

    /**
     * The device has to know whether the booking authority for a payment is the
     * server (the event was uploaded as a candidate) or itself (the amount was
     * unknown, so the event stays local until the user verifies it). Without
     * this the in-app verification screen could book a payment twice.
     */
    @Test fun uploadedCaptureRecordsItsStructuredEventIdentity() {
        val store = FakeStore()
        val coordinator = coordinator(store, FakeNotifier(), Clock())
        val outcome = coordinator.onSourceEvent(
            accountId = "account-a",
            sourcePackage = "com.tencent.mm",
            sourceType = PaymentSourceType.NOTIFICATION,
            sourceEventId = "notification#key-9#9000",
            title = "微信支付",
            text = "已支付 ¥100.00",
            sourceAppLabel = "微信",
            uploadEventId = "evt-uploaded-1",
        )
        assertEquals(
            "evt-uploaded-1",
            store.recognition("account-a", outcome.recognitionId)?.uploadEventId,
        )
    }

    @Test fun localOnlyHintKeepsUploadIdentityEmpty() {
        val store = FakeStore()
        val coordinator = coordinator(store, FakeNotifier(), Clock())
        val outcome = coordinator.onSourceEvent(
            accountId = "account-a",
            sourcePackage = "com.tencent.mm",
            sourceType = PaymentSourceType.NOTIFICATION,
            sourceEventId = "notification#key-10#10000",
            title = "微信支付",
            text = "转账",
            sourceAppLabel = "微信",
        )
        assertEquals("", store.recognition("account-a", outcome.recognitionId)?.uploadEventId)
        // The 90 second ticket is the only local record; nothing is uploaded.
        assertTrue(outcome.ticketId.isNotBlank())
        assertEquals(0, store.pendingCandidateCount("account-a"))
    }

    @Test fun duplicateSourceEventIsIgnoredWithoutASecondNotification() {
        val store = FakeStore()
        val notifier = FakeNotifier()
        val coordinator = coordinator(store, notifier, Clock())
        val first = coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-1#1000", "微信支付", "支付成功 ￥28.00",
        )
        val second = coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-1#1000", "微信支付", "支付成功 ￥28.00",
        )
        assertEquals("duplicate_source_event", second.skippedReason)
        assertEquals(first.recognitionId, second.recognitionId)
        assertEquals(2, notifier.messages.size)
        assertEquals(1, notifier.messages.map { it.notificationId }.distinct().size)
        assertEquals(1, store.pendingCandidateCount("account-a"))
    }

    @Test fun amountUnknownCreatesNinetySecondTicketAndHintNotification() {
        val store = FakeStore()
        val notifier = FakeNotifier()
        val coordinator = coordinator(store, notifier, Clock())
        val outcome = coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-2#2000", "老周炒股 · 内部", "转账", sourceAppLabel = "微信",
        )
        assertTrue(outcome.ticketId.isNotBlank())
        assertEquals(0, store.pendingCandidateCount("account-a"))
        assertEquals(1, store.tickets.size)
        val ticket = store.tickets.values.first()
        assertEquals(90_000L, ticket.expiresAtMs - ticket.createdAtMs)
        assertTrue(notifier.messages.any { it.body.contains("90 秒") })
    }

    /**
     * Real device: WeChat exposes no text at all to the accessibility tree, so a
     * page read legitimately returns nothing. The automatic attempt must end
     * honestly (one notification, state VERIFICATION_FAILED) instead of looping
     * forever or pretending the amount was verified.
     */
    @Test fun repeatedMissesFailVerificationOnceAndKeepManualPath() {
        val store = FakeStore()
        val notifier = FakeNotifier()
        val clock = Clock()
        val coordinator = coordinator(store, notifier, clock)
        val outcome = coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-4#4000", "", "转账", sourceAppLabel = "微信",
        )
        val messagesAfterHint = notifier.messages.size

        assertFalse(coordinator.onAccessibilityMiss("account-a", "com.tencent.mm"))
        assertEquals(messagesAfterHint, notifier.messages.size)
        assertTrue(coordinator.onAccessibilityMiss("account-a", "com.tencent.mm"))

        assertEquals(
            PaymentRecognitionState.VERIFICATION_FAILED.name,
            store.recognition("account-a", outcome.recognitionId)?.state,
        )
        val ticketAfterFailure = store.tickets.values.first()
        assertFalse(ticketAfterFailure.state.active)
        assertEquals(1, notifier.messages.count { it.title.contains("可靠的交易金额") })
        assertEquals(1, notifier.messages.count { it.offerManualVerification })
        // The hint itself is never deleted and the manual path still exists.
        assertEquals(1, store.recognitions.size)
        assertTrue(notifier.messages.last().offerManualVerification)
    }

    @Test fun accessibilityEnrichmentVerifiesAndCreatesCandidate() {
        val store = FakeStore()
        val notifier = FakeNotifier()
        val clock = Clock()
        val coordinator = coordinator(store, notifier, clock)
        coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-3#3000", "", "转账",
        )
        clock.advance(20_000L)
        val outcome = coordinator.onAccessibilityEnrichment(
            "account-a",
            PaymentEnrichment(
                sourcePackage = "com.tencent.mm",
                amountMinor = 2_800L,
                currency = "CNY",
                direction = FinanceDirection.EXPENSE,
                merchant = null,
                counterparty = null,
                providerReference = null,
                occurredAtMs = clock.value,
                confidence = 880,
            ),
        )
        assertTrue(outcome is EnrichmentOutcome.Applied)
        assertEquals(1, store.pendingCandidateCount("account-a"))
        assertTrue(notifier.messages.any { it.body.contains("28.00") })
    }

    @Test fun wrongPackageNeverEnriches() {
        val store = FakeStore()
        val coordinator = coordinator(store, FakeNotifier(), Clock())
        coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-4#4000", "", "转账",
        )
        val outcome = coordinator.onAccessibilityEnrichment(
            "account-a",
            PaymentEnrichment(
                sourcePackage = "com.eg.android.AlipayGphone",
                amountMinor = 2_800L,
                currency = "CNY",
                direction = FinanceDirection.EXPENSE,
                merchant = null,
                counterparty = null,
                providerReference = null,
                occurredAtMs = 5_000L,
                confidence = 800,
            ),
        )
        assertTrue(outcome is EnrichmentOutcome.Rejected)
        assertEquals("no_active_ticket", (outcome as EnrichmentOutcome.Rejected).reason)
        assertEquals(0, store.pendingCandidateCount("account-a"))
    }

    @Test fun expiredTicketNotifiesManualVerificationAndKeepsHint() {
        val store = FakeStore()
        val notifier = FakeNotifier()
        val clock = Clock()
        val coordinator = coordinator(store, notifier, clock)
        coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-5#5000", "", "转账",
        )
        clock.advance(91_000L)
        coordinator.onAccessibilityEnrichment(
            "account-a",
            PaymentEnrichment(
                sourcePackage = "com.tencent.mm",
                amountMinor = 2_800L,
                currency = "CNY",
                direction = FinanceDirection.EXPENSE,
                merchant = null,
                counterparty = null,
                providerReference = null,
                occurredAtMs = clock.value,
                confidence = 800,
            ),
        )
        assertTrue(notifier.messages.any { it.offerManualVerification })
        assertEquals("EXPIRED", store.tickets.values.first().state.name)
        assertEquals(0, store.pendingCandidateCount("account-a"))
    }

    @Test fun manualRestartCreatesAFreshTicket() {
        val store = FakeStore()
        val notifier = FakeNotifier()
        val clock = Clock()
        val coordinator = coordinator(store, notifier, clock)
        val outcome = coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-6#6000", "", "转账",
        )
        clock.advance(91_000L)
        val restarted = coordinator.restartVerification("account-a", outcome.recognitionId)
        assertNotNull(restarted)
        assertEquals(2, store.tickets.size)
        assertEquals(90_000L, restarted!!.expiresAtMs - restarted.createdAtMs)
        assertTrue(store.tickets.values.any { it.state == PaymentTicketState.WAITING_FOR_ACCESSIBILITY })
    }

    @Test fun editBeforeConfirmProducesOneDraftWithUserValues() {
        val store = FakeStore()
        val notifier = FakeNotifier()
        val coordinator = coordinator(store, notifier, Clock())
        val outcome = coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-7#7000", "微信支付", "支付成功 ￥20.00",
        )
        val candidateId = outcome.candidateId
        assertTrue(candidateId.isNotBlank())

        val edited = coordinator.editCandidate(
            accountId = "account-a",
            candidateId = candidateId,
            amountMinor = 1_850L,
            direction = FinanceDirection.INCOME.name,
            category = "转账收入",
        )
        assertNotNull(edited)
        assertEquals(1_850L, edited!!.effectiveAmountMinor)
        assertEquals(FinanceDirection.INCOME.name, edited.effectiveDirection)
        assertEquals("转账收入", edited.effectiveCategory)
        // Original machine values are untouched evidence.
        assertEquals(2_000L, edited.amountMinor)
        assertEquals(FinanceDirection.EXPENSE.name, edited.direction)

        val draft = coordinator.confirmCandidate("account-a", candidateId)
        assertNotNull(draft)
        assertEquals(1_850L, draft!!.amountMinor)
        assertEquals(FinanceDirection.INCOME.name, draft.direction)
        assertEquals("转账收入", draft.category)
        assertTrue(draft.userEdited)
        // Exactly one candidate exists: no "original + corrected" double write.
        assertEquals(1, store.candidates.size)
        assertEquals("confirmed", store.candidate("account-a", candidateId)?.status)
    }

    @Test fun confirmWithoutEditsRecordsFinanceOnce() {
        val store = FakeStore()
        val coordinator = coordinator(store, FakeNotifier(), Clock())
        val outcome = coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-8#8000", "微信支付", "支付成功 ￥28.00",
        )
        val draft = coordinator.confirmCandidate("account-a", outcome.candidateId)
        assertNotNull(draft)
        assertFalse(draft!!.userEdited)
        assertEquals(2_800L, draft.amountMinor)
        val again = coordinator.confirmCandidate("account-a", outcome.candidateId)
        assertNotNull(again)
        assertEquals(1, store.candidates.size)
    }

    @Test fun rejectedCandidateIsNotWrittenToFinance() {
        val store = FakeStore()
        val coordinator = coordinator(store, FakeNotifier(), Clock())
        val outcome = coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-9#9000", "微信支付", "支付成功 ￥28.00",
        )
        assertTrue(coordinator.rejectCandidate("account-a", outcome.candidateId))
        assertEquals("rejected", store.candidate("account-a", outcome.candidateId)?.status)
        assertEquals(0, store.pendingCandidateCount("account-a"))
    }

    @Test fun correctionAfterRecordingUpdatesStateWithoutNewCandidate() {
        val store = FakeStore()
        val notifier = FakeNotifier()
        val coordinator = coordinator(store, notifier, Clock())
        val outcome = coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-10#10000", "微信支付", "支付成功 ￥20.00",
        )
        coordinator.confirmCandidate("account-a", outcome.candidateId)
        coordinator.markFinanceRecorded("account-a", outcome.candidateId, "txn-1")
        assertEquals(
            PaymentRecognitionState.FINANCE_RECORDED.name,
            store.recognition("account-a", outcome.recognitionId)?.state,
        )
        coordinator.markFinanceCorrected("account-a", outcome.recognitionId, 2_000L)
        assertEquals(
            PaymentRecognitionState.FINANCE_CORRECTED.name,
            store.recognition("account-a", outcome.recognitionId)?.state,
        )
        assertEquals(1, store.candidates.size)
        assertTrue(notifier.messages.any { it.body.contains("修改") })
    }

    @Test fun reconciliationMatchesSameAmountWithinWindowOnly() {
        val store = FakeStore()
        val clock = Clock()
        val coordinator = coordinator(store, FakeNotifier(), clock)
        coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-11#11000", "微信支付", "支付成功 ￥28.00",
        )
        assertNotNull(coordinator.reconcile("account-a", 2_800L, clock.value))
        assertNull(coordinator.reconcile("account-a", 2_800L, clock.value + 10 * 60 * 1000L))
        assertNull(coordinator.reconcile("account-a", 9_900L, clock.value))
        assertNull("other accounts must not match", coordinator.reconcile("account-b", 2_800L, clock.value))
    }

    @Test fun notificationPermissionDeniedStillPersistsEverything() {
        val store = FakeStore()
        val notifier = FakeNotifier().apply { allowed = false }
        val coordinator = coordinator(store, notifier, Clock())
        val known = coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-12#12000", "微信支付", "支付成功 ￥28.00",
        )
        assertFalse(known.notificationPosted)
        assertEquals(1, store.pendingCandidateCount("account-a"))
        val unknown = coordinator.onSourceEvent(
            "account-a", "com.tencent.mm", PaymentSourceType.NOTIFICATION,
            "notification#key-13#13000", "", "转账",
        )
        assertTrue(unknown.ticketId.isNotBlank())
        assertEquals(1, store.tickets.size)
    }

    @Test fun nonPaymentNeverCreatesRecognitionOrNotification() {
        val store = FakeStore()
        val notifier = FakeNotifier()
        val coordinator = coordinator(store, notifier, Clock())
        val outcome = coordinator.onSourceEvent(
            "account-a", "org.telegram.messenger", PaymentSourceType.NOTIFICATION,
            "notification#tg-1#14000", "老周", "你好",
        )
        assertEquals("not_a_payment", outcome.skippedReason)
        assertTrue(store.recognitions.isEmpty())
        assertTrue(notifier.messages.isEmpty())
    }
}
