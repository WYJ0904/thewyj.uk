package uk.thewyj.app.task21.payment

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.thewyj.app.task21.FinanceDirection

class PaymentTicketAndStatusTest {
    private class Clock(var value: Long = 0L) {
        fun advance(ms: Long) {
            value += ms
        }
    }

    private fun enrichment(
        packageName: String,
        amountMinor: Long?,
    ) = PaymentEnrichment(
        sourcePackage = packageName,
        amountMinor = amountMinor,
        currency = "CNY",
        direction = FinanceDirection.EXPENSE,
        merchant = null,
        counterparty = null,
        providerReference = null,
        occurredAtMs = 1_000L,
        confidence = 880,
    )

    @Test fun ticketIsCreatedWithNinetySecondWindow() {
        val clock = Clock()
        val engine = PaymentTicketEngine(now = { clock.value })
        val ticket = engine.create(
            accountId = "account-a",
            recognitionId = "rec-1",
            sourcePackage = "com.tencent.mm",
            sourceEventId = "com.tencent.mm|1|",
            paymentChannel = "wechat",
            missingFields = setOf("amount", "direction"),
        )
        assertEquals(PaymentTicketState.WAITING_FOR_ACCESSIBILITY, ticket.state)
        assertEquals(90_000L, ticket.expiresAtMs - ticket.createdAtMs)
        assertTrue(engine.isActive(ticket))
    }

    @Test fun ticketIsIdempotentAcrossNinetySeconds() {
        val clock = Clock()
        val engine = PaymentTicketEngine(now = { clock.value })
        val ticket = engine.create("a", "rec-1", "com.tencent.mm", "key", "wechat")
        clock.advance(89_000L)
        assertTrue(engine.isActive(ticket))
        assertEquals(ticket.state, engine.expireIfNeeded(ticket).state)
        clock.advance(2_000L)
        val expired = engine.expireIfNeeded(ticket)
        assertEquals(PaymentTicketState.EXPIRED, expired.state)
        assertTrue(expired.state.terminal)
    }

    @Test fun enrichmentWithinWindowIsApplied() {
        val clock = Clock()
        val engine = PaymentTicketEngine(now = { clock.value })
        val ticket = engine.create("a", "rec-1", "com.tencent.mm", "key", "wechat", missingFields = setOf("amount"))
        clock.advance(30_000L)
        val outcome = engine.enrich(ticket, enrichment("com.tencent.mm", 2_800L))
        assertTrue(outcome is EnrichmentOutcome.Applied)
        val applied = (outcome as EnrichmentOutcome.Applied).ticket
        assertEquals(PaymentTicketState.ENRICHED, applied.state)
        assertEquals(2_800L, applied.amountHintMinor)
        assertFalse(applied.missingFields.contains("amount"))
    }

    @Test fun enrichmentWithoutAmountNeverInventsAValue() {
        val clock = Clock()
        val engine = PaymentTicketEngine(now = { clock.value })
        val ticket = engine.create("a", "rec-1", "com.tencent.mm", "key", "wechat", missingFields = setOf("amount"))
        clock.advance(10_000L)
        val outcome = engine.enrich(ticket, enrichment("com.tencent.mm", null))
        assertTrue(outcome is EnrichmentOutcome.Insufficient)
        val insufficient = (outcome as EnrichmentOutcome.Insufficient).ticket
        assertEquals(PaymentTicketState.WAITING_FOR_ACCESSIBILITY, insufficient.state)
        assertEquals(1, insufficient.attempts)
    }

    @Test fun wrongPackageEvidenceIsRejected() {
        val engine = PaymentTicketEngine(now = { 1_000L })
        val ticket = engine.create("a", "rec-1", "com.tencent.mm", "key", "wechat")
        val outcome = engine.enrich(ticket, enrichment("com.eg.android.AlipayGphone", 1_000L))
        assertTrue(outcome is EnrichmentOutcome.Rejected)
        assertEquals("package_mismatch", (outcome as EnrichmentOutcome.Rejected).reason)
    }

    @Test fun expiredTicketNeverAcceptsAccessibilityEvidence() {
        val clock = Clock()
        val engine = PaymentTicketEngine(now = { clock.value })
        val ticket = engine.create("a", "rec-1", "com.tencent.mm", "key", "wechat")
        clock.advance(91_000L)
        val outcome = engine.enrich(ticket, enrichment("com.tencent.mm", 2_800L))
        assertTrue(outcome is EnrichmentOutcome.Rejected)
        val rejected = outcome as EnrichmentOutcome.Rejected
        assertEquals("ticket_expired", rejected.reason)
        assertEquals(PaymentTicketState.EXPIRED, rejected.ticket.state)
    }

    @Test fun terminalTicketCannotBeReopened() {
        val engine = PaymentTicketEngine(now = { 1_000L })
        val ticket = engine.create("a", "rec-1", "com.tencent.mm", "key", "wechat")
        val confirmed = engine.markConfirmed(ticket)
        assertEquals(PaymentTicketState.CONFIRMED, confirmed.state)
        val again = engine.enrich(confirmed, enrichment("com.tencent.mm", 9_900L))
        assertTrue(again is EnrichmentOutcome.Rejected)
        assertEquals(PaymentTicketState.CONFIRMED, (again as EnrichmentOutcome.Rejected).ticket.state)
    }

    @Test fun duplicateAccessibilityEventsDoNotChangeAConfirmedTicket() {
        val engine = PaymentTicketEngine(now = { 1_000L })
        val ticket = engine.create("a", "rec-1", "com.tencent.mm", "key", "wechat")
        val enriched = (engine.enrich(ticket, enrichment("com.tencent.mm", 2_800L)) as EnrichmentOutcome.Applied).ticket
        val candidate = engine.markCandidateCreated(enriched)
        val confirmed = engine.markConfirmed(candidate)
        assertEquals(PaymentTicketState.CONFIRMED, engine.markConfirmed(confirmed).state)
        assertEquals(PaymentTicketState.CONFIRMED, engine.markDuplicate(confirmed).state)
    }

    @Test fun amountKnownFlowNotifiesOncePerStateAndRecordsFinance() {
        val machine = PaymentStatusStateMachine(now = { 1_000L })
        val first = machine.transition(
            current = null,
            next = PaymentRecognitionState.DETECTED_AMOUNT_KNOWN,
            recognitionId = "rec-1",
            sourceAppLabel = "微信",
            amountLabel = "¥28.00",
        )
        assertTrue(first is PaymentStatusTransition.Updated)
        val updated = first as PaymentStatusTransition.Updated
        assertTrue(updated.message.body.contains("微信"))
        assertTrue(updated.message.body.contains("¥28.00"))

        // Replay of the same state must not re-notify.
        val replay = machine.transition(
            current = updated.record,
            next = PaymentRecognitionState.DETECTED_AMOUNT_KNOWN,
            recognitionId = "rec-1",
            sourceAppLabel = "微信",
            amountLabel = "¥28.00",
        )
        assertTrue(replay is PaymentStatusTransition.Ignored)

        val recorded = machine.transition(
            current = updated.record,
            next = PaymentRecognitionState.FINANCE_RECORDED,
            recognitionId = "rec-1",
            sourceAppLabel = "微信",
            amountLabel = "¥28.00",
            directionLabel = "支出",
        )
        assertTrue(recorded is PaymentStatusTransition.Updated)
        val recordedMessage = (recorded as PaymentStatusTransition.Updated).message
        assertEquals(updated.message.notificationId, recordedMessage.notificationId)
        assertTrue(recordedMessage.body.contains("已记录到财务"))
    }

    @Test fun amountUnknownFlowOffersNinetySecondEnrichment() {
        val machine = PaymentStatusStateMachine(now = { 1_000L })
        val detected = machine.transition(
            current = null,
            next = PaymentRecognitionState.DETECTED_AMOUNT_UNKNOWN,
            recognitionId = "rec-2",
            sourceAppLabel = "微信",
        ) as PaymentStatusTransition.Updated
        assertTrue(detected.message.body.contains("90 秒"))
        assertTrue(detected.message.body.contains("微信"))

        val waiting = machine.transition(
            current = detected.record,
            next = PaymentRecognitionState.WAITING_FOR_ENRICHMENT,
            recognitionId = "rec-2",
            sourceAppLabel = "微信",
        ) as PaymentStatusTransition.Updated
        assertEquals(detected.record.notificationId, waiting.record.notificationId)

        val verified = machine.transition(
            current = waiting.record,
            next = PaymentRecognitionState.ENRICHMENT_VERIFIED,
            recognitionId = "rec-2",
            sourceAppLabel = "微信",
            amountLabel = "¥28.00",
        ) as PaymentStatusTransition.Updated
        assertTrue(verified.message.body.contains("¥28.00"))

        val recorded = machine.transition(
            current = verified.record,
            next = PaymentRecognitionState.FINANCE_RECORDED,
            recognitionId = "rec-2",
            sourceAppLabel = "微信",
            amountLabel = "¥28.00",
        )
        assertTrue(recorded is PaymentStatusTransition.Updated)
    }

    @Test fun expiredEnrichmentKeepsHintAndOffersManualVerification() {
        val machine = PaymentStatusStateMachine(now = { 1_000L })
        val detected = machine.transition(
            null,
            PaymentRecognitionState.DETECTED_AMOUNT_UNKNOWN,
            "rec-3",
            "微信",
        ) as PaymentStatusTransition.Updated
        val waiting = machine.transition(
            detected.record,
            PaymentRecognitionState.WAITING_FOR_ENRICHMENT,
            "rec-3",
            "微信",
        ) as PaymentStatusTransition.Updated
        val expired = machine.transition(
            waiting.record,
            PaymentRecognitionState.ENRICHMENT_EXPIRED,
            "rec-3",
            "微信",
        ) as PaymentStatusTransition.Updated
        assertTrue(expired.message.offerManualVerification)
        assertTrue(expired.message.body.contains("核实交易金额"))
    }

    @Test fun terminalRecognitionIsNeverReopened() {
        val machine = PaymentStatusStateMachine(now = { 1_000L })
        val recorded = machine.transition(
            null,
            PaymentRecognitionState.DETECTED_AMOUNT_KNOWN,
            "rec-4",
            "微信",
            "¥28.00",
        ) as PaymentStatusTransition.Updated
        val done = machine.transition(
            recorded.record,
            PaymentRecognitionState.FINANCE_RECORDED,
            "rec-4",
            "微信",
            "¥28.00",
        ) as PaymentStatusTransition.Updated
        val reopened = machine.transition(
            done.record,
            PaymentRecognitionState.DETECTED_AMOUNT_UNKNOWN,
            "rec-4",
            "微信",
        )
        assertTrue(reopened is PaymentStatusTransition.Ignored)
        val ignored = reopened as PaymentStatusTransition.Ignored
        // A recorded transaction can still be corrected, but late evidence must
        // never push it back to "amount unknown".
        assertTrue(ignored.reason in setOf("terminal_state", "illegal_transition"))
        assertEquals(PaymentRecognitionState.FINANCE_RECORDED, ignored.record?.state)
    }

    @Test fun correctionAfterRecordedIsAllowed() {
        val machine = PaymentStatusStateMachine(now = { 1_000L })
        val recorded = machine.transition(
            null,
            PaymentRecognitionState.DETECTED_AMOUNT_KNOWN,
            "rec-5",
            "微信",
            "¥20.00",
        ) as PaymentStatusTransition.Updated
        val done = machine.transition(
            recorded.record,
            PaymentRecognitionState.FINANCE_RECORDED,
            "rec-5",
            "微信",
            "¥20.00",
        ) as PaymentStatusTransition.Updated
        val corrected = machine.transition(
            done.record,
            PaymentRecognitionState.FINANCE_CORRECTED,
            "rec-5",
            "微信",
            "¥20.00",
        )
        assertTrue(corrected is PaymentStatusTransition.Updated)
        assertTrue((corrected as PaymentStatusTransition.Updated).message.body.contains("修改"))
    }

    @Test fun notificationIdsAreStablePerRecognitionAndDistinctAcrossRecognitions() {
        val first = PaymentStatusStateMachine.stableNotificationId("rec-a")
        val firstAgain = PaymentStatusStateMachine.stableNotificationId("rec-a")
        val second = PaymentStatusStateMachine.stableNotificationId("rec-b")
        assertEquals(first, firstAgain)
        assertNotNull(first)
        assertTrue(first != second)
        assertTrue(first > 2300)
    }
}
