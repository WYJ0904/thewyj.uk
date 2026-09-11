package uk.thewyj.app.task21

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Task 24.1 hard architecture requirement: the archive and the payment engine
 * are two independent consumers of the same raw Android notification.
 *
 * - finance-only account: payments are still recognised while nothing is
 *   archived;
 * - archive-only account: history is stored while no payment is recognised;
 * - the classification layer only ever affects the archive.
 */
class NotificationPipelineSplitTest {
    private class RecordingSink : NotificationArchiveSink {
        val stored = mutableListOf<NotificationCaptureInput>()
        override fun store(
            accountId: String,
            input: NotificationCaptureInput,
            parsed: StructuredNotificationEvent?,
        ): Boolean {
            stored.add(input)
            return true
        }

        override fun markRemoved(accountId: String, input: NotificationCaptureInput) = Unit
    }

    private class RecordingHook : PaymentRecognitionHook {
        val captures = mutableListOf<NotificationCaptureInput>()
        override fun onCapture(
            accountId: String,
            input: NotificationCaptureInput,
            sourceAppLabel: String,
            uploadEventId: String,
        ) {
            captures.add(input)
        }

        override fun outcomeFor(input: NotificationCaptureInput) = PaymentIngestOutcome(
            confirmed = true,
            amountMinor = 2800,
            direction = FinanceDirection.EXPENSE,
            confidence = 950,
            merchant = "示例商户",
            counterparty = "示例商户",
            paymentChannel = "wechat",
            parserVersion = "test",
        )
    }

    private val paymentNotification = NotificationCaptureInput(
        sourcePackage = "com.tencent.mm",
        channelId = "chat",
        notificationKey = "key:wechat:1",
        notificationId = 1,
        title = "微信支付",
        text = "已支付 ¥28.00",
        postTime = 1_000L,
        receivedAtMs = 1_000L,
    )

    @Test fun financeOnlyAccountRecognisesPaymentsWithoutArchiving() {
        val sink = RecordingSink()
        val hook = RecordingHook()
        val archive = NotificationArchivePipeline(archiveFor = { _ -> error("archive disabled") }, sink = sink)
        val payment = PaymentRecognitionPipeline(hook)

        val archived = archive.consume(
            accountId = "account-a",
            archiveEntitled = false,
            input = paymentNotification,
            structured = null,
            identityKey = "key:wechat:1",
        )
        assertFalse(archived.stored)
        assertEquals("no_archive_entitlement", archived.reason)
        assertEquals(0, sink.stored.size)

        val outcome = payment.consume(
            accountId = "account-a",
            financeEntitled = true,
            input = paymentNotification,
            uploadEventId = "evt-1",
        )
        assertEquals(2800L, outcome?.amountMinor)
        assertEquals(1, hook.captures.size)
    }

    @Test fun archiveOnlyAccountStoresHistoryWithoutRecognisingPayments() {
        val sink = RecordingSink()
        val hook = RecordingHook()
        val archive = NotificationArchivePipeline(archiveFor = { _ -> error("sink expected") }, sink = sink)
        val payment = PaymentRecognitionPipeline(hook)

        val archived = archive.consume(
            accountId = "account-a",
            archiveEntitled = true,
            input = paymentNotification,
            structured = null,
            identityKey = "key:wechat:1",
        )
        assertTrue(archived.stored)
        assertEquals(1, sink.stored.size)

        assertNull(
            payment.consume(
                accountId = "account-a",
                financeEntitled = false,
                input = paymentNotification,
                uploadEventId = "",
            ),
        )
        assertEquals(0, hook.captures.size)
    }

    @Test fun classificationOnlyAffectsTheArchive() {
        val sink = RecordingSink()
        val hook = RecordingHook()
        val archive = NotificationArchivePipeline(archiveFor = { _ -> error("sink expected") }, sink = sink)
        val payment = PaymentRecognitionPipeline(hook)

        val ongoing = paymentNotification.copy(
            sourcePackage = "com.github.metacubex.clash.meta",
            channelId = "clash_status_channel",
            title = "Clash Meta for Android",
            text = "35 Bytes/s ↑ 670 Bytes/s ↓",
            isOngoing = true,
            notificationKey = "key:clash:1",
            notificationId = 2,
        )
        assertFalse(
            archive.consume(
                accountId = "account-a",
                archiveEntitled = true,
                input = ongoing,
                structured = null,
                identityKey = "key:clash:1",
            ).stored,
        )
        assertEquals(0, sink.stored.size)

        // The payment pipeline still sees the raw event: filtering history must
        // never silently disable recognition.
        payment.consume(
            accountId = "account-a",
            financeEntitled = true,
            input = ongoing,
            uploadEventId = "evt-2",
        )
        assertEquals(1, hook.captures.size)
    }
}
