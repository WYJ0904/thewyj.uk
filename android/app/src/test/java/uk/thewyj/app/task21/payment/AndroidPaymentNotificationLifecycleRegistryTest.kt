package uk.thewyj.app.task21.payment

import android.app.Application
import android.content.Context
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import uk.thewyj.app.task21.NotificationCaptureInput
import uk.thewyj.app.task21.PaymentIngestOutcome
import uk.thewyj.app.task21.FinanceDirection
import uk.thewyj.app.task21.NotificationFingerprint
import uk.thewyj.app.task21.paymentNotificationEvidence

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class AndroidPaymentNotificationLifecycleRegistryTest {
    private lateinit var context: Context

    @Before fun setUp() {
        context = RuntimeEnvironment.getApplication()
        preferences().edit().clear().commit()
    }

    @After fun tearDown() {
        preferences().edit().clear().commit()
    }

    @Test fun identitySurvivesRecreationAndShortIdenticalRepostButExpiresAfterGrace() {
        val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002"))
        var now = 1_000L
        val input = NotificationCaptureInput(
            sourcePackage = "com.tencent.mm",
            notificationKey = "95|com.tencent.mm|-243922068|null|9510390",
            notificationId = -243922068,
            messageIdentity = "message-one",
            postTime = 1_000L,
            receivedAtMs = 1_000L,
        )
        val firstStore = AndroidPaymentNotificationLifecycleRegistry(context, now = { now }, idFactory = { ids.removeFirst() })
        val first = firstStore.eventId("account-a", input)

        val recreatedStore = AndroidPaymentNotificationLifecycleRegistry(context, now = { now }, idFactory = { ids.removeFirst() })
        val updated = recreatedStore.eventId(
            "account-a",
            input.copy(postTime = 12_000L, receivedAtMs = 12_000L),
        )
        assertEquals(first, updated)

        recreatedStore.markRemoved("account-a", input)
        now += 2_000L
        val repostRegistry = AndroidPaymentNotificationLifecycleRegistry(context, now = { now }, idFactory = { ids.removeFirst() })
        val immediateRepost = repostRegistry.eventId("account-a", input.copy(postTime = 30_000L, receivedAtMs = 30_000L))
        assertEquals(first, immediateRepost)

        repostRegistry.markRemoved("account-a", input)
        now += AndroidPaymentNotificationLifecycleRegistry.REPOST_GRACE_MS + 1
        val later = AndroidPaymentNotificationLifecycleRegistry(context, now = { now }, idFactory = { ids.removeFirst() })
            .eventId("account-a", input.copy(postTime = 60_000L, receivedAtMs = 60_000L,
                messageIdentity = "message-two"))
        assertNotEquals(first, later)
    }

    @Test fun activeIncompletePaymentKeepsItsIdWhenAmountBecomesKnown() {
        val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002"))
        val registry = AndroidPaymentNotificationLifecycleRegistry(context, idFactory = { ids.removeFirst() })
        val capture = input("微信支付提醒")
        val incomplete = PaymentIngestOutcome(
            confirmed = false,
            amountMinor = 0,
            direction = FinanceDirection.UNKNOWN,
            confidence = 700,
            merchant = "",
            counterparty = "",
            paymentChannel = "wechat",
            parserVersion = "wechat-2",
        )
        val complete = incomplete.copy(
            confirmed = true,
            amountMinor = 1,
            direction = FinanceDirection.EXPENSE,
            confidence = 950,
        )

        val first = registry.eventId("account-a", capture, incomplete)
        val promoted = registry.eventId("account-a", capture.copy(text = "支出 ¥0.01"), complete)

        assertEquals(first, promoted)
    }

    @Test fun sameSlotAndAmountWithDifferentTransactionEvidenceGetsANewId() {
        val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002"))
        var now = 1_000L
        val registry = AndroidPaymentNotificationLifecycleRegistry(context, now = { now }, idFactory = { ids.removeFirst() })
        val first = registry.eventId("account-a", input("交易号 A100"))
        now += 1_000L
        val second = registry.eventId("account-a", input("交易号 B200"))
        assertNotEquals(first, second)
    }

    @Test fun sameAmountAndSlotWithDifferentProviderReferencesNeverMerge() {
        val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002"))
        val registry = AndroidPaymentNotificationLifecycleRegistry(context, idFactory = { ids.removeFirst() })
        val capture = input("已支付 ¥2.80")
        val first = registry.eventId("account-a", capture, payment("reference-A"))
        val second = registry.eventId("account-a", capture, payment("reference-B"))
        assertNotEquals(first, second)
    }

    @Test fun preUpgradeIncompleteLifecycleKeepsItsEventIdAfterUpgrade() {
        val capture = input("微信支付提醒")
        val incomplete = PaymentIngestOutcome(false, 0, FinanceDirection.UNKNOWN, 600,
            "", "", "wechat", "wechat-2")
        val key = "life:" + NotificationFingerprint.sha256Hex("account-a\u001Fkey:${capture.notificationKey}")
        preferences().edit().putString(key,
            "payment-event-legacy\u001F1000\u001F${paymentNotificationEvidence(capture, incomplete)}\u001F0")
            .commit()
        val registry = AndroidPaymentNotificationLifecycleRegistry(context,
            idFactory = { "payment-event-new" })
        val updated = registry.eventId("account-a", capture.copy(text = "已支付 ¥0.01"),
            incomplete.copy(amountMinor = 1, direction = FinanceDirection.EXPENSE, confirmed = true))
        assertEquals("payment-event-legacy", updated)
    }

    @Test fun amountKnownDirectionUnknownPromotesWithinTheSameSlot() {
        val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002"))
        val registry = AndroidPaymentNotificationLifecycleRegistry(context, idFactory = { ids.removeFirst() })
        val partial = PaymentIngestOutcome(false, 1, FinanceDirection.UNKNOWN, 710, "", "", "wechat", "wechat-2")
        val complete = partial.copy(confirmed = true, direction = FinanceDirection.EXPENSE, confidence = 850)
        val first = registry.eventId("account-a", input("微信支付 ¥0.01"), partial)
        val updated = registry.eventId("account-a", input("微信已支付 ¥0.01"), complete)
        assertEquals(first, updated)
    }

    @Test fun activeAmountOnlyWechatStatusUpdatesKeepOneIdWithoutInventingDirection() {
        val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002", "payment-event-0003"))
        var now = 1_000L
        val registry = AndroidPaymentNotificationLifecycleRegistry(context, now = { now }, idFactory = { ids.removeFirst() })
        val amountOnly = PaymentIngestOutcome(false, 10_200, FinanceDirection.UNKNOWN, 710,
            "", "", "wechat", "wechat-2")
        val first = registry.eventId("account-a", input("转账 ¥102.00"), amountOnly)
        now += 2_000L
        val second = registry.eventId("account-a", input("微信交易提醒 ¥102.00").copy(postTime = 3_000L), amountOnly)
        now += 2_000L
        val third = registry.eventId("account-a", input("交易待核实 ¥102.00").copy(postTime = 5_000L), amountOnly)
        assertEquals(first, second)
        assertEquals(first, third)
    }

    @Test fun messagingStyleIdentitySurvivesDifferentNotificationKeysAndRepost() {
        val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002"))
        var now = 1_000L
        val registry = AndroidPaymentNotificationLifecycleRegistry(context, now = { now }, idFactory = { ids.removeFirst() })
        val incomplete = PaymentIngestOutcome(false, 0, FinanceDirection.UNKNOWN, 600, "", "", "wechat", "wechat-2")
        val firstInput = input("微信支付提醒").copy(notificationKey = "key-a", messageIdentity = "message-42")
        val first = registry.eventId("account-a", firstInput, incomplete)
        registry.markRemoved("account-a", firstInput)
        now += 2_000L
        val updateInput = firstInput.copy(notificationKey = "key-b", notificationId = 8,
            postTime = 3_000L, text = "已支付 ¥0.01")
        val updated = registry.eventId("account-a", updateInput,
            incomplete.copy(amountMinor = 1, direction = FinanceDirection.EXPENSE, confirmed = true))
        assertEquals(first, updated)
    }

    @Test fun changedNotificationKeyWithSamePlatformIdPromotesOnlyIncompleteEvidence() {
        val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002"))
        var now = 1_000L
        val registry = AndroidPaymentNotificationLifecycleRegistry(context, now = { now }, idFactory = { ids.removeFirst() })
        val incomplete = PaymentIngestOutcome(false, 0, FinanceDirection.UNKNOWN, 600, "", "", "wechat", "wechat-2")
        val first = registry.eventId("account-a", input("微信支付提醒").copy(notificationKey = "key-a"), incomplete)
        now += 2_000L
        val updated = registry.eventId("account-a", input("微信已支付 ¥0.01").copy(notificationKey = "key-b"),
            incomplete.copy(amountMinor = 1, direction = FinanceDirection.EXPENSE, confirmed = true))
        assertEquals(first, updated)
    }

    @Test fun sameProviderReferenceAcrossSlotsReusesOneEvent() {
        val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002"))
        val registry = AndroidPaymentNotificationLifecycleRegistry(context, idFactory = { ids.removeFirst() })
        val first = registry.eventId("account-a", input("支付提醒").copy(notificationKey = "key-a"), payment("reference-A"))
        val updated = registry.eventId("account-a", input("已支付 ¥2.80").copy(
            notificationKey = "key-b", notificationId = 8), payment("reference-A"))
        assertEquals(first, updated)
    }

    @Test fun consecutiveEqualAmountMessagesAndAmbiguousRepostRemainSeparate() {
        val ids = ArrayDeque(listOf("payment-event-0001", "payment-event-0002", "payment-event-0003"))
        var now = 1_000L
        val registry = AndroidPaymentNotificationLifecycleRegistry(context, now = { now }, idFactory = { ids.removeFirst() })
        val firstInput = input("已支付 ¥2.80").copy(messageIdentity = "message-first")
        val first = registry.eventId("account-a", firstInput, payment(""))
        now += 1_000L
        val second = registry.eventId("account-a", firstInput.copy(messageIdentity = "message-second",
            postTime = 2_000L), payment(""))
        assertNotEquals(first, second)
        registry.markRemoved("account-a", firstInput.copy(messageIdentity = "message-second"))
        now += 1_000L
        val ambiguous = registry.eventId("account-a", firstInput.copy(messageIdentity = "",
            postTime = 3_000L), payment(""))
        assertNotEquals(second, ambiguous)
    }

    @Test fun registryStoresNoAccountOrNotificationContent() {
        val registry = AndroidPaymentNotificationLifecycleRegistry(context) { "payment-event-private" }
        registry.eventId(
            "private-account-id",
            NotificationCaptureInput(
                sourcePackage = "com.tencent.mm",
                notificationKey = "private-notification-key",
                notificationId = 7,
                title = "private title",
                text = "private body",
            ),
        )
        val persisted = preferences().all.entries.joinToString("|") { "${it.key}=${it.value}" }
        assertFalse(persisted.contains("private-account-id"))
        assertFalse(persisted.contains("private-notification-key"))
        assertFalse(persisted.contains("private title"))
        assertFalse(persisted.contains("private body"))
    }

    private fun preferences() = context.getSharedPreferences(
        "wyj-payment-notification-lifecycles",
        Context.MODE_PRIVATE,
    )

    private fun input(body: String) = NotificationCaptureInput(
        sourcePackage = "com.tencent.mm",
        notificationKey = "shared-payment-slot",
        notificationId = 7,
        title = "微信支付",
        text = body,
        postTime = 1_000L,
        receivedAtMs = 1_000L,
    )

    private fun payment(reference: String) = PaymentIngestOutcome(
        confirmed = true,
        amountMinor = 280,
        direction = FinanceDirection.EXPENSE,
        confidence = 950,
        merchant = "",
        counterparty = "",
        paymentChannel = "wechat",
        parserVersion = "wechat-2",
        providerReference = reference,
    )
}
